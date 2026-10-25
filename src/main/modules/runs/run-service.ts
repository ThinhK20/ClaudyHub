import type { EvidenceLink, ProviderId, ResultState, Run, RunSummary, TestCase } from '@shared/domain'
import { LIMITS, type CaseDraft } from '@shared/schemas'
import { transaction, type Db } from '../../db/connection'
import { UserError } from '../../errors'
import { nowIso } from '../util'
import { allocateCaseNumbers } from './case-ids'
import { createRunRepo, type RunFields, type RunRepo } from './run-repo'
import {
  approvalProblems,
  assertStatus,
  cleanCaseDraft,
  computeOutcome,
  finishProblems,
  nextStatus,
  normalizeEvidence,
  normalizeIssueUrl,
  type RunAction
} from './run-rules'

export interface CreateRunInput {
  title: string
  issueUrl?: string
  analysis?: string
  codebaseId?: string | null
  provider?: ProviderId | null
}

export interface UpdateRunInput {
  id: string
  title?: string
  issueUrl?: string
  analysis?: string
  coverageNote?: string
  codebaseId?: string | null
  provider?: ProviderId | null
}

export interface RecordResultInput {
  runId: string
  caseId: string
  execution: ResultState
  resultNote: string
  evidence: EvidenceLink[]
}

export interface RunServiceDeps {
  /** Case numbers already used by published test cases in the active workspace. */
  workspaceCaseIds: () => ReadonlySet<number>
  activeWorkspaceId: () => string | null
  defaultCodebaseId: () => string | null
  /** Called after a run is deleted so its evidence files can be removed. */
  onRunDeleted?: (runId: string) => void
}

export interface RunService {
  list(): RunSummary[]
  get(id: string): Run
  create(input: CreateRunInput): Run
  update(input: UpdateRunInput): Run
  saveCases(id: string, cases: readonly CaseDraft[]): Run
  addCases(id: string, cases: readonly CaseDraft[]): { run: Run; added: TestCase[] }
  transition(id: string, action: RunAction, reason?: string): Run
  remove(id: string): void
  recordResult(input: RecordResultInput): Run
  removeCase(runId: string, caseId: string): Run
  repo: RunRepo
}

const EDITABLE_CONTENT = ['draft', 'ready'] as const
const OPEN = ['draft', 'ready', 'running'] as const

export function createRunService(db: Db, deps: RunServiceDeps): RunService {
  const repo = createRunRepo(db)

  const get = (id: string): Run => {
    const run = repo.find(id)
    if (!run) throw new UserError('Run not found')
    return run
  }

  const transitionFields = (run: Run, action: RunAction, reason: string): Partial<RunFields> => {
    const now = nowIso()
    switch (action) {
      case 'approve': {
        const problems = approvalProblems(run.cases)
        if (problems.length) throw new UserError(problems.join('\n'))
        const unnumbered = run.cases.filter((item) => item.caseNo === null)
        const used = new Set([...deps.workspaceCaseIds(), repo.maxCaseNo()])
        const numbers = allocateCaseNumbers(unnumbered.length, used)
        repo.setCaseNumbers(unnumbered.map((item, index) => ({ caseId: item.id, caseNo: numbers[index] as number })))
        return { reviewedAt: now }
      }
      case 'reopen':
        return { reviewedAt: null }
      case 'start':
        return { startedAt: now }
      case 'reject':
        if (!reason.trim()) throw new UserError('Give a reason for rejecting the run')
        return { rejectionReason: reason.trim(), rejectedAt: now }
      case 'finish': {
        const problems = finishProblems(run.cases)
        if (problems.length) throw new UserError(problems.join('\n'))
        return { completedAt: now, outcome: computeOutcome(run.cases) }
      }
    }
  }

  return {
    repo,
    list: () => repo.listSummaries(),
    get,

    create(input) {
      const id = repo.insertRun({
        workspaceId: deps.activeWorkspaceId(),
        codebaseId: input.codebaseId === undefined ? deps.defaultCodebaseId() : input.codebaseId,
        provider: input.provider ?? null,
        title: input.title.trim(),
        issueUrl: normalizeIssueUrl(input.issueUrl),
        analysis: (input.analysis ?? '').trim(),
        coverageNote: '',
        status: 'draft',
        outcome: null,
        rejectionReason: '',
        reviewedAt: null,
        startedAt: null,
        completedAt: null,
        rejectedAt: null
      })
      return get(id)
    },

    update(input) {
      const run = get(input.id)
      const changesContent = [input.title, input.issueUrl, input.analysis, input.coverageNote].some((value) => value !== undefined)
      if (changesContent) assertStatus(run.status, EDITABLE_CONTENT, 'Editing the run details')
      assertStatus(run.status, OPEN, 'Changing the run')
      repo.updateRun(input.id, {
        title: input.title?.trim(),
        issueUrl: input.issueUrl === undefined ? undefined : normalizeIssueUrl(input.issueUrl),
        analysis: input.analysis?.trim(),
        coverageNote: input.coverageNote?.trim(),
        codebaseId: input.codebaseId,
        provider: input.provider
      })
      return get(input.id)
    },

    saveCases(id, cases) {
      assertStatus(get(id).status, ['draft'], 'Editing cases')
      if (cases.length > LIMITS.maxCases) throw new UserError(`A run can contain at most ${LIMITS.maxCases} cases`)
      transaction(db, () => repo.replaceCases(id, cases.map(cleanCaseDraft)))
      return get(id)
    },

    addCases(id, cases) {
      const run = get(id)
      assertStatus(run.status, ['draft'], 'Adding cases')
      if (run.cases.length + cases.length > LIMITS.maxCases) {
        throw new UserError(`A run can contain at most ${LIMITS.maxCases} cases`)
      }
      const ids = transaction(db, () => repo.appendCases(id, cases.map(cleanCaseDraft)))
      const updated = get(id)
      return { run: updated, added: updated.cases.filter((item) => ids.includes(item.id)) }
    },

    transition(id, action, reason = '') {
      const run = get(id)
      const status = nextStatus(run.status, action)
      transaction(db, () => repo.updateRun(id, { status, ...transitionFields(run, action, reason) }))
      return get(id)
    },

    remove(id) {
      get(id)
      repo.deleteRun(id)
      deps.onRunDeleted?.(id)
    },

    recordResult(input) {
      const run = get(input.runId)
      assertStatus(run.status, ['running'], 'Recording results')
      if (!run.cases.some((item) => item.id === input.caseId)) throw new UserError('Case not found in this run')
      repo.recordResult(input.runId, input.caseId, {
        execution: input.execution,
        resultNote: input.resultNote.trim(),
        evidence: normalizeEvidence(input.evidence)
      })
      return get(input.runId)
    },

    removeCase(runId, caseId) {
      const run = get(runId)
      assertStatus(run.status, ['running'], 'Removing a case from the test window')
      if (!run.cases.some((item) => item.id === caseId)) throw new UserError('Case not found in this run')
      if (run.cases.length <= 1) throw new UserError('Keep at least one case in the test window; delete the run instead')
      repo.deleteCase(runId, caseId)
      return get(runId)
    }
  }
}
