import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Doc, DocEntry, DocSection, SearchHit, Workspace } from '@shared/domain'
import { transaction, type Db } from '../../db/connection'
import { UserError } from '../../errors'
import { resolveInside, toPosix } from '../fs-paths'
import { parseJson } from '../util'
import { analyzeMarkdown } from './classify'
import { isIndexable, mapLimit, walkMarkdown } from './scan'

const READ_CONCURRENCY = 32
const DEFAULT_SEARCH_LIMIT = 50
const MAX_QUERY_TERMS = 8

export interface DocService {
  reindex(): Promise<{ count: number }>
  /** Re-reads one changed file (root-relative POSIX path); removes it from the index if it is gone. */
  refreshFile(relativePath: string): Promise<void>
  list(): DocEntry[]
  get(relativePath: string): Promise<Doc>
  /** Replaces a document's body, keeping its frontmatter text and line endings. Fails if the file changed since baseBody was read. */
  save(relativePath: string, body: string, baseBody: string): Promise<Doc>
  /** Hands a document's file to `discard` (e.g. the system trash) and drops it from the index. */
  remove(relativePath: string, discard: (fullPath: string) => Promise<void>): Promise<void>
  /** Copies a document's file to an absolute destination the user chose. */
  copyTo(relativePath: string, destination: string): Promise<void>
  search(query: string, limit?: number): SearchHit[]
  diagram(area: string): Promise<string | null>
  /** Numeric `id` frontmatter values of every indexed test case. */
  caseIds(): Set<number>
  /** Absolute path of an image inside the active workspace (for qa-workspace:// URLs), or null. */
  imagePath(relativePath: string): string | null
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

/** Builds an FTS5 MATCH expression: every term must match as a prefix. Quoting neutralizes FTS syntax. */
export function ftsQuery(query: string): string | null {
  const terms = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, MAX_QUERY_TERMS)
  if (!terms.length) return null
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ')
}

const unixEol = (text: string): string => text.replace(/\r\n/g, '\n')

/** The file text with its body replaced: frontmatter bytes, the blank lines after them and the file's line endings stay as they were. */
export function replaceBody(text: string, oldBody: string, newBody: string): string {
  if (!text.endsWith(oldBody)) throw new UserError('This document cannot be edited here')
  const prefix = text.slice(0, text.length - oldBody.length)
  const leading = /^(?:\r?\n)*/.exec(oldBody)?.[0] ?? ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = `${unixEol(newBody).replace(/^\n+/, '').replace(/\n*$/, '')}\n`
  return prefix + leading + (eol === '\n' ? body : body.replaceAll('\n', eol))
}

function toEntry(row: Record<string, unknown>): DocEntry {
  return {
    path: String(row.path),
    section: String(row.section) as DocSection,
    group: String(row.grp),
    title: String(row.title),
    frontmatter: parseJson(String(row.frontmatter_json), {}),
    checks: Number(row.checks),
    done: Number(row.done),
    steps: Number(row.steps)
  }
}

