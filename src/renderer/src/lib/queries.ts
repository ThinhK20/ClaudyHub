import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type {
  BootstrapInfo,
  ChatMessage,
  ChatThread,
  Codebase,
  DocEntry,
  ProviderStatus,
  Run,
  RunSummary,
  Settings,
  Workspace
} from '@shared/domain'
import { call, useAppEvent } from './ipc'

export const keys = {
  bootstrap: ['bootstrap'] as const,
  settings: ['settings'] as const,
  workspaces: ['workspaces'] as const,
  codebases: ['codebases'] as const,
  docs: ['docs'] as const,
  doc: (path: string) => ['docs', 'doc', path] as const,
  search: (query: string) => ['docs', 'search', query] as const,
  diagram: (area: string) => ['docs', 'diagram', area] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  chat: (runId: string, thread: ChatThread) => ['chat', runId, thread] as const,
  providers: ['providers'] as const
}

export const useBootstrap = (): UseQueryResult<BootstrapInfo> =>
  useQuery({ queryKey: keys.bootstrap, queryFn: () => call('app:bootstrap') })

export const useSettings = (): UseQueryResult<Settings> => useQuery({ queryKey: keys.settings, queryFn: () => call('settings:get') })

export const useWorkspaces = (): UseQueryResult<Workspace[]> =>
  useQuery({ queryKey: keys.workspaces, queryFn: () => call('workspaces:list') })

export const useCodebases = (): UseQueryResult<Codebase[]> =>
  useQuery({ queryKey: keys.codebases, queryFn: () => call('codebases:list') })

export const useDocs = (): UseQueryResult<DocEntry[]> => useQuery({ queryKey: keys.docs, queryFn: () => call('docs:list') })

export const useRuns = (): UseQueryResult<RunSummary[]> => useQuery({ queryKey: keys.runs, queryFn: () => call('runs:list') })

export const useRun = (id: string): UseQueryResult<Run> => useQuery({ queryKey: keys.run(id), queryFn: () => call('runs:get', { id }) })

export const useChat = (runId: string, thread: ChatThread): UseQueryResult<ChatMessage[]> =>
  useQuery({ queryKey: keys.chat(runId, thread), queryFn: () => call('chat:history', { runId, thread }) })

export const useProviders = (): UseQueryResult<ProviderStatus[]> =>
  useQuery({ queryKey: keys.providers, queryFn: () => call('ai:providers'), staleTime: 5 * 60_000 })

/** Keeps cached run data in sync after a mutation returns the updated run. */
export function useRunCache(): (run: Run) => void {
  const client = useQueryClient()
  return (run) => {
    client.setQueryData(keys.run(run.id), run)
    void client.invalidateQueries({ queryKey: keys.runs, exact: true })
  }
}

/** Refreshes library queries whenever the main process re-indexes the workspace. */
export function useAppEventInvalidation(): void {
  const client = useQueryClient()
  useAppEvent('docs:changed', () => {
    void client.invalidateQueries({ queryKey: keys.docs })
  })
}
