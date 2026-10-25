import path from 'node:path'
import type { Workspace } from '@shared/domain'
import { transaction, type Db } from '../../db/connection'
import { UserError } from '../../errors'
import { assertDirectory } from '../fs-paths'
import { newId, nowIso } from '../util'

export interface WorkspaceService {
  list(): Workspace[]
  getActive(): Workspace | null
  add(input: { path: string; name?: string }): Promise<Workspace>
  activate(id: string): Workspace
  remove(id: string): void
}

function toWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at)
  }
}

/** Registry of QA knowledge repositories. Exactly one is active; onActiveChanged fires when that changes. */
export function createWorkspaceService(
  db: Db,
  onActiveChanged: (workspace: Workspace | null) => void = () => {}
): WorkspaceService {
  const list = (): Workspace[] =>
    db.prepare('SELECT * FROM workspaces ORDER BY created_at').all().map(toWorkspace)

  const getActive = (): Workspace | null => {
    const row = db.prepare('SELECT * FROM workspaces WHERE active = 1').get()
    return row ? toWorkspace(row) : null
  }

  const activate = (id: string): Workspace => {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    if (!row) throw new UserError('Workspace not found')
    transaction(db, () => {
      db.prepare('UPDATE workspaces SET active = 0').run()
      db.prepare('UPDATE workspaces SET active = 1 WHERE id = ?').run(id)
    })
    const active = { ...toWorkspace(row), active: true }
    onActiveChanged(active)
    return active
  }

  return {
    list,
    getActive,
    activate,
    async add(input) {
      const folder = await assertDirectory(input.path)
      const existing = list().find((item) => path.resolve(item.path).toLowerCase() === folder.toLowerCase())
      if (existing) return activate(existing.id)
      const id = newId()
      db.prepare('INSERT INTO workspaces (id, name, path, active, created_at) VALUES (?, ?, ?, 0, ?)').run(
        id,
        input.name?.trim() || path.basename(folder),
        folder,
        nowIso()
      )
      return activate(id)
    },
    remove(id) {
      const wasActive = getActive()?.id === id
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
      if (!wasActive) return
      const next = list()[0]
      if (next) activate(next.id)
      else onActiveChanged(null)
    }
  }
}
