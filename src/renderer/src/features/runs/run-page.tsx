import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ExternalLink, Play, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Run } from '@shared/domain'
import { CodebaseSelect, ProviderSelect } from '@/components/pickers'
import { RunStatusBadge } from '@/components/verdict'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNotice, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useRun, useRunCache, useSettings } from '@/lib/queries'
import { errorText } from '@/lib/utils'
import { RunReview } from './completed-view'
import { DraftView } from './draft-view'
import { RunningView } from './running-view'

const route = getRouteApi('/runs/$runId')

function RunHeader({ run }: { run: Run }): React.JSX.Element {
  const client = useQueryClient()
  const navigate = useNavigate()
  const cacheRun = useRunCache()
  const settings = useSettings().data
  const [confirmDelete, setConfirmDelete] = useState(false)
  const open = run.status !== 'completed' && run.status !== 'rejected'

  const act = async (fn: () => Promise<Run>, success?: string): Promise<void> => {
    try {
      cacheRun(await fn())
      if (success) toast.success(success)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const remove = async (): Promise<void> => {
    try {
      await call('runs:delete', { id: run.id })
      client.removeQueries({ queryKey: keys.run(run.id) })
      await client.invalidateQueries({ queryKey: keys.runs })
      void navigate({ to: '/runs' })
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <PageHeader
      title={run.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={run.status} outcome={run.outcome} />
          {run.issueUrl ? (
            <a
              href={run.issueUrl}
              className="inline-flex items-center gap-1 hover:text-ink hover:underline"
              onClick={(event) => {
                event.preventDefault()
                void call('shell:openExternal', { url: run.issueUrl })
              }}
            >
              {run.issueUrl.replace(/^https?:\/\/(www\.)?/, '')} <ExternalLink className="size-3" />
            </a>
          ) : null}
        </span>
      }
      actions={
        <>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            AI reads
            <CodebaseSelect value={run.codebaseId} disabled={!open} className="h-7 text-[12px]" onChange={(codebaseId) => void act(() => call('runs:update', { id: run.id, codebaseId }))} />
          </label>
          <ProviderSelect
            value={run.provider ?? settings?.defaultProvider ?? 'copilot'}
            disabled={!open}
            className="h-7 text-[12px]"
            onChange={(provider) => void act(() => call('runs:update', { id: run.id, provider }))}
          />
          {run.status === 'ready' ? (
            <>
              <Button size="sm" onClick={() => void act(() => call('runs:transition', { id: run.id, action: 'reopen' }))}>
                <Undo2 /> Back to draft
              </Button>
              <Button size="sm" variant="primary" onClick={() => void act(() => call('runs:transition', { id: run.id, action: 'start' }), 'Test window started')}>
                <Play /> Start testing
              </Button>
            </>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="Delete run" title="Delete run" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </Button>
          <Dialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this run?"
            description="Its cases, results, evidence files and chats are deleted from this computer. This cannot be undone."
            footer={
              <>
                <Button onClick={() => setConfirmDelete(false)}>Keep run</Button>
                <Button variant="danger" onClick={() => void remove()}>
                  Delete run
                </Button>
              </>
            }
          >
            <p className="font-medium">{run.title}</p>
          </Dialog>
        </>
      }
    />
  )
}

export function RunPage(): React.JSX.Element {
  const { runId } = route.useParams()
  const run = useRun(runId)
  const defaultProvider = useSettings().data?.defaultProvider ?? 'copilot'

  if (run.isPending) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    )
  }
  if (run.error) {
    return (
      <div className="p-6">
        <ErrorNotice error={run.error} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <RunHeader run={run.data} />
      {run.data.status === 'draft' ? (
        <DraftView key={run.data.id} run={run.data} defaultProvider={defaultProvider} />
      ) : run.data.status === 'running' ? (
        <RunningView key={run.data.id} run={run.data} defaultProvider={defaultProvider} />
      ) : (
        <RunReview run={run.data} defaultProvider={defaultProvider} />
      )}
    </div>
  )
}
