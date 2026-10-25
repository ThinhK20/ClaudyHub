import type { EvidenceLink, Execution, Outcome, RunStatus } from '@shared/domain'
import { LIMITS, type CaseDraft } from '@shared/schemas'
import { UserError } from '../../errors'

export type RunAction = 'approve' | 'reopen' | 'start' | 'reject' | 'finish'

// Run lifecycle, as in qa-portal: draft → ready → running → completed, with reject from draft/ready.
const TRANSITIONS: Record<RunAction, { from: readonly RunStatus[]; to: RunStatus }> = {
  approve: { from: ['draft'], to: 'ready' },
  reopen: { from: ['ready'], to: 'draft' },
  start: { from: ['ready'], to: 'running' },
  reject: { from: ['draft', 'ready'], to: 'rejected' },
  finish: { from: ['running'], to: 'completed' }
}

export function nextStatus(status: RunStatus, action: RunAction): RunStatus {
  const rule = TRANSITIONS[action]
  if (!rule.from.includes(status)) throw new UserError(`Cannot ${action} a run that is ${status}`)
  return rule.to
}

export function assertStatus(status: RunStatus, allowed: readonly RunStatus[], what: string): void {
  if (!allowed.includes(status)) throw new UserError(`${what} is not possible while the run is ${status}`)
}

/** Trims every field and drops blank preconditions and fully blank steps. Returns a new object. */
export function cleanCaseDraft(draft: CaseDraft): CaseDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    previousBehavior: draft.previousBehavior.trim(),
    expectedBehavior: draft.expectedBehavior.trim(),
    preconditions: draft.preconditions.map((item) => item.trim()).filter(Boolean),
    steps: draft.steps
      .map((step) => ({ detail: step.detail.trim(), expected: step.expected.trim() }))
      .filter((step) => step.detail || step.expected)
  }
}

/** What prevents one case from being approved, mirroring qa-portal's validateCase requirements. */
export function caseProblems(draft: CaseDraft, index: number): string[] {
  const label = `Case ${index + 1}${draft.title ? ` (${draft.title})` : ''}`
  const problems: string[] = []
  if (!draft.title) problems.push(`${label}: add a title`)
  if (!draft.summary) problems.push(`${label}: add a summary`)
  if (!draft.previousBehavior) problems.push(`${label}: describe the previous behavior`)
  if (!draft.expectedBehavior) problems.push(`${label}: describe the expected behavior`)
  if (!draft.steps.length) problems.push(`${label}: add at least one step`)
  draft.steps.forEach((step, stepIndex) => {
    if (!step.detail || !step.expected) problems.push(`${label}: step ${stepIndex + 1} needs both an action and an expected result`)
  })
  return problems
}

export function approvalProblems(cases: readonly CaseDraft[]): string[] {
  if (!cases.length) return ['Add at least one test case']
  if (cases.length > LIMITS.maxCases) return [`A run can contain at most ${LIMITS.maxCases} cases`]
  return cases.flatMap((item, index) => caseProblems(cleanCaseDraft(item), index))
}

export function finishProblems(cases: readonly { title: string; execution: Execution }[]): string[] {
  const missing = cases.filter((item) => item.execution === 'not-run')
  return missing.length ? [`Record a result for every case (${missing.length} remaining)`] : []
}

export function computeOutcome(cases: readonly { execution: Execution }[]): Outcome {
  if (cases.some((item) => item.execution === 'failed')) return 'failed'
  if (cases.some((item) => item.execution === 'blocked')) return 'blocked'
  return 'passed'
}

/** Port of qa-portal normalizeEvidenceLinks: http(s) only, parentheses escaped for Markdown, max 10. */
export function normalizeEvidence(links: readonly EvidenceLink[]): EvidenceLink[] {
  return links.slice(0, LIMITS.evidenceLinks).flatMap((link) => {
    try {
      const url = new URL(link.url.trim())
      if (!['http:', 'https:'].includes(url.protocol)) return []
      return [{ url: url.href.replaceAll('(', '%28').replaceAll(')', '%29'), label: link.label.trim().slice(0, LIMITS.evidenceLabel) }]
    } catch {
      return []
    }
  })
}

export function normalizeIssueUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (['http:', 'https:'].includes(url.protocol)) return url.href
  } catch {
    // fall through
  }
  throw new UserError('Issue link must be an http(s) URL')
}
