import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AiUsage } from '@shared/domain'
import { errorMessage } from '../../errors'
import { runProcess } from './process'
import { JSON_INSTRUCTION, TEXT_INSTRUCTION, timeoutFor, type AiProvider } from './provider'

// Read-only search commands only. Writes are denied, and shell redirection needs --allow-all-tools, which is never passed.
export const CODE_SEARCH_TOOLS = [
  'cat',
  'ls',
  'rg',
  'grep',
  'Get-Content',
  'Get-ChildItem',
  'Select-String',
  'git log',
  'git show',
  'git diff',
  'git grep',
  'git blame'
] as const

export interface Invocation {
  command: string
  args: string[]
}

/** Wraps a copilot CLI call; on Windows through PowerShell so the npm shim (copilot.cmd) resolves reliably. */
export function copilotCommand(cliArgs: readonly string[], platform: NodeJS.Platform, systemRoot: string): Invocation {
  if (platform !== 'win32') return { command: 'copilot', args: [...cliArgs] }
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$cli = Get-Command copilot.cmd -CommandType Application -ErrorAction SilentlyContinue',
    'if (-not $cli) { $cli = Get-Command copilot -ErrorAction Stop }',
    `$cliArgs = @(${cliArgs.map(quote).join(', ')})`,
    '& $cli.Source @cliArgs',
    'exit $LASTEXITCODE'
  ].join('; ')
  return {
    command: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]
  }
}

/** CLI arguments ported from qa-portal copilotChatInvocation, generalized to any connected codebase. */
export function copilotArgs(options: {
  promptDirectory: string
  instruction: string
  codebasePath: string | null
  /** Null for CLI builds that do not know --usage-output-file. */
  usageFile: string | null
}): string[] {
  const tools = options.codebasePath ? CODE_SEARCH_TOOLS : (['cat'] as const)
  return [
    '-C',
    options.promptDirectory,
    '-p',
    options.instruction,
    ...(options.codebasePath ? ['--add-dir', options.codebasePath] : []),
    ...(options.usageFile ? ['--usage-output-file', options.usageFile] : []),
    ...tools.map((tool) => `--allow-tool=shell(${tool}:*)`),
    '--deny-tool=write',
    '--disable-builtin-mcps',
    '--silent'
  ]
}

interface CopilotUsageReport {
  modelMetrics?: Record<string, { usage?: Record<string, number> }>
  providerModelMetrics?: { modelId: string; modelDisplayName: string }[]
  totalPremiumRequestCost?: number
}

/** Reduces Copilot's --usage-output-file JSON to what the chat shows under an answer. */
export function copilotUsage(report: CopilotUsageReport, elapsedMs: number): AiUsage {
  const models = Object.entries(report.modelMetrics ?? {})
  const sum = (key: string): number => models.reduce((total, [, metrics]) => total + (metrics.usage?.[key] ?? 0), 0)
  const names = Object.fromEntries((report.providerModelMetrics ?? []).map((item) => [item.modelId, item.modelDisplayName]))
  return {
    model: models.map(([id]) => names[id] ?? id).join(', ') || undefined,
    premiumRequests: report.totalPremiumRequestCost ?? 0,
    inputTokens: sum('inputTokens'),
    cachedTokens: sum('cacheReadTokens'),
    outputTokens: sum('outputTokens'),
    elapsedMs
  }
}

export interface CopilotProviderOptions {
  platform?: NodeJS.Platform
  systemRoot?: string
  /** Overrides how the CLI is launched; tests point this at a fake CLI. */
  launcher?: (cliArgs: readonly string[]) => Invocation
}

export function createCopilotProvider(options: CopilotProviderOptions = {}): AiProvider {
  const platform = options.platform ?? process.platform
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows'
  const launch = options.launcher ?? ((cliArgs: readonly string[]) => copilotCommand(cliArgs, platform, systemRoot))

  return {
    id: 'copilot',

    async checkAvailability() {
      const { command, args } = launch(['--version'])
      try {
        const version = await runProcess(command, args, { timeoutMs: 20_000, failure: 'copilot --version failed' })
        return { id: 'copilot', ok: true, detail: `GitHub Copilot CLI ${version.split(/\r?\n/)[0] ?? ''}`.trim() }
      } catch (error) {
        return { id: 'copilot', ok: false, detail: `Copilot CLI not found or not signed in (${errorMessage(error).slice(0, 200)})` }
      }
    },

    async run(request) {
      const promptDirectory = await mkdtemp(path.join(os.tmpdir(), 'qa-hub-copilot-'))
      try {
        await writeFile(path.join(promptDirectory, 'prompt.md'), request.prompt, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        const usageFile = path.join(promptDirectory, 'usage.json')
        const base = request.output === 'json' ? JSON_INSTRUCTION : TEXT_INSTRUCTION
        const instruction = `Read @prompt.md and complete the task it describes. ${base} ${request.instruction}`.trim()
        const ask = (withUsage: boolean): Promise<string> => {
          const invocation = launch(
            copilotArgs({ promptDirectory, instruction, codebasePath: request.codebase?.path ?? null, usageFile: withUsage ? usageFile : null })
          )
          return runProcess(invocation.command, invocation.args, {
            env: process.env,
            timeoutMs: timeoutFor(request.codebase),
            signal: request.signal,
            onStdout: (chunk) => request.onEvent({ kind: 'delta', text: chunk }),
            failure: 'Copilot did not answer'
          })
        }
        request.onEvent({ kind: 'status', text: request.codebase ? `Searching ${request.codebase.name}…` : 'Thinking…' })
        const startedAt = Date.now()
        // Some Copilot CLI builds reject --usage-output-file outright; ask again without it rather than fail.
        const text = await ask(true).catch((error: unknown) => {
          if (/unknown option '--usage-output-file'/.test(errorMessage(error))) return ask(false)
          throw error
        })
        // Older Copilot CLIs write no usage file; the answer still shows without a usage footer.
        const usage = await readFile(usageFile, 'utf8')
          .then((raw) => copilotUsage(JSON.parse(raw) as CopilotUsageReport, Date.now() - startedAt))
          .catch(() => ({ elapsedMs: Date.now() - startedAt }))
        return { text, usage }
      } finally {
        await rm(promptDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }
  }
}
