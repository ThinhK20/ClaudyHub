import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@shared/domain'
import { createCodebaseService } from '../../src/main/modules/codebases/codebase-service'
import { readGitInfo, type GitReader } from '../../src/main/modules/codebases/git'
import { createSettingsService } from '../../src/main/modules/settings/settings-service'
import { createWorkspaceService } from '../../src/main/modules/workspaces/workspace-service'
import { fakeCipher, memoryDb, tempDir } from '../helpers'

let root: string
beforeEach(async () => {
  root = await tempDir()
})
afterEach(() => rm(root, { recursive: true, force: true }))

const folder = async (name: string): Promise<string> => {
  const full = path.join(root, name)
  await mkdir(full, { recursive: true })
  return full
}

describe('workspace service', () => {
  it('activates the first workspace, switches, and falls back on removal', async () => {
    const changes: (Workspace | null)[] = []
    const service = createWorkspaceService(memoryDb(), (workspace) => changes.push(workspace))
    const a = await service.add({ path: await folder('qa-a') })
    expect(a).toMatchObject({ name: 'qa-a', active: true })
    const b = await service.add({ path: await folder('qa-b'), name: 'Second' })
    expect(service.getActive()?.id).toBe(b.id)
    expect((await service.add({ path: a.path })).id).toBe(a.id)
    expect(service.getActive()?.id).toBe(a.id)
    service.remove(a.id)
    expect(service.getActive()?.id).toBe(b.id)
    service.remove(b.id)
    expect(service.getActive()).toBeNull()
    expect(changes.at(-1)).toBeNull()
  })

  it('rejects missing folders and unknown ids', async () => {
    const service = createWorkspaceService(memoryDb())
    await expect(service.add({ path: path.join(root, 'nope') })).rejects.toThrow('Folder not found')
    expect(() => service.activate('missing')).toThrow('Workspace not found')
  })
})

describe('codebase service', () => {
  const fakeGit: GitReader = async () => ({ isGitRepo: true, branch: 'main', head: 'abc123' })

  it('connects folders, keeps one default, and promotes a new default on removal', async () => {
    const service = createCodebaseService(memoryDb(), fakeGit)
    const web = await service.add({ path: await folder('web') })
    expect(web).toMatchObject({ name: 'web', isDefault: true, isGitRepo: true, gitBranch: 'main', available: true })
    const api = await service.add({ path: await folder('api'), name: 'API' })
    expect(api.isDefault).toBe(false)
    expect(service.update({ id: api.id, isDefault: true }).isDefault).toBe(true)
    expect(service.get(web.id).isDefault).toBe(false)
    expect(service.update({ id: web.id, name: 'Web app' }).name).toBe('Web app')
    service.remove(api.id)
    expect(service.get(web.id).isDefault).toBe(true)
    expect(service.update({ id: web.id, isDefault: false }).isDefault).toBe(false)
  })

  it('refuses duplicates and missing folders', async () => {
    const service = createCodebaseService(memoryDb(), fakeGit)
    const web = await folder('web')
    await service.add({ path: web })
    await expect(service.add({ path: web })).rejects.toThrow('already connected')
    await expect(service.add({ path: path.join(root, 'missing') })).rejects.toThrow('Folder not found')
    expect(() => service.get('nope')).toThrow('Codebase not found')
  })

  it('resolves codebases for the AI layer and fails when the folder disappeared', async () => {
    const service = createCodebaseService(memoryDb(), fakeGit)
    const added = await service.add({ path: await folder('gone') })
    expect(service.resolveForAi(null)).toBeNull()
    expect(service.resolveForAi(added.id)).toEqual({ id: added.id, name: 'gone', path: added.path })
    await rm(added.path, { recursive: true })
    expect(service.get(added.id).available).toBe(false)
    expect(() => service.resolveForAi(added.id)).toThrow('Codebase folder is missing')
    expect((await service.refresh(added.id)).isGitRepo).toBe(false)
  })

  it('reads real git metadata', async () => {
    const plain = await folder('plain')
    expect(await readGitInfo(plain)).toEqual({ isGitRepo: false, branch: null, head: null })
    const repo = await folder('repo')
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' })
    }
    git('init', '-b', 'trunk')
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'init')
    const info = await readGitInfo(repo)
    expect(info.isGitRepo).toBe(true)
    expect(info.branch).toBe('trunk')
    expect(info.head).toMatch(/^[0-9a-f]{7,}$/)
  })
})

describe('settings service', () => {
  it('returns defaults and persists partial updates', () => {
    const service = createSettingsService(memoryDb(), fakeCipher)
    expect(service.get()).toMatchObject({ defaultProvider: 'copilot', claudeModel: 'claude-opus-5-5', theme: 'system', hasClaudeApiKey: false })
    const updated = service.update({ theme: 'dark', github: { org: 'acme', sourceRepo: 'app', qaRepo: 'qa' } })
    expect(updated.theme).toBe('dark')
    expect(updated.github).toEqual({ org: 'acme', sourceRepo: 'app', qaRepo: 'qa' })
    expect(updated.defaultProvider).toBe('copilot')
  })

  it('stores the API key encrypted and never returns it in settings', () => {
    const db = memoryDb()
    const service = createSettingsService(db, fakeCipher)
    const settings = service.setClaudeApiKey('sk-test-123')
    expect(settings.hasClaudeApiKey).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('sk-test-123')
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'secret.claudeApiKey'").get()
    expect(String(stored?.value)).not.toContain('sk-test-123')
    expect(service.getClaudeApiKey()).toBe('sk-test-123')
    expect(service.setClaudeApiKey(null).hasClaudeApiKey).toBe(false)
    expect(service.getClaudeApiKey()).toBeNull()
  })

  it('refuses to store secrets without secure storage', () => {
    const service = createSettingsService(memoryDb(), { ...fakeCipher, isAvailable: () => false })
    expect(() => service.setClaudeApiKey('k')).toThrow('Secure storage is not available')
  })

  it('returns null when a stored secret cannot be decrypted', () => {
    const db = memoryDb()
    createSettingsService(db, fakeCipher).setClaudeApiKey('k')
    const broken = createSettingsService(db, {
      ...fakeCipher,
      decrypt: () => {
        throw new Error('bad key')
      }
    })
    expect(broken.getClaudeApiKey()).toBeNull()
  })
})
