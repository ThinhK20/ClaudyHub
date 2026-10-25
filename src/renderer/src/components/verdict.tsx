import type { Execution, Outcome, RunStatus } from '@shared/domain'
import { cn, STATUS_LABELS } from '@/lib/utils'
import { Badge } from './ui/misc'

export const EXECUTION_LABELS: Record<Execution, string> = {
  'not-run': 'Not run',
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked'
}

const SEGMENT: Record<Execution, string> = {
  'not-run': 'bg-notrun/45',
  passed: 'bg-pass',
  failed: 'bg-fail',
  blocked: 'bg-blocked'
}

const TONE = { 'not-run': 'neutral', passed: 'pass', failed: 'fail', blocked: 'blocked' } as const

export function VerdictBadge({ execution }: { execution: Execution }): React.JSX.Element {
  return <Badge tone={TONE[execution]}>{EXECUTION_LABELS[execution]}</Badge>
}

function tapeSummary(executions: readonly Execution[]): string {
  const counts = executions.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }), {})
  return (['passed', 'failed', 'blocked', 'not-run'] as const)
    .filter((key) => counts[key])
    .map((key) => `${counts[key]} ${EXECUTION_LABELS[key].toLowerCase()}`)
    .join(', ')
}

interface VerdictTapeProps {
  executions: readonly Execution[]
  size?: 'sm' | 'lg'
  activeIndex?: number
  onSelect?: (index: number) => void
  className?: string
}

/** One segment per case, coloured by its saved result: the run's state at a glance. */
export function VerdictTape({ executions, size = 'sm', activeIndex, onSelect, className }: VerdictTapeProps): React.JSX.Element {
  if (!executions.length) return <div className={cn('h-1.5 rounded-sm bg-sunken', className)} aria-label="No cases yet" />
  return (
    <div className={cn('flex gap-[2px]', size === 'lg' ? 'h-2.5' : 'h-1.5', className)} role="img" aria-label={tapeSummary(executions)} title={tapeSummary(executions)}>
      {executions.map((execution, index) => {
        const segment = cn(
          'min-w-[3px] flex-1 rounded-[2px] transition-[outline]',
          SEGMENT[execution],
          index === activeIndex && 'outline outline-2 outline-offset-1 outline-ink'
        )
        return onSelect ? (
          <button key={index} type="button" className={segment} onClick={() => onSelect(index)} aria-label={`Case ${index + 1}: ${EXECUTION_LABELS[execution]}`} />
        ) : (
          <span key={index} className={segment} />
        )
      })}
    </div>
  )
}

const OUTCOME_TONE = { passed: 'pass', failed: 'fail', blocked: 'blocked' } as const

export function RunStatusBadge({ status, outcome }: { status: RunStatus; outcome: Outcome | null }): React.JSX.Element {
  if (status === 'completed' && outcome) return <Badge tone={OUTCOME_TONE[outcome]}>{EXECUTION_LABELS[outcome]}</Badge>
  const tone = status === 'running' ? 'accent' : status === 'rejected' ? 'fail' : 'neutral'
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>
}
