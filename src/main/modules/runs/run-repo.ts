import type {
  Attachment,
  EvidenceLink,
  Execution,
  Outcome,
  ProviderId,
  Run,
  RunStatus,
  RunSummary,
  TestCase
} from '@shared/domain'
import type { CaseDraft } from '@shared/schemas'
import type { Db } from '../../db/connection'
import { newId, nowIso, parseJson, textOrNull } from '../util'

export interface RunFields {
  workspaceId: string | null
  codebaseId: string | null
  provider: ProviderId | null
  title: string
  issueUrl: string
  analysis: string
  coverageNote: string
  status: RunStatus
  outcome: Outcome | null
  rejectionReason: string
  reviewedAt: string | null
  startedAt: string | null
  completedAt: string | null
  rejectedAt: string | null
}

const RUN_COLUMNS: Record<keyof RunFields, string> = {
  workspaceId: 'workspace_id',
  codebaseId: 'codebase_id',
  provider: 'provider',
  title: 'title',
  issueUrl: 'issue_url',
  analysis: 'analysis',
  coverageNote: 'coverage_note',
  status: 'status',
  outcome: 'outcome',
  rejectionReason: 'rejection_reason',
  reviewedAt: 'reviewed_at',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  rejectedAt: 'rejected_at'
}

export interface NewAttachment {
  id: string
  caseId: string
  runId: string
  name: string
  mime: string
  size: number
  storageKey: string
}

function toSummary(row: Record<string, unknown>): RunSummary {
  return {
    id: String(row.id),
    workspaceId: textOrNull(row.workspace_id),
    codebaseId: textOrNull(row.codebase_id),
    provider: textOrNull(row.provider) as ProviderId | null,
    title: String(row.title),
    issueUrl: String(row.issue_url),
    status: String(row.status) as RunStatus,
    outcome: textOrNull(row.outcome) as Outcome | null,
    caseCount: Number(row.case_count ?? 0),
    executedCount: Number(row.executed_count ?? 0),
    executions: row.executions ? (String(row.executions).split(',') as Execution[]) : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function toAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    name: String(row.name),
    mime: String(row.mime),
    size: Number(row.size),
    uploadedAt: String(row.uploaded_at)
  }
}

function toCase(row: Record<string, unknown>, attachments: Attachment[]): TestCase {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    caseNo: row.case_no === null ? null : Number(row.case_no),
    title: String(row.title),
    summary: String(row.summary),
    preconditions: parseJson<string[]>(String(row.preconditions_json), []),
    steps: parseJson(String(row.steps_json), []),
    previousBehavior: String(row.previous_behavior),
    expectedBehavior: String(row.expected_behavior),
    priority: row.priority === 'high' ? 'high' : '',
    position: Number(row.position),
    execution: String(row.execution) as Execution,
    resultNote: String(row.result_note),
    executedAt: textOrNull(row.executed_at),
    evidence: parseJson<EvidenceLink[]>(String(row.evidence_json), []),
    attachments
  }
}

const SUMMARY_SELECT = `
  SELECT r.*,
    (SELECT COUNT(*) FROM cases c WHERE c.run_id = r.id) AS case_count,
    (SELECT COUNT(*) FROM cases c WHERE c.run_id = r.id AND c.execution <> 'not-run') AS executed_count,
    (SELECT group_concat(execution, ',') FROM (SELECT execution FROM cases c WHERE c.run_id = r.id ORDER BY position)) AS executions
  FROM runs r`

