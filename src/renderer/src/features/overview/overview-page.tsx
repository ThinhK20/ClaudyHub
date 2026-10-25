import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { RunSummary } from '@shared/domain'
import { RunStatusBadge, VerdictTape } from '@/components/verdict'
import { EmptyState, PageHeader, Panel } from '@/components/ui/misc'
import { useBootstrap, useCodebases, useDocs, useRuns } from '@/lib/queries'
import { SECTION_LABELS, SECTION_ORDER, timeAgo } from '@/lib/utils'

function Figure({ value, label, detail }: { value: string | number; label: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col border-l border-line pl-4 first:border-l-0 first:pl-0">
      <span className="font-display text-[22px] font-semibold tabular-nums leading-tight">{value}</span>
      <span className="text-[12.5px] text-muted">{label}</span>
      {detail ? <span className="text-[11.5px] text-faint">{detail}</span> : null}
    </div>
  )
}

function RunRow({ run }: { run: RunSummary }): React.JSX.Element {
  return (
    <Link to="/runs/$runId" params={{ runId: run.id }} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-md px-2 py-2 hover:bg-sunken">
      <span className="truncate font-medium">{run.title}</span>
      <span className="flex items-center gap-2 text-[12px] text-faint">
        {timeAgo(run.updatedAt)} <RunStatusBadge status={run.status} outcome={run.outcome} />
      </span>
      <VerdictTape executions={run.executions} className="col-span-2" />
    </Link>
  )
}

export function OverviewPage(): React.JSX.Element {
  const workspace = useBootstrap().data?.workspace
  const docs = useDocs().data ?? []
  const runs = useRuns().data ?? []
  const codebases = useCodebases().data ?? []

  const stats = useMemo(() => {
    const cases = docs.filter((doc) => doc.section === 'test-cases')
    const assets = docs.filter((doc) => doc.section === 'assets')
    const checks = assets.reduce((sum, doc) => sum + doc.checks, 0)
    const completed = runs.filter((run) => run.status === 'completed')
    const passed = completed.filter((run) => run.outcome === 'passed').length
    return {
      cases: cases.length,
      areas: new Set(cases.map((doc) => doc.group.split('/')[0])).size,
      assets: assets.length,
      checks,
      active: runs.filter((run) => run.status === 'running' || run.status === 'ready').length,
      drafts: runs.filter((run) => run.status === 'draft').length,
      passRate: completed.length ? `${Math.round((passed / completed.length) * 100)}%` : '–',
      completed: completed.length
    }
  }, [docs, runs])

  const active = runs.filter((run) => run.status === 'running' || run.status === 'ready' || run.status === 'draft').slice(0, 8)
  const recent = runs.filter((run) => run.status === 'completed').slice(0, 6)
  const sectionCounts = SECTION_ORDER.map((section) => ({ section, count: docs.filter((doc) => doc.section === section).length }))

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Overview" subtitle={workspace?.path} />
      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-2 gap-y-4 rounded-lg border border-line bg-surface px-5 py-4 lg:grid-cols-4">
          <Figure value={stats.cases} label="Test cases" detail={`${stats.areas} feature areas`} />
          <Figure value={stats.assets} label="Regression checklists" detail={`${stats.checks} checklist items`} />
          <Figure value={stats.active} label="Runs to test" detail={`${stats.drafts} drafts`} />
          <Figure value={stats.passRate} label="Runs passed" detail={`of ${stats.completed} completed`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Panel
            title="In progress"
            actions={
              <Link to="/runs" className="text-[12.5px] text-accent hover:underline">
                All runs
              </Link>
            }
          >
            {active.length ? (
              <div className="-mx-2 flex flex-col">
                {active.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </div>
            ) : (
              <EmptyState title="No runs in progress">Create a test run from the Test runs page to draft cases and record results.</EmptyState>
            )}
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title="Recently completed">
              {recent.length ? (
                <div className="-mx-2 flex flex-col">
                  {recent.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </div>
              ) : (
                <p className="text-muted">Finished runs appear here with their verdicts.</p>
              )}
            </Panel>
            <Panel title="Library">
              <ul className="flex flex-col">
                {sectionCounts.map(({ section, count }) => (
                  <li key={section}>
                    <Link to="/library" search={{ section }} className="flex justify-between rounded px-1 py-1 hover:bg-sunken">
                      <span>{SECTION_LABELS[section]}</span>
                      <span className="tabular-nums text-muted">{count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            {codebases.length === 0 ? (
              <EmptyState
                title="AI can't see any code yet"
                action={
                  <Link to="/codebases" className="text-[12.5px] font-medium text-accent hover:underline">
                    Connect a codebase
                  </Link>
                }
              >
                Connect a source folder so assistants can explain behavior and ground new cases in the implementation.
              </EmptyState>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