/** Markdown index of the active workspace, persisted in SQLite with an FTS5 table for search. */
export function createDocService(db: Db, activeWorkspace: () => Workspace | null): DocService {
  const requireWorkspace = (): Workspace => {
    const workspace = activeWorkspace()
    if (!workspace) throw new UserError('Choose a QA workspace folder first')
    return workspace
  }

  const insert = (workspaceId: string, doc: Doc): void => {
    db.prepare(
      `INSERT INTO docs (workspace_id, path, section, grp, title, frontmatter_json, checks, done, steps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(workspaceId, doc.path, doc.section, doc.group, doc.title, JSON.stringify(doc.frontmatter), doc.checks, doc.done, doc.steps)
    db.prepare('INSERT INTO docs_fts (workspace_id, path, title, body) VALUES (?, ?, ?, ?)').run(
      workspaceId,
      doc.path,
      doc.title,
      doc.body
    )
  }

  /** Absolute path of an existing Markdown document in the active workspace. */
  const existingDoc = (relativePath: string, action: string): string => {
    const workspace = requireWorkspace()
    if (!relativePath.toLowerCase().endsWith('.md')) throw new UserError(`Only Markdown documents can be ${action}`)
    const full = resolveInside(workspace.path, relativePath)
    if (!existsSync(full)) throw new UserError(`Document not found: ${relativePath}`)
    return full
  }

  const removeOne = (workspaceId: string, relativePath: string): void => {
    db.prepare('DELETE FROM docs WHERE workspace_id = ? AND path = ?').run(workspaceId, relativePath)
    db.prepare('DELETE FROM docs_fts WHERE workspace_id = ? AND path = ?').run(workspaceId, relativePath)
  }

  return {
    async reindex() {
      const workspace = requireWorkspace()
      const files = await walkMarkdown(workspace.path)
      const docs = await mapLimit(files, READ_CONCURRENCY, async (full) =>
        analyzeMarkdown(toPosix(path.relative(workspace.path, full)), await readFile(full, 'utf8'))
      )
      transaction(db, () => {
        db.prepare('DELETE FROM docs WHERE workspace_id = ?').run(workspace.id)
        db.prepare('DELETE FROM docs_fts WHERE workspace_id = ?').run(workspace.id)
        for (const doc of docs) insert(workspace.id, doc)
      })
      return { count: docs.length }
    },

    async refreshFile(relativePath) {
      const workspace = activeWorkspace()
      if (!workspace || !isIndexable(relativePath)) return
      const text = await readFile(resolveInside(workspace.path, relativePath), 'utf8').catch(() => null)
      transaction(db, () => {
        removeOne(workspace.id, relativePath)
        if (text !== null) insert(workspace.id, analyzeMarkdown(relativePath, text))
      })
    },

    list() {
      const workspace = activeWorkspace()
      if (!workspace) return []
      return db
        .prepare('SELECT * FROM docs WHERE workspace_id = ? ORDER BY section, grp, title COLLATE NOCASE')
        .all(workspace.id)
        .map(toEntry)
    },

    async get(relativePath) {
      const workspace = requireWorkspace()
      if (!relativePath.toLowerCase().endsWith('.md')) throw new UserError('Only Markdown documents can be opened')
      const text = await readFile(resolveInside(workspace.path, relativePath), 'utf8').catch(() => {
        throw new UserError(`Document not found: ${relativePath}`)
      })
      return analyzeMarkdown(relativePath, text)
    },

    async save(relativePath, body, baseBody) {
      const workspace = requireWorkspace()
      if (!relativePath.toLowerCase().endsWith('.md')) throw new UserError('Only Markdown documents can be edited')
      const full = resolveInside(workspace.path, relativePath)
      const text = await readFile(full, 'utf8').catch(() => {
        throw new UserError(`Document not found: ${relativePath}`)
      })
      const current = analyzeMarkdown(relativePath, text)
      if (!current.editable) throw new UserError('This document cannot be edited here because its frontmatter could not be read')
      if (unixEol(current.body) !== unixEol(baseBody)) {
        throw new UserError('This document changed on disk since you started editing. Copy your changes, reopen it and try again.')
      }
      const next = replaceBody(text, current.body, body)
      // Write a sibling temp file, then rename over the original, so a crash never leaves a half-written document.
      const temp = `${full}.${process.pid}.tmp`
      try {
        await writeFile(temp, next, 'utf8')
        await rename(temp, full)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      const saved = analyzeMarkdown(relativePath, next)
      transaction(db, () => {
        removeOne(workspace.id, relativePath)
        insert(workspace.id, saved)
      })
      return saved
    },

    async remove(relativePath, discard) {
      const full = existingDoc(relativePath, 'deleted')
      await discard(full)
      const workspace = requireWorkspace()
      transaction(db, () => removeOne(workspace.id, relativePath))
    },

    async copyTo(relativePath, destination) {
      const full = existingDoc(relativePath, 'downloaded')
      if (path.resolve(destination) === full) return
      await copyFile(full, destination)
    },

    search(query, limit = DEFAULT_SEARCH_LIMIT) {
      const workspace = activeWorkspace()
      const match = ftsQuery(query)
      if (!workspace || !match) return []
      return db
        .prepare(
          `SELECT f.path AS path, f.title AS title, d.section AS section,
                  snippet(docs_fts, 3, char(2), char(3), '…', 16) AS snippet
           FROM docs_fts f JOIN docs d ON d.workspace_id = f.workspace_id AND d.path = f.path
           WHERE docs_fts MATCH ? AND f.workspace_id = ?
           ORDER BY bm25(docs_fts, 0, 0, 5.0, 1.0)
           LIMIT ?`
        )
        .all(match, workspace.id, limit)
        .map((row) => ({
          path: String(row.path),
          title: String(row.title),
          section: String(row.section) as DocSection,
          snippet: String(row.snippet ?? '')
        }))
    },

    async diagram(area) {
      const workspace = activeWorkspace()
      if (!workspace) return null
      const file = resolveInside(workspace.path, path.join('qa-portal', 'diagrams', `${area}.md`))
      return readFile(file, 'utf8').catch(() => null)
    },

    caseIds() {
      const workspace = activeWorkspace()
      if (!workspace) return new Set()
      const ids = new Set<number>()
      const rows = db.prepare("SELECT frontmatter_json FROM docs WHERE workspace_id = ? AND section = 'test-cases'").all(workspace.id)
      for (const row of rows) {
        const id = parseJson<Record<string, unknown>>(String(row.frontmatter_json), {}).id
        if (/^\d{1,6}$/.test(String(id ?? ''))) ids.add(Number(id))
      }
      return ids
    },

    imagePath(relativePath) {
      const workspace = activeWorkspace()
      if (!workspace || !IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return null
      try {
        const full = resolveInside(workspace.path, relativePath)
        return existsSync(full) ? full : null
      } catch {
        return null
      }
    }
  }
}
