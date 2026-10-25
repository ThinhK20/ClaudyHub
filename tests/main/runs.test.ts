import { describe, expect, it } from 'vitest'
import { allocateCaseNumbers, formatCaseNumber } from '../../src/main/modules/runs/case-ids'
import {
  approvalProblems,
  cleanCaseDraft,
  computeOutcome,
  finishProblems,
  nextStatus,
  normalizeEvidence,
  normalizeIssueUrl
} from '../../src/main/modules/runs/run-rules'
import { createRunService, type RunService } from '../../src/main/modules/runs/run-service'
import { completeCase, memoryDb } from '../helpers'

describe('run rules', () => {
  it('follows the draft → ready → running → completed lifecycle', () => {
    expect(nextStatus('draft', 'approve')).toBe('ready')
    expect(nextStatus('ready', 'reopen')).toBe('draft')
    expect(nextStatus('ready', 'start')).toBe('running')
    expect(nextStatus('running', 'finish')).toBe('completed')
    expect(nextStatus('draft', 'reject')).toBe('rejected')
  })

  it('refuses transitions from the wrong status', () => {
    expect(() => nextStatus('draft', 'start')).toThrow('Cannot start a run that is draft')
    expect(() => nextStatus('completed', 'reject')).toThrow()
  })

  it('lists what blocks approval', () => {
    expect(approvalProblems([])).toEqual(['Add at least one test case'])
    const problems = approvalProblems([
      completeCase({ title: '', previousBehavior: '', steps: [{ detail: 'Click', expected: '' }] })
    ])
    expect(problems).toEqual([
      'Case 1: add a title',
      'Case 1: describe the previous behavior',
      'Case 1: step 1 needs both an action and an expected result'
    ])
    expect(approvalProblems([completeCase()])).toEqual([])
  })

  it('rejects more than the maximum number of cases', () => {
    expect(approvalProblems(Array.from({ length: 41 }, () => completeCase()))).toEqual(['A run can contain at most 40 cases'])
  })

  it('cleans drafts without mutating the input', () => {
    const draft = completeCase({ title: '  Padded  ', preconditions: ['  a ', ' '], steps: [{ detail: ' ', expected: '' }] })
    const cleaned = cleanCaseDraft(draft)
    expect(cleaned.title).toBe('Padded')
    expect(cleaned.preconditions).toEqual(['a'])
    expect(cleaned.steps).toEqual([])
    expect(draft.title).toBe('  Padded  ')
  })

  it('computes the outcome with failed taking precedence over blocked', () => {
    expect(computeOutcome([{ execution: 'passed' }, { execution: 'blocked' }, { execution: 'failed' }])).toBe('failed')
    expect(computeOutcome([{ execution: 'passed' }, { execution: 'blocked' }])).toBe('blocked')
    expect(computeOutcome([{ execution: 'passed' }])).toBe('passed')
  })

  it('requires every case to have a result before finishing', () => {
    expect(finishProblems([{ title: 'a', execution: 'not-run' }])).toEqual(['Record a result for every case (1 remaining)'])
    expect(finishProblems([{ title: 'a', execution: 'passed' }])).toEqual([])
  })

  it('keeps only http(s) evidence links and escapes parentheses', () => {
    expect(
      normalizeEvidence([
        { url: 'https://example.com/a(1).png', label: ' shot ' },
        { url: 'javascript:alert(1)', label: '' },
        { url: 'not a url', label: '' }
      ])
    ).toEqual([{ url: 'https://example.com/a%281%29.png', label: 'shot' }])
  })

  it('validates issue links', () => {
    expect(normalizeIssueUrl('')).toBe('')
    expect(normalizeIssueUrl(' https://github.com/org/repo/issues/1 ')).toBe('https://github.com/org/repo/issues/1')
    expect(() => normalizeIssueUrl('ftp://x')).toThrow('Issue link must be an http(s) URL')
  })
})

describe('case numbers', () => {
  it('allocates above every used number', () => {
    expect(allocateCaseNumbers(3, new Set([5, 120, 7]))).toEqual([121, 122, 123])
    expect(allocateCaseNumbers(1, new Set())).toEqual([1])
  })

  it('formats as six digits', () => {
    expect(formatCaseNumber(42)).toBe('000042')
    expect(formatCaseNumber(null)).toBe('new')
  })
})

