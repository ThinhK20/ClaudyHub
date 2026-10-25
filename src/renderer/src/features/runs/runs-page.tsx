import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { RunStatus, RunSummary } from '@shared/domain'
import { RunStatusBadge, VerdictTape } from '@/components/verdict'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { useCodebases, useRuns } from '@/lib/queries'
import { timeAgo } from '@/lib/utils'
import { NewRunDialog } from './new-run-dialog'

const GROUPS: { title: string; statuses: RunStatus[] }[] = [
  { title: 'Testing now', statuses: ['running'] },
  { title: 'Ready to test', statuses: ['ready'] },
  { title: 'Drafts', statuses: ['draft'] },
  { title: 'Completed', statuses: ['completed'] },
  { title: 'Rejected', statuses: ['rejected'] }
]

function RunRow({ run, codebaseName }: { run: RunSummary; codebaseName?: string }): React.JSX.Element {
  return (
    <li>
      <Link to="/runs/$runId" params={{ runId: run.id }} className="grid grid-cols-[1fr_220px_auto] items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-sunken">
        <span className="min-w-0">
          <span className="block truncate font-medium">{run.title}</span>
          <span className="block truncate text-[12px] text-faint">
            {[run.issueUrl.replace(/^https?:\/\/(www\.)?/, ''), codebaseName ? `reads ${codebaseName}` : '', `updated ${timeAgo(run.updatedAt)}`].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex flex-col gap-1">
          <VerdictTape executions={run.executions} />
          <span className="text-[11.5px] tabular-nums text-faint">
            {run.executedCount}/{run.caseCount} recorded
          </span>
        </span>
        <RunStatusBadge status={run.status} outcome={run.outcome} />
      </Link>
    </li>
  )
}

export function RunsPage(): React.JSX.Element {
  const runs = useRuns()
  const codebases = useCodebases().data ?? []
  const [creating, setCreating] = useState(false)
  const nameOf = (id: string | null): string | undefined => codebases.find((item) => item.id === id)?.name

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Test runs"
        subtitle="Draft cases for a change, test them, and record the verdicts."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus /> New run
          </Button>
        }
      />
      <div className="flex max-w-5xl flex-col gap-6 p-6">
        {runs.isPending ? (
          <Spinner />
        ) : runs.data?.length ? (
          GROUPS.map((group) => {
            const items = runs.data.filter((run) => group.statuses.includes(run.status))
            if (!items.length) return null
            return (
              <section key={group.title}>
                <h2 className="mb-2 text-[13px] font-semibold">
                  {group.title} <span className="font-normal text-faint">{items.length}</span>
                </h2>
                <ul className="rounded-lg border border-line bg-surface">
                  {items.map((run) => (
                    <RunRow key={run.id} run={run} codebaseName={nameOf(run.codebaseId)} />
                  ))}
                </ul>
              </section>
            )
          })
        ) : (
          <EmptyState
            title="No test runs yet"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus /> New run
              </Button>
            }
          >
            A run collects the cases for one change. Draft them by hand or with AI, approve, then record each result with notes and evidence.
          </EmptyState>
        )}
      </div>
      <NewRunDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
