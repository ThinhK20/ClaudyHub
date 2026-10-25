import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@shared/domain'
import { analyzeMarkdown, classify } from '../../src/main/modules/docs/classify'
import { createDocService, ftsQuery, type DocService } from '../../src/main/modules/docs/doc-service'
import { isIndexable, mapLimit } from '../../src/main/modules/docs/scan'
import { memoryDb, tempDir, writeFiles } from '../helpers'

const FIXTURE: Record<string, string> = {
  'qa/test-cases/settings/Reject invalid settings.md':
    '---\nid: "000120"\ntitle: "Reject invalid settings"\nstatus: passed\n---\n\n## Steps\n\n| Step | Detail | Expected |\n| --- | --- | --- |\n| 1 | Enter bad value | Error shown |\n| 2 | Save | Not saved |\n',
  'qa/regression-assets/forms/Form checklist.md': '---\narea: forms\n---\n\n# Form checklist\n\n- [x] Submit works\n- [ ] Validation works\n',
  'qa/releases/2026.10.md': '# Release 2026.10\n\nNotes about the form builder.',
  'wiki/admin/page.md': '---\ntags: [a, b]\ncreated: 2026-01-02\n---\n\n# Admin page\n',
  'broken.md': '---\ntitle: [unclosed\n---\nBody survives',
  'node_modules/pkg/readme.md': '# ignored',
  'scripts/notes.md': '# ignored',
  'qa-portal/diagrams/forms.md': 'flowchart LR\n  A --> B'
}

describe('classify', () => {
  it('maps repository folders to library sections', () => {
    expect(classify('qa/test-cases/opm/sub/a.md')).toEqual({ section: 'test-cases', group: 'opm/sub' })
    expect(classify('qa/regression-assets/forms/a.md')).toEqual({ section: 'assets', group: 'forms' })
    expect(classify('qa/regression-assets/a.md')).toEqual({ section: 'assets', group: '' })
    expect(classify('qa/release-runs/a.md')).toEqual({ section: 'releases', group: 'release-runs' })
    expect(classify('qa/test-runs/12/a.md')).toEqual({ section: 'test-runs', group: '12' })
    expect(classify('README.md')).toEqual({ section: 'guides', group: '' })
  })

  it('derives title, checklist and step counts', () => {
    const doc = analyzeMarkdown('x/y.md', FIXTURE['qa/regression-assets/forms/Form checklist.md']!)
    expect(doc).toMatchObject({ title: 'Form checklist', checks: 2, done: 1, steps: 0 })
    expect(analyzeMarkdown('x/plain-name.md', 'no heading').title).toBe('plain-name')
  })

  it('normalizes YAML dates and survives malformed frontmatter', () => {
    expect(analyzeMarkdown('w.md', FIXTURE['wiki/admin/page.md']!).frontmatter).toEqual({ tags: ['a', 'b'], created: '2026-01-02' })
    const broken = analyzeMarkdown('broken.md', FIXTURE['broken.md']!)
    expect(broken.frontmatter).toEqual({})
    expect(broken.body).toContain('Body survives')
  })

  it('skips tooling folders and non-markdown files', () => {
    expect(isIndexable('qa/a.md')).toBe(true)
    expect(isIndexable('node_modules/a.md')).toBe(false)
    expect(isIndexable('.obsidian/a.md')).toBe(false)
    expect(isIndexable('qa/a.txt')).toBe(false)
  })
})

describe('ftsQuery', () => {
  it('turns words into quoted prefix terms and neutralizes FTS syntax', () => {
    expect(ftsQuery('form valid')).toBe('"form"* "valid"*')
    expect(ftsQuery('a" OR "b')).toBe('"a"* "OR"* "b"*')
    expect(ftsQuery('  ** ')).toBeNull()
  })
})

describe('mapLimit', () => {
  it('preserves order', async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n) => n * 2)).toEqual([6, 2, 4])
  })
})

