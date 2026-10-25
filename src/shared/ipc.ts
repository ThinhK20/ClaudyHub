import { z } from 'zod'
import type {
  AiUsage,
  Attachment,
  BootstrapInfo,
  ChatMessage,
  Codebase,
  Doc,
  DocEntry,
  ImportSummary,
  ProviderStatus,
  Run,
  RunSummary,
  SearchHit,
  Settings,
  TestCase,
  Workspace
} from './domain'
import {
  LIMITS,
  caseDraftSchema,
  evidenceLinkSchema,
  idSchema,
  providerIdSchema,
  threadSchema
} from './schemas'

const pathSchema = z.string().min(1).max(1024)
const nullableId = idSchema.nullable()

// Every renderer → main call is declared here once: its zod input schema (validated in main) and its output type.
export const ipcInputs = {
  'app:bootstrap': z.void(),
  'dialog:pickFolder': z.object({ title: z.string().max(200) }),
  'shell:openExternal': z.object({ url: z.string().url().max(2000) }),
  'window:openDoc': z.object({ path: pathSchema }),

  'workspaces:list': z.void(),
  'workspaces:add': z.object({ path: pathSchema, name: z.string().max(120).optional() }),
  'workspaces:activate': z.object({ id: idSchema }),
  'workspaces:remove': z.object({ id: idSchema }),

  'codebases:list': z.void(),
  'codebases:add': z.object({ path: pathSchema, name: z.string().max(120).optional() }),
  'codebases:update': z.object({ id: idSchema, name: z.string().min(1).max(120).optional(), isDefault: z.boolean().optional() }),
  'codebases:refresh': z.object({ id: idSchema }),
  'codebases:remove': z.object({ id: idSchema }),

  'docs:list': z.void(),
  'docs:get': z.object({ path: pathSchema }),
  'docs:search': z.object({ query: z.string().max(300), limit: z.number().int().min(1).max(200).optional() }),
  'docs:diagram': z.object({ area: z.string().regex(/^[a-z0-9-]{1,80}$/) }),
  'docs:reindex': z.void(),
  'docs:save': z.object({ path: pathSchema, body: z.string().max(LIMITS.docBody), baseBody: z.string().max(LIMITS.docBody) }),

  'runs:list': z.void(),
  'runs:get': z.object({ id: idSchema }),
  'runs:create': z.object({
    title: z.string().min(1).max(LIMITS.runTitle),
    issueUrl: z.string().max(2000).optional(),
    analysis: z.string().max(LIMITS.analysis).optional(),
    codebaseId: nullableId.optional(),
    provider: providerIdSchema.nullable().optional()
  }),
  'runs:update': z.object({
    id: idSchema,
    title: z.string().min(1).max(LIMITS.runTitle).optional(),
    issueUrl: z.string().max(2000).optional(),
    analysis: z.string().max(LIMITS.analysis).optional(),
    coverageNote: z.string().max(LIMITS.coverageNote).optional(),
    codebaseId: nullableId.optional(),
    provider: providerIdSchema.nullable().optional()
  }),
  'runs:saveCases': z.object({ id: idSchema, cases: z.array(caseDraftSchema).max(LIMITS.maxCases) }),
  'runs:transition': z.object({
    id: idSchema,
    action: z.enum(['approve', 'reopen', 'start', 'reject', 'finish']),
    reason: z.string().max(LIMITS.text).optional()
  }),
  'runs:delete': z.object({ id: idSchema }),
  'runs:recordResult': z.object({
    runId: idSchema,
    caseId: idSchema,
    execution: z.enum(['passed', 'failed', 'blocked']),
    resultNote: z.string().max(LIMITS.text),
    evidence: z.array(evidenceLinkSchema).max(LIMITS.evidenceLinks)
  }),
  'runs:removeCase': z.object({ runId: idSchema, caseId: idSchema }),
  'runs:aiAddCases': z.object({
    runId: idSchema,
    request: z.string().min(1).max(LIMITS.question),
    codebaseId: nullableId,
    provider: providerIdSchema,
    jobId: idSchema
  }),

  'attachments:add': z.object({
    runId: idSchema,
    caseId: idSchema,
    name: z.string().min(1).max(255),
    bytes: z.instanceof(Uint8Array)
  }),
  'attachments:remove': z.object({ runId: idSchema, caseId: idSchema, attachmentId: idSchema }),

  'chat:history': z.object({ runId: idSchema, thread: threadSchema }),
  'chat:send': z.object({
    runId: idSchema,
    thread: threadSchema,
    caseId: nullableId,
    question: z.string().min(1).max(LIMITS.question),
    codebaseId: nullableId,
    provider: providerIdSchema,
    jobId: idSchema
  }),
  'chat:clear': z.object({ runId: idSchema, thread: threadSchema }),

  'ai:cancel': z.object({ jobId: idSchema }),
  'ai:providers': z.void(),
  'ai:editDoc': z.object({
    jobId: idSchema,
    provider: providerIdSchema,
    docPath: pathSchema,
    document: z.string().max(LIMITS.docBody),
    selection: z.string().max(LIMITS.aiSelection),
    inline: z.boolean(),
    prompt: z.string().trim().min(1).max(LIMITS.aiPrompt),
    previous: z.string().max(LIMITS.aiSelection).nullable()
  }),

  'settings:get': z.void(),
  'settings:update': z.object({
    defaultProvider: providerIdSchema.optional(),
    claudeModel: z.string().min(1).max(100).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    layout: z.enum(['classic', 'explorer']).optional(),
    displayName: z.string().min(1).max(120).optional(),
    github: z
      .object({ org: z.string().max(100), sourceRepo: z.string().max(100), qaRepo: z.string().max(100) })
      .optional()
  }),
  'settings:setClaudeApiKey': z.object({ key: z.string().min(1).max(500).nullable() }),

  'import:qaPortal': z.object({ dataDir: pathSchema })
} as const

