// Domain types shared by the main process and the renderer. All timestamps are ISO-8601 strings.

export type RunStatus = 'draft' | 'ready' | 'running' | 'completed' | 'rejected'
export type Execution = 'not-run' | 'passed' | 'failed' | 'blocked'
export type Outcome = 'passed' | 'failed' | 'blocked'
export type ResultState = Exclude<Execution, 'not-run'>
export type ProviderId = 'copilot' | 'claude'
export type ChatThread = 'ask' | 'assistant'
export type ThemePreference = 'system' | 'light' | 'dark'

/** Classic: sidebar navigation with the grouped Library. Explorer: a file tree of the workspace with documents opened as tabs. */
export type LayoutPreference = 'classic' | 'explorer'

export interface Workspace {
  id: string
  name: string
  path: string
  active: boolean
  createdAt: string
}

export interface Codebase {
  id: string
  name: string
  path: string
  isDefault: boolean
  isGitRepo: boolean
  gitBranch: string | null
  gitHead: string | null
  available: boolean
  lastCheckedAt: string | null
  createdAt: string
}

export interface CaseStep {
  detail: string
  expected: string
}

export interface EvidenceLink {
  url: string
  label: string
}

export interface Attachment {
  id: string
  caseId: string
  name: string
  mime: string
  size: number
  uploadedAt: string
}

export interface TestCase {
  id: string
  runId: string
  /** Six-digit QA case number, assigned when the draft is approved. */
  caseNo: number | null
  title: string
  summary: string
  preconditions: string[]
  steps: CaseStep[]
  previousBehavior: string
  expectedBehavior: string
  priority: '' | 'high'
  position: number
  execution: Execution
  resultNote: string
  executedAt: string | null
  evidence: EvidenceLink[]
  attachments: Attachment[]
}

export interface RunSummary {
  id: string
  workspaceId: string | null
  codebaseId: string | null
  provider: ProviderId | null
  title: string
  issueUrl: string
  status: RunStatus
  outcome: Outcome | null
  caseCount: number
  executedCount: number
  /** Each case's result in case order; drives the verdict tape. */
  executions: Execution[]
  createdAt: string
  updatedAt: string
}

export interface Run extends RunSummary {
  analysis: string
  coverageNote: string
  rejectionReason: string
  reviewedAt: string | null
  startedAt: string | null
  completedAt: string | null
  rejectedAt: string | null
  cases: TestCase[]
}

export type DocSection = 'test-cases' | 'assets' | 'releases' | 'test-runs' | 'guides'

export interface DocEntry {
  path: string
  section: DocSection
  group: string
  title: string
  frontmatter: Record<string, unknown>
  checks: number
  done: number
  steps: number
}

export interface Doc extends DocEntry {
  body: string
  /** False when the frontmatter could not be parsed, so saving the body could not keep it intact. */
  editable: boolean
}

export interface SearchHit {
  path: string
  title: string
  section: DocSection
  /** Snippet text; matched terms are wrapped in \u0002 … \u0003 markers. */
  snippet: string
}

export interface AiUsage {
  model?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  costUsd?: number
  premiumRequests?: number
  elapsedMs: number
}

export type ChatStatus = 'pending' | 'done' | 'error' | 'cancelled' | 'interrupted'

export interface ChatMessage {
  id: string
  runId: string
  thread: ChatThread
  caseId: string | null
  role: 'user' | 'assistant'
  text: string
  provider: ProviderId | null
  codebaseId: string | null
  usage: AiUsage | null
  status: ChatStatus
  createdAt: string
}

export interface GithubSettings {
  org: string
  sourceRepo: string
  qaRepo: string
}

export interface Settings {
  defaultProvider: ProviderId
  claudeModel: string
  theme: ThemePreference
  layout: LayoutPreference
  displayName: string
  github: GithubSettings
  hasClaudeApiKey: boolean
}

export interface ProviderStatus {
  id: ProviderId
  ok: boolean
  detail: string
}

export interface BootstrapInfo {
  version: string
  workspace: Workspace | null
  codebases: Codebase[]
  settings: Settings
}

export interface ImportSummary {
  runs: number
  cases: number
  attachments: number
  chatMessages: number
  skipped: string[]
}
