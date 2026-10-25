import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importQaPortalData } from '../../src/main/modules/import/qa-portal-import'
import { createRunService } from '../../src/main/modules/runs/run-service'
import { PNG_BYTES, memoryDb, tempDir, writeFiles } from '../helpers'

const RUN_ID = '11111111-2222-4333-8444-555555555555'

const legacyRuns = [
  {
    id: RUN_ID,
    issueUrl: 'https://github.com/org/repo/issues/42',
    issueNumber: 42,
    title: 'Legacy run',
    analysis: 'Old analysis',
    status: 'completed',
    outcome: 'failed',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z',
    completedAt: '2026-05-02T10:00:00.000Z',
    cases: [
      {
        id: '000321',
        title: 'Legacy case',
        summary: 'Summary',
        preconditions: ['Pre'],
        steps: [{ detail: 'Do', expected: 'See' }],
        previousBehavior: 'Before',
        expectedBehavior: 'After',
        priority: 'high',
        execution: 'failed',
        resultNote: 'Broke',
        evidence: [{ url: 'https://example.com/a', label: 'A' }],
        attachments: [{ id: 'att1', name: 'shot.png', type: 'image/png', size: 12, storageKey: `${RUN_ID}/att1.png`, uploadedAt: '2026-05-02T09:00:00.000Z' }]
      },
      { id: 'draft-x', title: 'Unnumbered', steps: 'not-an-array' }
    ]
  },
  { id: 'not-a-uuid' }
]

describe('qa-portal import', () => {
  let dataDir: string
  let evidenceRoot: string

  beforeEach(async () => {
    dataDir = await tempDir('qa-portal-data-')
    evidenceRoot = await tempDir('qa-hub-evidence-')
    await writeFiles(dataDir, {
      'runs.json': JSON.stringify(legacyRuns),
      [`evidence/${RUN_ID}/chat.json`]: JSON.stringify([
        { role: 'user', text: 'Why failed?', at: '2026-05-02T09:30:00.000Z', caseId: '000321' },
        { role: 'ai', text: 'Because.', at: '2026-05-02T09:31:00.000Z', caseId: '000321' }
      ]),
      'ticket-chats.json': JSON.stringify({ 42: [{ role: 'user', text: 'Ticket question', at: '2026-05-01T11:00:00.000Z' }] })
    })
    await writeFile(path.join(dataDir, 'evidence', RUN_ID, 'att1.png'), PNG_BYTES)
  })
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
    await rm(evidenceRoot, { recursive: true, force: true })
  })

  it('imports runs, cases, evidence and chats once', async () => {
    const db = memoryDb()
    const summary = await importQaPortalData({ db, dataDir, evidenceRoot, workspaceId: null })
    expect(summary).toEqual({ runs: 1, cases: 2, attachments: 1, chatMessages: 3, skipped: ['A run with an unreadable shape'] })

    const runs = createRunService(db, { workspaceCaseIds: () => new Set(), activeWorkspaceId: () => null, defaultCodebaseId: () => null })
    const run = runs.get(RUN_ID)
    expect(run).toMatchObject({ title: 'Legacy run', status: 'completed', outcome: 'failed', issueUrl: 'https://github.com/org/repo/issues/42' })
    expect(run.cases[0]).toMatchObject({ caseNo: 321, execution: 'failed', priority: 'high', resultNote: 'Broke' })
    expect(run.cases[1]).toMatchObject({ caseNo: null, title: 'Unnumbered', steps: [] })
    expect(run.cases[0]!.attachments[0]).toMatchObject({ name: 'shot.png', mime: 'image/png' })
    expect(existsSync(path.join(evidenceRoot, RUN_ID, 'att1.png'))).toBe(true)
    const threads = db.prepare('SELECT thread, role, case_id FROM chat_messages ORDER BY created_at').all()
    expect(threads.map((row) => `${row.thread}:${row.role}`)).toEqual(['ask:user', 'assistant:user', 'assistant:assistant'])
    expect(threads[1]!.case_id).toBe(run.cases[0]!.id)

    const again = await importQaPortalData({ db, dataDir, evidenceRoot, workspaceId: null })
    expect(again.runs).toBe(0)
    expect(again.skipped).toContain('Legacy run (already imported)')
  })

  it('explains when the folder is not a qa-portal data folder', async () => {
    const empty = await tempDir()
    try {
      await expect(importQaPortalData({ db: memoryDb(), dataDir: empty, evidenceRoot, workspaceId: null })).rejects.toThrow('No runs.json found')
      await writeFile(path.join(empty, 'runs.json'), '{oops')
      await expect(importQaPortalData({ db: memoryDb(), dataDir: empty, evidenceRoot, workspaceId: null })).rejects.toThrow('not valid JSON')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