export interface IpcOutputs {
  'app:bootstrap': BootstrapInfo
  'dialog:pickFolder': string | null
  'shell:openExternal': void
  'window:openDoc': void

  'workspaces:list': Workspace[]
  'workspaces:add': Workspace
  'workspaces:activate': Workspace
  'workspaces:remove': void

  'codebases:list': Codebase[]
  'codebases:add': Codebase
  'codebases:update': Codebase
  'codebases:refresh': Codebase
  'codebases:remove': void

  'docs:list': DocEntry[]
  'docs:get': Doc
  'docs:search': SearchHit[]
  'docs:diagram': string | null
  'docs:reindex': { count: number }
  'docs:save': Doc

  'runs:list': RunSummary[]
  'runs:get': Run
  'runs:create': Run
  'runs:update': Run
  'runs:saveCases': Run
  'runs:transition': Run
  'runs:delete': void
  'runs:recordResult': Run
  'runs:removeCase': Run
  'runs:aiAddCases': { run: Run; added: TestCase[] }

  'attachments:add': Attachment
  'attachments:remove': void

  'chat:history': ChatMessage[]
  'chat:send': ChatMessage
  'chat:clear': void

  'ai:cancel': { cancelled: boolean }
  'ai:providers': ProviderStatus[]
  'ai:editDoc': { text: string; usage: AiUsage | null }

  'settings:get': Settings
  'settings:update': Settings
  'settings:setClaudeApiKey': Settings

  'import:qaPortal': ImportSummary
}

export type IpcChannel = keyof typeof ipcInputs
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcInputs)[C]>
export type IpcOutput<C extends IpcChannel> = IpcOutputs[C]

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { message: string } }

// Main → renderer push events.
export type AiEvent =
  | { jobId: string; kind: 'delta'; text: string }
  | { jobId: string; kind: 'status'; text: string }
  | { jobId: string; kind: 'done'; usage: AiUsage | null }

export interface AppEvents {
  'ai:event': AiEvent
  'docs:changed': { count: number }
}
export type AppEventName = keyof AppEvents

export const APP_EVENTS: readonly AppEventName[] = ['ai:event', 'docs:changed']
