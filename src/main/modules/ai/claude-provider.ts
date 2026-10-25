import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AiUsage } from '@shared/domain'
import { UserError } from '../../errors'
import { isInside } from '../fs-paths'
import { JSON_INSTRUCTION, TEXT_INSTRUCTION, timeoutFor, type AiProvider, type AiRunRequest } from './provider'

/** The only tools the Claude agent ever gets: read, find and search files inside the chosen codebase. */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'] as const
const MAX_TURNS_WITH_CODEBASE = 40

/**
 * Decides whether a tool call stays inside the codebase. Returns a denial reason, or null to allow.
 * Relative paths resolve against the codebase root (the agent's cwd).
 */
export function checkToolAccess(root: string, toolName: string, input: unknown): string | null {
  if (!(READ_ONLY_TOOLS as readonly string[]).includes(toolName)) return `${toolName} is not available: access is read-only`
  const fields = (input ?? {}) as Record<string, unknown>
  const candidates: string[] = []
  if (typeof fields.file_path === 'string') candidates.push(fields.file_path)
  if (typeof fields.path === 'string') candidates.push(fields.path)
  if (toolName === 'Glob' && typeof fields.pattern === 'string' && path.isAbsolute(fields.pattern)) {
    candidates.push(fields.pattern.replace(/[*?[{].*$/, '') || fields.pattern)
  }
  const outside = candidates.find((candidate) => !isInside(root, path.resolve(root, candidate)))
  return outside ? `${outside} is outside the connected codebase` : null
}

type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query

export interface ClaudeProviderOptions {
  getApiKey: () => string | null
  getModel: () => string
  /** Absolute path to the SDK's native CLI when running from a packaged (asar) build. */
  executablePath?: string
  /** Injected in tests; defaults to the SDK's query(). */
  queryFn?: QueryFn
}

function systemPrompt(request: AiRunRequest): string {
  const base = request.output === 'json' ? JSON_INSTRUCTION : TEXT_INSTRUCTION
  const access = request.codebase
    ? `You can read the codebase "${request.codebase.name}" at ${request.codebase.path} with the Read, Glob and Grep tools. ` +
      'You cannot modify files or run commands. Cite file paths (and line numbers when useful) you relied on.'
    : 'You have no tools and cannot see any codebase.'
  return `You are a QA assistant inside QA Hub. ${base} ${access} ${request.instruction}`.trim()
}

function toolStatus(name: string, input: Record<string, unknown>): string {
  const target = input.file_path ?? input.pattern ?? input.path ?? ''
  return `${name} ${String(target)}`.trim()
}

export function createClaudeProvider(options: ClaudeProviderOptions): AiProvider {
  const loadQuery = async (): Promise<QueryFn> => options.queryFn ?? (await import('@anthropic-ai/claude-agent-sdk')).query

  return {
    id: 'claude',

    async checkAvailability() {
      const hasKey = Boolean(options.getApiKey() ?? process.env.ANTHROPIC_API_KEY)
      return hasKey
        ? { id: 'claude', ok: true, detail: `Claude Agent SDK · ${options.getModel()}` }
        : { id: 'claude', ok: false, detail: 'Add an Anthropic API key in Settings' }
    },

    async run(request) {
      const apiKey = options.getApiKey() ?? process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new UserError('Add an Anthropic API key in Settings to use Claude')
      const query = await loadQuery()
      const codebase = request.codebase
      // Without a codebase the agent runs in an empty scratch folder with no tools at all.
      const scratch = codebase ? null : await mkdtemp(path.join(os.tmpdir(), 'qa-hub-claude-'))
      const abortController = new AbortController()
      const onAbort = (): void => abortController.abort()
      request.signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => abortController.abort(), timeoutFor(codebase))
      const startedAt = Date.now()
      let streamed = ''
      try {
        const tools = codebase ? [...READ_ONLY_TOOLS] : []
        const messages = query({
          prompt: request.prompt,
          options: {
            cwd: codebase?.path ?? (scratch as string),
            model: options.getModel(),
            systemPrompt: systemPrompt(request),
            tools,
            allowedTools: tools,
            permissionMode: 'dontAsk',
            settingSources: [],
            includePartialMessages: true,
            maxTurns: codebase ? MAX_TURNS_WITH_CODEBASE : 1,
            abortController,
            env: { ...process.env, ANTHROPIC_API_KEY: apiKey, CLAUDE_AGENT_SDK_CLIENT_APP: 'qa-hub' },
            ...(options.executablePath ? { pathToClaudeCodeExecutable: options.executablePath } : {}),
            ...(codebase
              ? {
                  hooks: {
                    PreToolUse: [
                      {
                        hooks: [
                          async (input) => {
                            const toolInput = input as { tool_name?: string; tool_input?: unknown }
                            const denial = checkToolAccess(codebase.path, String(toolInput.tool_name ?? ''), toolInput.tool_input)
                            if (!denial) return {}
                            return {
                              hookSpecificOutput: {
                                hookEventName: 'PreToolUse' as const,
                                permissionDecision: 'deny' as const,
                                permissionDecisionReason: denial
                              }
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
              : {})
          }
        })

        for await (const message of messages) {
          if (message.type === 'stream_event') {
            const event = message.event as { type: string; delta?: { type: string; text?: string } }
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              streamed += event.delta.text
              request.onEvent({ kind: 'delta', text: event.delta.text })
            }
          } else if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') request.onEvent({ kind: 'status', text: toolStatus(block.name, block.input as Record<string, unknown>) })
            }
          } else if (message.type === 'result') {
            if (message.subtype !== 'success') throw new UserError(`Claude stopped: ${message.subtype.replaceAll('_', ' ')}`)
            const usage: AiUsage = {
              model: options.getModel(),
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              cachedTokens: message.usage.cache_read_input_tokens ?? 0,
              costUsd: message.total_cost_usd,
              elapsedMs: Date.now() - startedAt
            }
            return { text: (message.result || streamed).trim(), usage }
          }
        }
        throw new UserError('Claude ended without an answer')
      } catch (error) {
        if (abortController.signal.aborted) {
          throw new UserError(request.signal.aborted ? 'Cancelled' : 'Claude did not answer: timed out')
        }
        throw error
      } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
        if (scratch) await rm(scratch, { recursive: true, force: true })
      }
    }
  }
}