/** SQL access for runs, cases and attachment records. Business rules live in run-service. */
export function createRunRepo(db: Db) {
  const touch = (runId: string): void => {
    db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?').run(nowIso(), runId)
  }

  const casesFor = (runId: string): TestCase[] => {
    const attachments = db
      .prepare('SELECT * FROM attachments WHERE run_id = ? ORDER BY uploaded_at')
      .all(runId)
      .map(toAttachment)
    return db
      .prepare('SELECT * FROM cases WHERE run_id = ? ORDER BY position')
      .all(runId)
      .map((row) => toCase(row, attachments.filter((item) => item.caseId === String(row.id))))
  }

  const writeCase = (runId: string, draft: CaseDraft, position: number, id: string): void => {
    db.prepare(
      `INSERT INTO cases (id, run_id, title, summary, preconditions_json, steps_json, previous_behavior, expected_behavior,
                          priority, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
         preconditions_json = excluded.preconditions_json, steps_json = excluded.steps_json,
         previous_behavior = excluded.previous_behavior, expected_behavior = excluded.expected_behavior,
         priority = excluded.priority, position = excluded.position`
    ).run(
      id,
      runId,
      draft.title,
      draft.summary,
      JSON.stringify(draft.preconditions),
      JSON.stringify(draft.steps),
      draft.previousBehavior,
      draft.expectedBehavior,
      draft.priority,
      position,
      nowIso()
    )
  }

  return {
    listSummaries(): RunSummary[] {
      return db.prepare(`${SUMMARY_SELECT} ORDER BY r.updated_at DESC`).all().map(toSummary)
    },

    find(id: string): Run | null {
      const row = db.prepare(`${SUMMARY_SELECT} WHERE r.id = ?`).get(id)
      if (!row) return null
      return {
        ...toSummary(row),
        analysis: String(row.analysis),
        coverageNote: String(row.coverage_note),
        rejectionReason: String(row.rejection_reason),
        reviewedAt: textOrNull(row.reviewed_at),
        startedAt: textOrNull(row.started_at),
        completedAt: textOrNull(row.completed_at),
        rejectedAt: textOrNull(row.rejected_at),
        cases: casesFor(id)
      }
    },

    insertRun(fields: RunFields, id: string = newId(), createdAt: string = nowIso()): string {
      const keys = Object.keys(RUN_COLUMNS) as (keyof RunFields)[]
      const columns = ['id', ...keys.map((key) => RUN_COLUMNS[key]), 'created_at', 'updated_at']
      db.prepare(`INSERT INTO runs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
        id,
        ...keys.map((key) => fields[key]),
        createdAt,
        createdAt
      )
      return id
    },

    updateRun(id: string, fields: Partial<RunFields>): void {
      const entries = Object.entries(fields).filter(([, value]) => value !== undefined) as [keyof RunFields, unknown][]
      if (!entries.length) return
      const assignments = entries.map(([key]) => `${RUN_COLUMNS[key]} = ?`).join(', ')
      db.prepare(`UPDATE runs SET ${assignments}, updated_at = ? WHERE id = ?`).run(
        ...(entries.map(([, value]) => value) as (string | null)[]),
        nowIso(),
        id
      )
    },

    deleteRun(id: string): void {
      db.prepare('DELETE FROM runs WHERE id = ?').run(id)
    },

    /** Replaces a draft's case list: keeps ids that already belong to the run, deletes cases no longer listed. */
    replaceCases(runId: string, drafts: readonly CaseDraft[]): void {
      const existing = new Set(casesFor(runId).map((item) => item.id))
      const ids = drafts.map((draft) => (draft.id && existing.has(draft.id) ? draft.id : newId()))
      const keep = new Set(ids)
      for (const id of existing) if (!keep.has(id)) db.prepare('DELETE FROM cases WHERE id = ?').run(id)
      drafts.forEach((draft, index) => writeCase(runId, draft, index, ids[index] as string))
      touch(runId)
    },

    appendCases(runId: string, drafts: readonly CaseDraft[]): string[] {
      const row = db.prepare('SELECT COALESCE(MAX(position), -1) AS last FROM cases WHERE run_id = ?').get(runId)
      const start = Number(row?.last ?? -1) + 1
      const ids = drafts.map(() => newId())
      drafts.forEach((draft, index) => writeCase(runId, draft, start + index, ids[index] as string))
      touch(runId)
      return ids
    },

    setCaseNumbers(assignments: readonly { caseId: string; caseNo: number }[]): void {
      for (const { caseId, caseNo } of assignments) {
        db.prepare('UPDATE cases SET case_no = ? WHERE id = ?').run(caseNo, caseId)
      }
    },

    maxCaseNo(): number {
      const row = db.prepare('SELECT COALESCE(MAX(case_no), 0) AS max FROM cases').get()
      return Number(row?.max ?? 0)
    },

    recordResult(
      runId: string,
      caseId: string,
      result: { execution: Execution; resultNote: string; evidence: EvidenceLink[] }
    ): void {
      db.prepare('UPDATE cases SET execution = ?, result_note = ?, evidence_json = ?, executed_at = ? WHERE id = ? AND run_id = ?').run(
        result.execution,
        result.resultNote,
        JSON.stringify(result.evidence),
        nowIso(),
        caseId,
        runId
      )
      touch(runId)
    },

    deleteCase(runId: string, caseId: string): void {
      db.prepare('DELETE FROM cases WHERE id = ? AND run_id = ?').run(caseId, runId)
      touch(runId)
    },

    insertAttachment(attachment: NewAttachment): Attachment {
      const uploadedAt = nowIso()
      db.prepare(
        'INSERT INTO attachments (id, case_id, run_id, name, mime, size, storage_key, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(attachment.id, attachment.caseId, attachment.runId, attachment.name, attachment.mime, attachment.size, attachment.storageKey, uploadedAt)
      touch(attachment.runId)
      return { id: attachment.id, caseId: attachment.caseId, name: attachment.name, mime: attachment.mime, size: attachment.size, uploadedAt }
    },

    findAttachment(runId: string, attachmentId: string): (Attachment & { storageKey: string }) | null {
      const row = db.prepare('SELECT * FROM attachments WHERE id = ? AND run_id = ?').get(attachmentId, runId)
      return row ? { ...toAttachment(row), storageKey: String(row.storage_key) } : null
    },

    deleteAttachment(runId: string, attachmentId: string): void {
      db.prepare('DELETE FROM attachments WHERE id = ? AND run_id = ?').run(attachmentId, runId)
      touch(runId)
    },

    countAttachments(runId: string, caseId?: string): number {
      const row = caseId
        ? db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE run_id = ? AND case_id = ?').get(runId, caseId)
        : db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE run_id = ?').get(runId)
      return Number(row?.n ?? 0)
    }
  }
}

export type RunRepo = ReturnType<typeof createRunRepo>
