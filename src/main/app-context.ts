import path from 'node:path'
import type { Workspace } from '@shared/domain'
import type { AiEvent, AppEvents } from '@shared/ipc'
import type { Db } from './db/connection'
import type { IpcHandlers } from './ipc/register'
import { createCaseGenerator } from './modules/ai/case-generator'
import { createChatService } from './modules/ai/chat-service'
import { createClaudeProvider } from './modules/ai/claude-provider'
import { createDocEditService } from './modules/ai/doc-edit'
import { createCopilotProvider } from './modules/ai/copilot-provider'
import { createJobRegistry } from './modules/ai/jobs'
import type { ProviderRegistry } from './modules/ai/provider'
import { createStubProvider } from './modules/ai/stub-provider'
import { createCodebaseService } from './modules/codebases/codebase-service'
import { createDocService } from './modules/docs/doc-service'
import { watchWorkspace } from './modules/docs/watcher'
import { createEvidenceService, type EvidenceService } from './modules/evidence/evidence-service'
import { importQaPortalData } from './modules/import/qa-portal-import'
import { createRunService } from './modules/runs/run-service'
import { createSettingsService, type SecretCipher } from './modules/settings/settings-service'
import { createWorkspaceService } from './modules/workspaces/workspace-service'

export interface AppContextOptions {
  db: Db
  userDataDir: string
  version: string
  cipher: SecretCipher
  emit: <E extends keyof AppEvents>(event: E, payload: AppEvents[E]) => void
  pickFolder: (title: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  claudeExecutablePath?: string
  /** Replace both AI engines with deterministic stubs (end-to-end tests). */
  stubAi?: boolean
}

export interface AppContext {
  handlers: IpcHandlers
  evidence: EvidenceService
  /** Resolves an image referenced by a workspace document (qa-workspace:// protocol). */
  workspaceImage(relativePath: string): string | null
  /** Indexes and watches the active workspace. Call once after startup. */
  start(): Promise<void>
  dispose(): Promise<void>
}

/** Composition root: builds every service and maps each IPC channel to one service call. */
export function createAppContext(options: AppContextOptions): AppContext {
  const { db, emit } = options
  const emitAi = (event: AiEvent): void => emit('ai:event', event)
  let stopWatching: (() => Promise<void>) | null = null

  const settings = createSettingsService(db, options.cipher)
  const codebases = createCodebaseService(db)
  const workspaces = createWorkspaceService(db, (workspace) => {
    void switchWorkspace(workspace)
  })
  const docs = createDocService(db, () => workspaces.getActive())
  let evidence: EvidenceService
  const runs = createRunService(db, {
    workspaceCaseIds: () => docs.caseIds(),
    activeWorkspaceId: () => workspaces.getActive()?.id ?? null,
    defaultCodebaseId: () => codebases.list().find((item) => item.isDefault)?.id ?? null,
    onRunDeleted: (runId) => void evidence.removeRunFolder(runId)
  })
  evidence = createEvidenceService(path.join(options.userDataDir, 'evidence'), runs.repo, (id) => runs.get(id))

  const providers: ProviderRegistry = options.stubAi
    ? { copilot: createStubProvider('copilot'), claude: createStubProvider('claude') }
    : {
        copilot: createCopilotProvider(),
        claude: createClaudeProvider({
          getApiKey: () => settings.getClaudeApiKey(),
          getModel: () => settings.get().claudeModel,
          executablePath: options.claudeExecutablePath
        })
      }
  const jobs = createJobRegistry()
  const chat = createChatService({ db, runs, codebases, providers, jobs, emit: emitAi })
  const caseGenerator = createCaseGenerator({ runs, codebases, providers, jobs, emit: emitAi })
  const docEdit = createDocEditService({ docs, providers, jobs, emit: emitAi })

  async function reindexAndNotify(): Promise<{ count: number }> {
    const result = await docs.reindex()
    emit('docs:changed', result)
    return result
  }

  async function switchWorkspace(workspace: Workspace | null): Promise<void> {
    await stopWatching?.()
    stopWatching = null
    if (!workspace) {
      emit('docs:changed', { count: 0 })
      return
    }
    try {
      await reindexAndNotify()
      stopWatching = watchWorkspace(workspace.path, async (paths) => {
        for (const relative of paths) await docs.refreshFile(relative)
        emit('docs:changed', { count: paths.length })
      })
    } catch (error) {
      console.error('[docs] indexing failed', error)
    }
  }

  const handlers: IpcHandlers = {
    'app:bootstrap': () => ({
      version: options.version,
      workspace: workspaces.getActive(),
      codebases: codebases.list(),
      settings: settings.get()
    }),
    'dialog:pickFolder': ({ title }) => options.pickFolder(title),
    'shell:openExternal': async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened')
      await options.openExternal(url)
    },

    'workspaces:list': () => workspaces.list(),
    'workspaces:add': (input) => workspaces.add(input),
    'workspaces:activate': ({ id }) => workspaces.activate(id),
    'workspaces:remove': ({ id }) => workspaces.remove(id),

    'codebases:list': () => codebases.list(),
    'codebases:add': (input) => codebases.add(input),
    'codebases:update': (input) => codebases.update(input),
    'codebases:refresh': ({ id }) => codebases.refresh(id),
    'codebases:remove': ({ id }) => codebases.remove(id),

    'docs:list': () => docs.list(),
    'docs:get': ({ path: relative }) => docs.get(relative),
    'docs:search': ({ query, limit }) => docs.search(query, limit),
    'docs:diagram': ({ area }) => docs.diagram(area),
    'docs:reindex': () => reindexAndNotify(),
    'docs:save': async ({ path: relative, body, baseBody }) => {
      const doc = await docs.save(relative, body, baseBody)
      emit('docs:changed', { count: 1 })
      return doc
    },

    'runs:list': () => runs.list(),
    'runs:get': ({ id }) => runs.get(id),
    'runs:create': (input) => runs.create(input),
    'runs:update': (input) => runs.update(input),
    'runs:saveCases': ({ id, cases }) => runs.saveCases(id, cases),
    'runs:transition': ({ id, action, reason }) => runs.transition(id, action, reason),
    'runs:delete': ({ id }) => runs.remove(id),
    'runs:recordResult': (input) => runs.recordResult(input),
    'runs:removeCase': async ({ runId, caseId }) => {
      const attachmentIds = runs.get(runId).cases.find((item) => item.id === caseId)?.attachments.map((item) => item.id) ?? []
      const updated = runs.removeCase(runId, caseId)
      await evidence.removeFiles(runId, attachmentIds)
      return updated
    },
    'runs:aiAddCases': (input) => caseGenerator.generate(input),

    'attachments:add': (input) => evidence.add(input),
    'attachments:remove': ({ runId, caseId, attachmentId }) => evidence.remove(runId, caseId, attachmentId),

    'chat:history': ({ runId, thread }) => chat.history(runId, thread),
    'chat:send': (input) => chat.send(input),
    'chat:clear': ({ runId, thread }) => chat.clear(runId, thread),

    'ai:cancel': ({ jobId }) => ({ cancelled: jobs.cancel(jobId) }),
    'ai:providers': () => Promise.all([providers.copilot.checkAvailability(), providers.claude.checkAvailability()]),
    'ai:editDoc': (input) => docEdit.edit(input),

    'settings:get': () => settings.get(),
    'settings:update': (patch) => settings.update(patch),
    'settings:setClaudeApiKey': ({ key }) => settings.setClaudeApiKey(key),

    'import:qaPortal': ({ dataDir }) =>
      importQaPortalData({
        db,
        dataDir,
        evidenceRoot: path.join(options.userDataDir, 'evidence'),
        workspaceId: workspaces.getActive()?.id ?? null
      })
  }

  return {
    handlers,
    evidence,
    workspaceImage: (relativePath) => docs.imagePath(relativePath),
    async start() {
      chat.markInterrupted()
      const active = workspaces.getActive()
      if (active) await switchWorkspace(active)
    },
    async dispose() {
      jobs.cancelAll()
      await stopWatching?.()
    }
  }
}