describe('doc service', () => {
  let root: string
  let workspace: Workspace | null
  let service: DocService

  beforeEach(async () => {
    root = await tempDir()
    await writeFiles(root, FIXTURE)
    const db = memoryDb()
    db.prepare("INSERT INTO workspaces (id, name, path, active, created_at) VALUES ('w1', 'QA', ?, 1, '2026-01-01')").run(root)
    workspace = { id: 'w1', name: 'QA', path: root, active: true, createdAt: '2026-01-01' }
    service = createDocService(db, () => workspace)
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('indexes markdown and skips excluded folders', async () => {
    expect(await service.reindex()).toEqual({ count: 5 })
    const paths = service.list().map((doc) => doc.path)
    expect(paths).toContain('qa/test-cases/settings/Reject invalid settings.md')
    expect(paths.some((item) => item.startsWith('node_modules') || item.startsWith('scripts') || item.startsWith('qa-portal'))).toBe(false)
  })

  it('searches titles and bodies by prefix with highlighted snippets', async () => {
    await service.reindex()
    const hits = service.search('form build')
    expect(hits.map((hit) => hit.path)).toEqual(['qa/releases/2026.10.md'])
    expect(hits[0]!.snippet).toContain('\u0002form\u0003')
    expect(service.search('validat')[0]!.title).toBe('Form checklist')
    expect(service.search('')).toEqual([])
  })

  it('opens documents fresh from disk and refuses paths outside the workspace', async () => {
    const doc = await service.get('qa/test-cases/settings/Reject invalid settings.md')
    expect(doc.steps).toBe(2)
    await expect(service.get('../outside.md')).rejects.toThrow('outside the allowed folder')
    await expect(service.get('missing.md')).rejects.toThrow('Document not found')
    await expect(service.get('qa/a.txt')).rejects.toThrow('Only Markdown')
  })

  it('collects numeric test-case ids', async () => {
    await service.reindex()
    expect([...service.caseIds()]).toEqual([120])
  })

  it('refreshes single files incrementally', async () => {
    await service.reindex()
    await writeFiles(root, { 'qa/test-cases/new/Added.md': '---\nid: "000200"\n---\n# Added case' })
    await service.refreshFile('qa/test-cases/new/Added.md')
    expect(service.search('added').map((hit) => hit.path)).toEqual(['qa/test-cases/new/Added.md'])
    await rm(path.join(root, 'qa', 'test-cases', 'new', 'Added.md'))
    await service.refreshFile('qa/test-cases/new/Added.md')
    expect(service.search('added')).toEqual([])
    await service.refreshFile('node_modules/pkg/readme.md')
    expect(service.list()).toHaveLength(5)
  })

  it('reads workflow diagrams from qa-portal/diagrams', async () => {
    expect(await service.diagram('forms')).toContain('flowchart')
    expect(await service.diagram('missing')).toBeNull()
  })

  it('returns nothing without an active workspace', async () => {
    workspace = null
    expect(service.list()).toEqual([])
    expect(service.search('form')).toEqual([])
    expect(service.caseIds().size).toBe(0)
    expect(await service.diagram('forms')).toBeNull()
    await expect(service.reindex()).rejects.toThrow('Choose a QA workspace folder first')
  })

  describe('save', () => {
    const CHECKLIST = 'qa/regression-assets/forms/Form checklist.md'

    it('replaces the body and keeps the frontmatter text exactly', async () => {
      await service.reindex()
      const original = await service.get(CHECKLIST)
      const saved = await service.save(CHECKLIST, '# Form checklist\n\n- [x] Submit works\n- [x] Validation works', original.body)
      expect(await readFile(path.join(root, CHECKLIST), 'utf8')).toBe(
        '---\narea: forms\n---\n\n# Form checklist\n\n- [x] Submit works\n- [x] Validation works\n'
      )
      expect(saved).toMatchObject({ done: 2, editable: true })
      expect(service.list().find((doc) => doc.path === CHECKLIST)).toMatchObject({ done: 2 })
    })

    it('keeps Windows line endings', async () => {
      await writeFile(path.join(root, 'crlf.md'), '---\r\nid: 1\r\n---\r\n\r\nold\r\n')
      const doc = await service.get('crlf.md')
      await service.save('crlf.md', 'new\nline', doc.body)
      expect(await readFile(path.join(root, 'crlf.md'), 'utf8')).toBe('---\r\nid: 1\r\n---\r\n\r\nnew\r\nline\r\n')
    })

    it('refuses to overwrite a file that changed on disk since it was opened', async () => {
      const doc = await service.get(CHECKLIST)
      await writeFile(path.join(root, CHECKLIST), '---\narea: forms\n---\n\nedited elsewhere\n')
      await expect(service.save(CHECKLIST, 'mine', doc.body)).rejects.toThrow('changed on disk')
      expect(await readFile(path.join(root, CHECKLIST), 'utf8')).toContain('edited elsewhere')
    })

    it('refuses documents whose frontmatter cannot be read, and paths outside the workspace', async () => {
      const broken = await service.get('broken.md')
      expect(broken.editable).toBe(false)
      await expect(service.save('broken.md', 'x', broken.body)).rejects.toThrow('cannot be edited')
      await expect(service.save('../outside.md', 'x', '')).rejects.toThrow('outside')
      await expect(service.save('qa/notes.txt', 'x', '')).rejects.toThrow('Markdown')
    })
  })
})
