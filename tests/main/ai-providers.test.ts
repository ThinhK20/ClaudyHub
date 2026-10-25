import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkToolAccess, createClaudeProvider } from '../../src/main/modules/ai/claude-provider'
import {
  CODE_SEARCH_TOOLS,
  copilotArgs,
  copilotCommand,
  copilotUsage,
  createCopilotProvider
} from '../../src/main/modules/ai/copilot-provider'
import { runProcess } from '../../src/main/modules/ai/process'
import type { AiRunRequest, ProviderEvent } from '../../src/main/modules/ai/provider'

const FAKE_COPILOT = path.resolve(__dirname, '../fixtures/fake-copilot.mjs')
const node = process.execPath

function request(overrides: Partial<AiRunRequest> = {}): AiRunRequest & { events: ProviderEvent[] } {
  const events: ProviderEvent[] = []
  return {
    instruction: '',
    prompt: 'What changed?',
    codebase: null,
    output: 'text',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    events,
    ...overrides
  }
}

describe('runProcess', () => {
  it('resolves trimmed stdout and streams chunks', async () => {
    const chunks: string[] = []
    const out = await runProcess(node, ['-e', 'process.stdout.write("  hi  ")'], { timeoutMs: 10_000, failure: 'x', onStdout: (c) => chunks.push(c) })
    expect(out).toBe('hi')
    expect(chunks.join('')).toBe('  hi  ')
  })

  it('rejects with stderr on failure', async () => {
    await expect(runProcess(node, ['-e', 'console.error("boom"); process.exit(3)'], { timeoutMs: 10_000, failure: 'x' })).rejects.toThrow('boom')
  })

  it('times out and cancels', async () => {
    const slow = ['-e', 'setTimeout(() => {}, 20000)']
    await expect(runProcess(node, slow, { timeoutMs: 200, failure: 'Slow' })).rejects.toThrow('Slow: timed out')
    const controller = new AbortController()
    const pending = runProcess(node, slow, { timeoutMs: 20_000, failure: 'x', signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toThrow('Cancelled')
    const aborted = new AbortController()
    aborted.abort()
    await expect(runProcess(node, slow, { timeoutMs: 1000, failure: 'x', signal: aborted.signal })).rejects.toThrow('Cancelled')
  })
})

describe('copilot invocation', () => {
  it('grants only cat without a codebase and read-only search tools with one', () => {
    const base = { promptDirectory: '/tmp/p', instruction: 'Read @prompt.md', usageFile: '/tmp/p/u.json' }
    const plain = copilotArgs({ ...base, codebasePath: null })
    expect(plain).toContain('--allow-tool=shell(cat:*)')
    expect(plain).not.toContain('--add-dir')
    expect(plain).toEqual(expect.arrayContaining(['--deny-tool=write', '--disable-builtin-mcps', '--silent']))
    const withCode = copilotArgs({ ...base, codebasePath: '/src/app' })
    expect(withCode.slice(withCode.indexOf('--add-dir'), withCode.indexOf('--add-dir') + 2)).toEqual(['--add-dir', '/src/app'])
    for (const tool of CODE_SEARCH_TOOLS) expect(withCode).toContain(`--allow-tool=shell(${tool}:*)`)
    expect(withCode.join(' ')).not.toMatch(/allow-all-tools|shell\(rm/)
  })

  it('wraps the CLI in PowerShell on Windows with quoted arguments', () => {
    expect(copilotCommand(['-p', 'x'], 'linux', '')).toEqual({ command: 'copilot', args: ['-p', 'x'] })
    const win = copilotCommand(['-p', "it's"], 'win32', 'C:\\Windows')
    expect(win.command).toBe(path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    expect(win.args.at(-1)).toContain("'it''s'")
  })

  it('summarizes usage reports', () => {
    expect(
      copilotUsage(
        {
          modelMetrics: { a: { usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } }, b: { usage: { inputTokens: 1 } } },
          providerModelMetrics: [{ modelId: 'a', modelDisplayName: 'Model A' }],
          totalPremiumRequestCost: 2
        },
        50
      )
    ).toEqual({ model: 'Model A, b', premiumRequests: 2, inputTokens: 4, cachedTokens: 1, outputTokens: 2, elapsedMs: 50 })
  })
})

describe('copilot provider (fake CLI)', () => {
  const provider = createCopilotProvider({ launcher: (args) => ({ command: node, args: [FAKE_COPILOT, ...args] }) })

  it('answers with the codebase passed read-only and cleans up its prompt folder', async () => {
    const before = (await readdir(os.tmpdir())).filter((name) => name.startsWith('qa-hub-copilot-')).length
    const req = request({ codebase: { id: 'c1', name: 'App', path: '/src/app' } })
    const result = await provider.run(req)
    expect(result.text).toMatch(/^ANSWER codebase=\/src\/app denyWrite=true promptBytes=\d+$/)
    expect(result.usage).toMatchObject({ model: 'GPT X', inputTokens: 10, premiumRequests: 1 })
    expect(req.events[0]).toEqual({ kind: 'status', text: 'Searching App…' })
    expect(req.events.some((event) => event.kind === 'delta')).toBe(true)
    const after = (await readdir(os.tmpdir())).filter((name) => name.startsWith('qa-hub-copilot-')).length
    expect(after).toBe(before)
  })

  it('retries without the usage file when the CLI does not know that option', async () => {
    vi.stubEnv('FAKE_COPILOT_MODE', 'no-usage-flag')
    try {
      const result = await provider.run(request())
      expect(result.text).toMatch(/^ANSWER /)
      expect(result.usage).not.toHaveProperty('inputTokens')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports CLI failures and availability', async () => {
    vi.stubEnv('FAKE_COPILOT_MODE', 'fail')
    try {
      await expect(provider.run(request())).rejects.toThrow('not signed in')
    } finally {
      vi.unstubAllEnvs()
    }
    expect(await provider.checkAvailability()).toEqual({ id: 'copilot', ok: true, detail: 'GitHub Copilot CLI 1.2.3' })
    const missing = createCopilotProvider({ launcher: () => ({ command: path.join(os.tmpdir(), 'no-such-copilot'), args: [] }) })
    expect((await missing.checkAvailability()).ok).toBe(false)
  })
})

describe('claude read-only guard', () => {
  const root = path.resolve('/repo/app')

  it('allows reads inside the codebase only', () => {
    expect(checkToolAccess(root, 'Read', { file_path: path.join(root, 'src', 'a.ts') })).toBeNull()
    expect(checkToolAccess(root, 'Grep', { pattern: 'x', path: 'src' })).toBeNull()
    expect(checkToolAccess(root, 'Glob', { pattern: '**/*.ts' })).toBeNull()
    expect(checkToolAccess(root, 'Read', { file_path: path.resolve('/etc/passwd') })).toMatch(/outside the connected codebase/)
    expect(checkToolAccess(root, 'Grep', { pattern: 'x', path: '../other' })).toMatch(/outside/)
    expect(checkToolAccess(root, 'Glob', { pattern: path.resolve('/secrets') + '/**' })).toMatch(/outside/)
  })

  it('denies every non-read tool', () => {
    for (const tool of ['Bash', 'Write', 'Edit', 'WebFetch', 'Task']) {
      expect(checkToolAccess(root, tool, {})).toBe(`${tool} is not available: access is read-only`)
    }
  })
})

describe('claude provider (fake SDK)', () => {
  type Captured = { prompt: string; options: Record<string, unknown> }

  function fakeQuery(messages: unknown[], captured: Captured[]) {
    return ((params: Captured) => {
      captured.push(params)
      return (async function* () {
        for (const message of messages) yield message
      })()
    }) as never
  }

  const success = {
    type: 'result',
    subtype: 'success',
    result: 'Final answer',
    usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1 },
    total_cost_usd: 0.01
  }

  it('runs read-only against the codebase and streams text', async () => {
    const captured: Captured[] = []
    const provider = createClaudeProvider({
      getApiKey: () => 'sk-test',
      getModel: () => 'claude-opus-5-5',
      queryFn: fakeQuery(
        [
          { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } }] } },
          { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Final ' } } },
          success
        ],
        captured
      )
    })
    const codebase = { id: 'c1', name: 'App', path: path.resolve('/repo/app') }
    const req = request({ codebase })
    const result = await provider.run(req)
    expect(result).toEqual({
      text: 'Final answer',
      usage: expect.objectContaining({ model: 'claude-opus-5-5', inputTokens: 7, outputTokens: 3, cachedTokens: 1, costUsd: 0.01 })
    })
    expect(req.events).toEqual([
      { kind: 'status', text: 'Read src/a.ts' },
      { kind: 'delta', text: 'Final ' }
    ])
    const options = captured[0]!.options
    expect(options).toMatchObject({
      cwd: codebase.path,
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'dontAsk',
      settingSources: [],
      model: 'claude-opus-5-5'
    })
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-test')
    const hook = (options.hooks as { PreToolUse: { hooks: ((input: unknown) => Promise<unknown>)[] }[] }).PreToolUse[0]!.hooks[0]!
    expect(await hook({ tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } })).toEqual({})
    expect(await hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' }
    })
  })

  it('gives no tools and a scratch folder without a codebase', async () => {
    const captured: Captured[] = []
    const provider = createClaudeProvider({ getApiKey: () => 'k', getModel: () => 'm', queryFn: fakeQuery([success], captured) })
    await provider.run(request())
    const options = captured[0]!.options
    expect(options.tools).toEqual([])
    expect(options.hooks).toBeUndefined()
    expect(existsSync(String(options.cwd))).toBe(false)
  })

  it('surfaces error results, missing keys and empty streams', async () => {
    const failing = createClaudeProvider({
      getApiKey: () => 'k',
      getModel: () => 'm',
      queryFn: fakeQuery([{ type: 'result', subtype: 'error_max_turns' }], [])
    })
    await expect(failing.run(request())).rejects.toThrow('Claude stopped: error max turns')
    const empty = createClaudeProvider({ getApiKey: () => 'k', getModel: () => 'm', queryFn: fakeQuery([], []) })
    await expect(empty.run(request())).rejects.toThrow('ended without an answer')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    try {
      const keyless = createClaudeProvider({ getApiKey: () => null, getModel: () => 'm', queryFn: fakeQuery([success], []) })
      await expect(keyless.run(request())).rejects.toThrow('Add an Anthropic API key')
      expect((await keyless.checkAvailability()).ok).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
    expect((await failing.checkAvailability()).detail).toBe('Claude Agent SDK · m')
  })

  it('reports cancellation', async () => {
    const controller = new AbortController()
    const provider = createClaudeProvider({
      getApiKey: () => 'k',
      getModel: () => 'm',
      queryFn: ((params: { options: { abortController: AbortController } }) =>
        (async function* () {
          controller.abort()
          if (params.options.abortController.signal.aborted) throw new Error('aborted by SDK')
          yield success
        })()) as never
    })
    await expect(provider.run(request({ signal: controller.signal }))).rejects.toThrow('Cancelled')
  })
})
