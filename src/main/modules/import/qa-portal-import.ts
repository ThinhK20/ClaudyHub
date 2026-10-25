import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ChatThread, Execution, ImportSummary, Outcome, RunStatus } from '@shared/domain'
import { transaction, type Db } from '../../db/connection'
import { UserError } from '../../errors'
import { isInside } from '../fs-paths'
import { newId, nowIso } from '../util'

// Lenient views of qa-portal's .data files: unknown fields are ignored, missing ones get defaults.
const text = z.string().catch('')
const legacyCase = z.object({
  id: z.string(),
  title: text,
  summary: text,
  preconditions: z.array(z.string()).catch([]),
  steps: z.array(z.object({ detail: text, expected: text })).catch([]),
  previousBehavior: text,
  expectedBehavior: text,
  priority: text,
  execution: z.enum(['not-run', 'passed', 'failed', 'blocked']).catch('not-run'),
  resultNote: text,
  executedAt: z.string().nullable().catch(null),
  evidence: z.array(z.object({ url: z.string(), label: text })).catch([]),
  attachments: z
    .array(z.object({ id: z.string(), name: text, type: text, size: z.number().catch(0), storageKey: z.string(), uploadedAt: text }))
    .catch([])
})
const legacyRun = z.object({
  id: z.string().uuid(),
  issueUrl: text,
  issueNumber: z.number().nullable().catch(null),
  title: text,
  analysis: text,
  coverageNote: text,
  status: z.enum(['draft', 'ready', 'running', 'completed', 'rejected']).catch('draft'),
  outcome: z.enum(['passed', 'failed', 'blocked']).nullable().catch(null),
  rejectionReason: text,
  createdAt: z.string().catch(() => nowIso()),
  updatedAt: z.string().catch(() => nowIso()),
  reviewedAt: z.string().nullable().catch(null),
  startedAt: z.string().nullable().catch(null),
  completedAt: z.string().nullable().catch(null),
  rejectedAt: z.string().nullable().catch(null),
  cases: z.array(z.unknown()).catch([])
})
const legacyChat = z.array(
  z.object({ role: z.string(), text: z.string(), at: z.string().catch(() => nowIso()), caseId: z.string().nullable().optional() })
)

async function readJson(file: string): Promise<unknown> {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new UserError(`Cannot read ${path.basename(file)}: it is not valid JSON`)
  }
}

/**
 * One-shot import of a qa-portal `.data` folder: runs, cases, results, evidence files, Test Assistant chats and
 * Ask AI chats. Runs whose id already exists are skipped, so the import can be repeated safely.
 */
export async function importQaPortalData(options: {
  db: Db
  dataDir: string
  evidenceRoot: string
  workspaceId: string | null
}): Promise<ImportSummary> {
  const { db, dataDir, evidenceRoot } = options
  const raw = await readJson(path.join(dataDir, 'runs.json'))
  if (!Array.isArray(raw)) throw new UserError('No runs.json found in that folder. Choose qa-portal/.data.')
  const ticketChats = ((await readJson(path.join(dataDir, 'ticket-chats.json'))) ?? {}) as Record<string, unknown>
  const summary: ImportSummary = { runs: 0, cases: 0, attachments: 0, chatMessages: 0, skipped: [] }
  const copies: { from: string; to: string }[] = []

  for (const item of raw) {
    const parsed = legacyRun.safeParse(item)
    if (!parsed.success) {
      summary.skipped.push('A run with an unreadable shape')
      continue
    }
    const run = parsed.data
    if (db.prepare('SELECT 1 FROM runs WHERE id = ?').get(run.id)) {
      summary.skipped.push(`${run.title || run.id} (already imported)`)
      continue
    }
    const runChat = legacyChat.safeParse(await readJson(path.join(dataDir, 'evidence', run.id, 'chat.json')))
    const askChat = legacyChat.safeParse(run.issueNumber === null ? null : ticketChats[String(run.issueNumber)])

    transaction(db, () => {
      db.prepare(
        `INSERT INTO runs (id, workspace_id, codebase_id, provider, title, issue_url, analysis, coverage_note, status, outcome,
           rejection_reason, created_at, updated_at, reviewed_at, started_at, completed_at, rejected_at)
         VALUES (?, ?, NULL, 'copilot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        run.id,
        options.workspaceId,
        run.title || `Run ${run.id.slice(0, 8)}`,
        run.issueUrl,
        run.analysis,
        run.coverageNote,
        run.status satisfies RunStatus,
        run.outcome satisfies Outcome | null,
        run.rejectionReason,
        run.createdAt,
        run.updatedAt,
        run.reviewedAt,
        run.startedAt,
        run.completedAt,
        run.rejectedAt
      )
      const caseIds = new Map<string, string>()
      run.cases.forEach((rawCase, position) => {
        const parsedCase = legacyCase.safeParse(rawCase)
        if (!parsedCase.success) return
        const testCase = parsedCase.data
        const id = newId()
        caseIds.set(testCase.id, id)
        db.prepare(
          `INSERT INTO cases (id, run_id, case_no, title, summary, preconditions_json, steps_json, previous_behavior,
             expected_behavior, priority, position, execution, result_note, evidence_json, executed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          run.id,
          /^\d{1,6}$/.test(testCase.id) ? Number(testCase.id) : null,
          testCase.title,
          testCase.summary,
          JSON.stringify(testCase.preconditions),
          JSON.stringify(testCase.steps),
          testCase.previousBehavior,
          testCase.expectedBehavior,
          testCase.priority === 'high' ? 'high' : '',
          position,
          testCase.execution satisfies Execution,
          testCase.resultNote,
          JSON.stringify(testCase.evidence.slice(0, 10)),
          testCase.executedAt,
          run.createdAt
        )
        summary.cases++
        for (const attachment of testCase.attachments) {
          const from = path.resolve(dataDir, 'evidence', ...attachment.storageKey.split('/'))
          if (!isInside(path.join(dataDir, 'evidence'), from) || !existsSync(from)) continue
          const storageKey = `${attachment.id}${path.extname(from)}`
          db.prepare(
            'INSERT INTO attachments (id, case_id, run_id, name, mime, size, storage_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(newId(), id, run.id, attachment.name || storageKey, attachment.type, attachment.size, storageKey, attachment.uploadedAt || nowIso())
          copies.push({ from, to: path.join(evidenceRoot, run.id, storageKey) })
          summary.attachments++
        }
      })
      const insertChat = (thread: ChatThread, messages: z.infer<typeof legacyChat>): void => {
        for (const message of messages) {
          db.prepare(
            `INSERT INTO chat_messages (id, run_id, thread, case_id, role, text, provider, codebase_id, usage_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'copilot', NULL, NULL, 'done', ?)`
          ).run(
            newId(),
            run.id,
            thread,
            message.caseId ? (caseIds.get(message.caseId) ?? null) : null,
            message.role === 'ai' ? 'assistant' : 'user',
            message.text,
            message.at
          )
          summary.chatMessages++
        }
      }
      if (runChat.success) insertChat('assistant', runChat.data)
      if (askChat.success) insertChat('ask', askChat.data)
      summary.runs++
    })
  }

  for (const { from, to } of copies) {
    await mkdir(path.dirname(to), { recursive: true })
    await copyFile(from, to)
  }
  return summary
}
