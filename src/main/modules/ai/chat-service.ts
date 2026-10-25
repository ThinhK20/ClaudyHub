import type { AiUsage, ChatMessage, ChatStatus, ChatThread, ProviderId } from '@shared/domain'
import type { AiEvent } from '@shared/ipc'
import type { Db } from '../../db/connection'
import { UserError, errorMessage } from '../../errors'
import type { CodebaseService } from '../codebases/codebase-service'
import type { RunService } from '../runs/run-service'
import { newId, nowIso, parseJson, textOrNull } from '../util'
import { executeJob, type JobRegistry } from './jobs'
import { askPrompt, assistantPrompt } from './prompts'
import type { ProviderRegistry } from './provider'

export interface SendChatInput {
  runId: string
  thread: ChatThread
  caseId: string | null
  question: string
  codebaseId: string | null
  provider: ProviderId
  jobId: string
}

export interface ChatService {
  history(runId: string, thread: ChatThread): ChatMessage[]
  send(input: SendChatInput): Promise<ChatMessage>
  clear(runId: string, thread: ChatThread): void
  /** Marks answers left pending by a previous app session as interrupted. */
  markInterrupted(): number
}

function toMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    thread: String(row.thread) as ChatThread,
    caseId: textOrNull(row.case_id),
    role: String(row.role) as ChatMessage['role'],
    text: String(row.text),
    provider: textOrNull(row.provider) as ProviderId | null,
    codebaseId: textOrNull(row.codebase_id),
    usage: parseJson<AiUsage | null>(textOrNull(row.usage_json), null),
    status: String(row.status) as ChatStatus,
    createdAt: String(row.created_at)
  }
}

export function createChatService(deps: {
  db: Db
  runs: RunService
  codebases: CodebaseService
  providers: ProviderRegistry
  jobs: JobRegistry
  emit: (event: AiEvent) => void
}): ChatService {
  const { db } = deps
  const inFlight = new Set<string>()
  const threadKey = (runId: string, thread: ChatThread): string => `${runId}:${thread}`

  const history = (runId: string, thread: ChatThread): ChatMessage[] =>
    db
      .prepare('SELECT * FROM chat_messages WHERE run_id = ? AND thread = ? ORDER BY created_at, rowid')
      .all(runId, thread)
      .map(toMessage)

  const insert = (message: ChatMessage): void => {
    db.prepare(
      `INSERT INTO chat_messages (id, run_id, thread, case_id, role, text, provider, codebase_id, usage_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.id,
      message.runId,
      message.thread,
      message.caseId,
      message.role,
      message.text,
      message.provider,
      message.codebaseId,
      message.usage ? JSON.stringify(message.usage) : null,
      message.status,
      message.createdAt
    )
  }

  const complete = (id: string, status: ChatStatus, text: string, usage: AiUsage | null): ChatMessage => {
    db.prepare('UPDATE chat_messages SET status = ?, text = ?, usage_json = ? WHERE id = ?').run(
      status,
      text,
      usage ? JSON.stringify(usage) : null,
      id
    )
    return toMessage(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as Record<string, unknown>)
  }

  return {
    history,

    async send(input) {
      const run = deps.runs.get(input.runId)
      if (input.thread === 'assistant' && run.status !== 'running') {
        throw new UserError('The Test Assistant is available while the test window is running')
      }
      if (input.caseId && !run.cases.some((item) => item.id === input.caseId)) throw new UserError('Case not found in this run')
      const key = threadKey(input.runId, input.thread)
      if (inFlight.has(key)) throw new UserError('Wait for the current answer before asking another question')

      const codebase = deps.codebases.resolveForAi(input.codebaseId)
      const provider = deps.providers[input.provider]
      const previous = history(input.runId, input.thread)
      const base = { runId: input.runId, thread: input.thread, caseId: input.caseId, provider: input.provider, codebaseId: input.codebaseId }
      insert({ ...base, id: newId(), role: 'user', text: input.question.trim(), usage: null, status: 'done', createdAt: nowIso() })
      const answerId = newId()
      insert({ ...base, id: answerId, role: 'assistant', text: '', usage: null, status: 'pending', createdAt: nowIso() })

      const prompt =
        input.thread === 'ask'
          ? askPrompt({ run, history: previous, question: input.question }, codebase)
          : assistantPrompt({ run, caseId: input.caseId, history: previous, question: input.question }, codebase)

      inFlight.add(key)
      try {
        const result = await executeJob({
          jobs: deps.jobs,
          jobId: input.jobId,
          provider,
          instruction: '',
          prompt,
          codebase,
          output: 'text',
          emit: deps.emit
        })
        return complete(answerId, 'done', result.text || '(empty answer)', result.usage)
      } catch (error) {
        const message = errorMessage(error)
        return complete(answerId, message === 'Cancelled' ? 'cancelled' : 'error', message, null)
      } finally {
        inFlight.delete(key)
      }
    },

    clear(runId, thread) {
      if (inFlight.has(threadKey(runId, thread))) throw new UserError('Wait for the current answer before clearing the chat')
      db.prepare('DELETE FROM chat_messages WHERE run_id = ? AND thread = ?').run(runId, thread)
    },

    markInterrupted() {
      const result = db
        .prepare("UPDATE chat_messages SET status = 'interrupted', text = 'The app closed before this answer finished.' WHERE status = 'pending'")
        .run()
      return Number(result.changes)
    }
  }
}