describe('run service', () => {
  const setup = (workspaceIds: number[] = [100]): { service: RunService; deleted: string[] } => {
    const deleted: string[] = []
    const service = createRunService(memoryDb(), {
      workspaceCaseIds: () => new Set(workspaceIds),
      activeWorkspaceId: () => null,
      defaultCodebaseId: () => null,
      onRunDeleted: (id) => deleted.push(id)
    })
    return { service, deleted }
  }

  it('runs the full lifecycle and computes the outcome', () => {
    const { service } = setup()
    const created = service.create({ title: 'Settings fix', issueUrl: 'https://github.com/o/r/issues/9', provider: 'claude' })
    expect(created.status).toBe('draft')
    expect(created.provider).toBe('claude')

    const drafted = service.saveCases(created.id, [completeCase(), completeCase({ title: 'Second' })])
    expect(drafted.cases.map((item) => item.title)).toEqual(['Save valid settings', 'Second'])

    const approved = service.transition(created.id, 'approve')
    expect(approved.status).toBe('ready')
    expect(approved.cases.map((item) => item.caseNo)).toEqual([101, 102])

    const running = service.transition(created.id, 'start')
    expect(running.startedAt).not.toBeNull()
    const [first, second] = running.cases
    service.recordResult({ runId: created.id, caseId: first!.id, execution: 'passed', resultNote: ' ok ', evidence: [] })
    expect(() => service.transition(created.id, 'finish')).toThrow('Record a result for every case (1 remaining)')
    const recorded = service.recordResult({
      runId: created.id,
      caseId: second!.id,
      execution: 'blocked',
      resultNote: 'env down',
      evidence: [{ url: 'https://example.com/shot.png', label: '' }]
    })
    expect(recorded.executedCount).toBe(2)
    expect(recorded.cases[0]!.resultNote).toBe('ok')

    const completed = service.transition(created.id, 'finish')
    expect(completed.status).toBe('completed')
    expect(completed.outcome).toBe('blocked')
    expect(() => service.recordResult({ runId: created.id, caseId: first!.id, execution: 'failed', resultNote: '', evidence: [] })).toThrow(
      'Recording results is not possible while the run is completed'
    )
  })

  it('keeps case numbers when a ready run is reopened and approved again', () => {
    const { service } = setup()
    const run = service.create({ title: 'Reopen' })
    service.saveCases(run.id, [completeCase()])
    const first = service.transition(run.id, 'approve').cases[0]!.caseNo
    service.transition(run.id, 'reopen')
    expect(service.transition(run.id, 'approve').cases[0]!.caseNo).toBe(first)
  })

  it('numbers new cases above existing database cases', () => {
    const { service } = setup([])
    const a = service.create({ title: 'A' })
    service.saveCases(a.id, [completeCase()])
    service.transition(a.id, 'approve')
    const b = service.create({ title: 'B' })
    service.saveCases(b.id, [completeCase()])
    expect(service.transition(b.id, 'approve').cases[0]!.caseNo).toBe(2)
  })

  it('keeps case ids when saving and removes cases no longer listed', () => {
    const { service } = setup()
    const run = service.create({ title: 'Edit' })
    const saved = service.saveCases(run.id, [completeCase({ title: 'Keep' }), completeCase({ title: 'Drop' })])
    const keep = saved.cases[0]!
    const resaved = service.saveCases(run.id, [{ ...completeCase({ title: 'Kept and renamed' }), id: keep.id }])
    expect(resaved.cases).toHaveLength(1)
    expect(resaved.cases[0]!.id).toBe(keep.id)
    expect(resaved.cases[0]!.title).toBe('Kept and renamed')
  })

  it('blocks approval with incomplete cases and rejection without a reason', () => {
    const { service } = setup()
    const run = service.create({ title: 'Incomplete' })
    service.saveCases(run.id, [completeCase({ summary: '' })])
    expect(() => service.transition(run.id, 'approve')).toThrow('add a summary')
    expect(() => service.transition(run.id, 'reject', '  ')).toThrow('Give a reason')
    const rejected = service.transition(run.id, 'reject', 'Duplicate')
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionReason).toBe('Duplicate')
  })

  it('restricts edits by status', () => {
    const { service } = setup()
    const run = service.create({ title: 'Locked' })
    service.saveCases(run.id, [completeCase()])
    service.transition(run.id, 'approve')
    service.transition(run.id, 'start')
    expect(() => service.saveCases(run.id, [completeCase()])).toThrow('Editing cases is not possible while the run is running')
    expect(() => service.update({ id: run.id, title: 'New' })).toThrow('Editing the run details')
    expect(service.update({ id: run.id, provider: 'copilot' }).provider).toBe('copilot')
    expect(() => service.addCases(run.id, [completeCase()])).toThrow('Adding cases')
  })

  it('adds cases to a draft and reports which were added', () => {
    const { service } = setup()
    const run = service.create({ title: 'Add' })
    service.saveCases(run.id, [completeCase({ title: 'Existing' })])
    const { run: updated, added } = service.addCases(run.id, [completeCase({ title: 'From AI' })])
    expect(updated.cases.map((item) => item.title)).toEqual(['Existing', 'From AI'])
    expect(added.map((item) => item.title)).toEqual(['From AI'])
  })

  it('removes a case from a running window but keeps at least one', () => {
    const { service } = setup()
    const run = service.create({ title: 'Remove' })
    service.saveCases(run.id, [completeCase(), completeCase({ title: 'Second' })])
    service.transition(run.id, 'approve')
    const running = service.transition(run.id, 'start')
    const afterRemove = service.removeCase(run.id, running.cases[1]!.id)
    expect(afterRemove.cases).toHaveLength(1)
    expect(() => service.removeCase(run.id, afterRemove.cases[0]!.id)).toThrow('Keep at least one case')
  })

  it('lists summaries and deletes runs', () => {
    const { service, deleted } = setup()
    const run = service.create({ title: 'Listed', analysis: '  details ' })
    expect(service.get(run.id).analysis).toBe('details')
    expect(service.list().map((item) => item.title)).toEqual(['Listed'])
    service.remove(run.id)
    expect(service.list()).toEqual([])
    expect(deleted).toEqual([run.id])
    expect(() => service.get(run.id)).toThrow('Run not found')
  })
})
