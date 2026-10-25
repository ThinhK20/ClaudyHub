import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEvidenceService, detectEvidenceType, type EvidenceService } from '../../src/main/modules/evidence/evidence-service'
import { createRunService, type RunService } from '../../src/main/modules/runs/run-service'
import { PNG_BYTES, completeCase, memoryDb, tempDir } from '../helpers'

describe('detectEvidenceType', () => {
  it('accepts supported media by extension and signature', () => {
    expect(detectEvidenceType('shot.PNG', PNG_BYTES)).toEqual({ mime: 'image/png', extension: '.png' })
    expect(detectEvidenceType('a.jpeg', Uint8Array.from([255, 216, 255, 0]))).toEqual({ mime: 'image/jpeg', extension: '.jpg' })
    expect(detectEvidenceType('a.gif', new TextEncoder().encode('GIF89a....'))).toMatchObject({ mime: 'image/gif' })
    expect(detectEvidenceType('a.webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toMatchObject({ mime: 'video/webm' })
    const mp4 = new Uint8Array(12)
    mp4.set(new TextEncoder().encode('ftyp'), 4)
    expect(detectEvidenceType('clip.mov', mp4)).toMatchObject({ mime: 'video/quicktime' })
  })

  it('rejects unsupported types and spoofed content', () => {
    expect(() => detectEvidenceType('doc.pdf', PNG_BYTES)).toThrow('Attach PNG')
    expect(() => detectEvidenceType('fake.png', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a valid PNG')
  })
})

describe('evidence service', () => {
  let root: string
  let runs: RunService
  let evidence: EvidenceService
  let runId: string
  let caseId: string

  beforeEach(async () => {
    root = await tempDir()
    runs = createRunService(memoryDb(), { workspaceCaseIds: () => new Set(), activeWorkspaceId: () => null, defaultCodebaseId: () => null })
    evidence = createEvidenceService(root, runs.repo, (id) => runs.get(id))
    const run = runs.create({ title: 'Evidence' })
    runs.saveCases(run.id, [completeCase()])
    runs.transition(run.id, 'approve')
    const running = runs.transition(run.id, 'start')
    runId = run.id
    caseId = running.cases[0]!.id
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('stores, serves and removes a file', async () => {
    const attachment = await evidence.add({ runId, caseId, name: '../../evil/shot.png', bytes: PNG_BYTES })
    expect(attachment).toMatchObject({ name: 'shot.png', mime: 'image/png', size: PNG_BYTES.length })
    const file = evidence.filePath(runId, attachment.id)
    expect(file && path.dirname(file)).toBe(path.join(root, runId))
    expect(runs.get(runId).cases[0]!.attachments).toHaveLength(1)
    await evidence.remove(runId, caseId, attachment.id)
    expect(existsSync(file!)).toBe(false)
    expect(evidence.filePath(runId, attachment.id)).toBeNull()
  })

  it('enforces size, emptiness and case membership', async () => {
    await expect(evidence.add({ runId, caseId, name: 'a.png', bytes: new Uint8Array() })).rejects.toThrow('empty')
    await expect(evidence.add({ runId, caseId: 'other', name: 'a.png', bytes: PNG_BYTES })).rejects.toThrow('Case not found')
    const huge = new Uint8Array(32 * 1024 * 1024 + 1)
    huge.set(PNG_BYTES)
    await expect(evidence.add({ runId, caseId, name: 'a.png', bytes: huge })).rejects.toThrow('32 MB')
  })

  it('limits files per case', async () => {
    for (let index = 0; index < 20; index++) await evidence.add({ runId, caseId, name: `${index}.png`, bytes: PNG_BYTES })
    await expect(evidence.add({ runId, caseId, name: 'x.png', bytes: PNG_BYTES })).rejects.toThrow('at most 20 files')
  })

  it('only changes evidence while the window runs', async () => {
    const attachment = await evidence.add({ runId, caseId, name: 'a.png', bytes: PNG_BYTES })
    runs.recordResult({ runId, caseId, execution: 'passed', resultNote: '', evidence: [] })
    runs.transition(runId, 'finish')
    await expect(evidence.add({ runId, caseId, name: 'b.png', bytes: PNG_BYTES })).rejects.toThrow('while the test window is running')
    await expect(evidence.remove(runId, caseId, attachment.id)).rejects.toThrow('while the test window is running')
  })

  it('removes selected files and whole run folders', async () => {
    const keep = await evidence.add({ runId, caseId, name: 'keep.png', bytes: PNG_BYTES })
    const drop = await evidence.add({ runId, caseId, name: 'drop.png', bytes: PNG_BYTES })
    await evidence.removeFiles(runId, [drop.id])
    expect(evidence.filePath(runId, keep.id)).not.toBeNull()
    expect(evidence.filePath(runId, drop.id)).toBeNull()
    await evidence.removeRunFolder(runId)
    expect(existsSync(path.join(root, runId))).toBe(false)
    await expect(evidence.remove(runId, caseId, 'missing')).rejects.toThrow('Attachment not found')
  })
})
