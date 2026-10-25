import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Codebase } from '@shared/domain'
import { transaction, type Db } from '../../db/connection'
import { UserError } from '../../errors'
import { assertDirectory } from '../fs-paths'
import { newId, nowIso, textOrNull } from '../util'
import { readGitInfo, type GitReader } from './git'

/** What the AI layer receives: a resolved, existing folder. */
export interface ResolvedCodebase {
  id: string
  name: string
  path: string
}

export interface CodebaseService {
  list(): Codebase[]
  get(id: string): Codebase
  add(input: { path: string; name?: string }): Promise<Codebase>
  update(input: { id: string; name?: string; isDefault?: boolean }): Codebase
  refresh(id: string): Promise<Codebase>
  remove(id: string): void
  /** Resolves a codebase id chosen in the UI. Null means "no codebase". Throws if the folder is gone. */
  resolveForAi(id: string | null): ResolvedCodebase | null
}

function toCodebase(row: Record<string, unknown>): Codebase {
  const folder = String(row.path)
  return {
    id: String(row.id),
    name: String(row.name),
    path: folder,
    isDefault: Number(row.is_default) === 1,
    isGitRepo: Number(row.is_git_repo) === 1,
    gitBranch: textOrNull(row.git_branch),
    gitHead: textOrNull(row.git_head),
    available: existsSync(folder),
    lastCheckedAt: textOrNull(row.last_checked_at),
    createdAt: String(row.created_at)
  }
}

/**
 * Registry of source codebases the AI agents may read. Registering only stores the path; removing a codebase
 * never touches its files. One codebase can be the default, preselected for new runs and chats.
 */
export function createCodebaseService(db: Db, readGit: GitReader = readGitInfo): CodebaseService {
  const list = (): Codebase[] =>
    db.prepare('SELECT * FROM codebases ORDER BY is_default DESC, name COLLATE NOCASE').all().map(toCodebase)

  const get = (id: string): Codebase => {
    const row = db.prepare('SELECT * FROM codebases WHERE id = ?').get(id)
    if (!row) throw new UserError('Codebase not found')
    return toCodebase(row)
  }

  const setDefault = (id: string): void =>
    transaction(db, () => {
      db.prepare('UPDATE codebases SET is_default = 0').run()
      db.prepare('UPDATE codebases SET is_default = 1 WHERE id = ?').run(id)
    })

  return {
    list,
    get,
    async add(input) {
      const folder = await assertDirectory(input.path)
      if (list().some((item) => path.resolve(item.path).toLowerCase() === folder.toLowerCase())) {
        throw new UserError(`This folder is already connected: ${folder}`)
      }
      const info = await readGit(folder)
      const id = newId()
      const now = nowIso()
      db.prepare(
        `INSERT INTO codebases (id, name, path, is_default, is_git_repo, git_branch, git_head, last_checked_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`
      ).run(id, input.name?.trim() || path.basename(folder), folder, info.isGitRepo ? 1 : 0, info.branch, info.head, now, now)
      if (!list().some((item) => item.isDefault)) setDefault(id)
      return get(id)
    },
    update(input) {
      get(input.id)
      if (input.name !== undefined) db.prepare('UPDATE codebases SET name = ? WHERE id = ?').run(input.name.trim(), input.id)
      if (input.isDefault === true) setDefault(input.id)
      if (input.isDefault === false) db.prepare('UPDATE codebases SET is_default = 0 WHERE id = ?').run(input.id)
      return get(input.id)
    },
    async refresh(id) {
      const current = get(id)
      const info = current.available ? await readGit(current.path) : { isGitRepo: false, branch: null, head: null }
      db.prepare('UPDATE codebases SET is_git_repo = ?, git_branch = ?, git_head = ?, last_checked_at = ? WHERE id = ?').run(
        info.isGitRepo ? 1 : 0,
        info.branch,
        info.head,
        nowIso(),
        id
      )
      return get(id)
    },
    remove(id) {
      const wasDefault = get(id).isDefault
      db.prepare('DELETE FROM codebases WHERE id = ?').run(id)
      const next = list()[0]
      if (wasDefault && next) setDefault(next.id)
    },
    resolveForAi(id) {
      if (id === null) return null
      const codebase = get(id)
      if (!codebase.available) throw new UserError(`Codebase folder is missing: ${codebase.path}`)
      return { id: codebase.id, name: codebase.name, path: codebase.path }
    }
  }
}
