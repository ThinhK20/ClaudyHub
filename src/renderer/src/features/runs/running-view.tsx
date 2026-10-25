import { useState } from 'react'
import { Flag, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { ProviderId, Run } from '@shared/domain'
import { EXECUTION_LABELS, VerdictBadge, VerdictTape } from '@/components/verdict'
import { Button } from '@/components/ui/button'
import { ChatPanel } from '@/features/chat/chat-panel'
import { call } from '@/lib/ipc'
import { useRunCache } from '@/lib/queries'
import { caseNumber, cn, errorText } from '@/lib/utils'
import { ResultPanel } from './result-panel'

const FINAL = 'final'
const ASSISTANT_KEY = 'qa-hub.assistant-open'

const DOT: Record<string, string> = { 'not-run': 'bg-notrun/50', passed: 'bg-pass', failed: 'bg-fail', blocked: 'bg-blocked' }

function readAssistantOpen(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_KEY) !== 'false'
  } catch {
    return true
  }
}

function FinalPanel({ run }: { run: Run }): React.JSX.Element {
  const cacheRun = useRunCache()
  const [finishing, setFinishing] = useState(false)
  const remaining = run.cases.filter((item) => item.execution === 'not-run').length
  const counts = (['passed', 'failed', 'blocked', 'not-run'] as const).map((state) => ({ state, count: run.cases.filter((item) => item.execution === state).length }))

  const finish = async (): Promise<void> => {
    setFinishing(true)
    try {
      cacheRun(await call('runs:transition', { id: run.id, action: 'finish' }))
      toast.success('Test window finished')
    } catch (error) {
      toast.error(errorText(error))
      setFinishing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-[18px] font-semibold tracking-tight">Finish the test window</h2>
      <dl className="flex gap-6">
        {counts.map(({ state, count }) => (
          <div key={state}>
            <dt className="text-[12px] text-muted">{EXECUTION_LABELS[state]}</dt>
            <dd className="font-display text-[20px] font-semibold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      <ul className="rounded-lg border border-line bg-surface">
        {run.cases.map((item) => (
          <li key={item.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="pt-0.5 text-[12px] tabular-nums text-faint">{caseNumber(item.caseNo, item.position)}</span>
            <span>
              <span className="font-medium">{item.title}</span>
              {item.resultNote ? <span className="mt-0.5 block whitespace-pre-wrap text-[12.5px] text-muted">{item.resultNote}</span> : null}
            </span>
            <VerdictBadge execution={item.execution} />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={remaining > 0 || finishing} onClick={() => void finish()}>
          <Flag /> Finish test window
        </Button>
        <span className="text-[12.5px] text-muted">
          {remaining ? `Record a result for ${remaining} more case${remaining === 1 ? '' : 's'} first.` : 'The outcome is worked out from the case results.'}
        </span>
      </div>
    </div>
  )
}

/** Testing stage: case list, result form, and the Test Assistant beside them. */
export function RunningView({ run, defaultProvider }: { run: Run; defaultProvider: ProviderId }): React.JSX.Element {
  const firstOpen = run.cases.find((item) => item.execution === 'not-run')?.id ?? run.cases[0]?.id ?? FINAL
  const [chosen, setSelected] = useState<string>(firstOpen)
  const [assistantOpen, setAssistantOpen] = useState(readAssistantOpen)

  // A case removed from the run falls back to the first one.
  const selected = chosen === FINAL || run.cases.some((item) => item.id === chosen) ? chosen : (run.cases[0]?.id ?? FINAL)

  const toggleAssistant = (): void => {
    setAssistantOpen((open) => {
      try {
        localStorage.setItem(ASSISTANT_KEY, String(!open))
      } catch {
        // preference is optional
      }
      return !open
    })
  }

  const index = run.cases.findIndex((item) => item.id === selected)
  const current = index >= 0 ? run.cases[index] : undefined
  const goNext = (): void => {
    const next = run.cases.slice(index + 1).find((item) => item.execution === 'not-run') ?? run.cases.find((item) => item.execution === 'not-run')
    setSelected(next?.id ?? FINAL)
  }
  const label = (caseId: string): string => {
    const item = run.cases.find((entry) => entry.id === caseId)
    return item ? `case ${caseNumber(item.caseNo, item.position)}` : 'a removed case'
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-72 shrink-0 flex-col border-r border-line" aria-label="Cases">
        <div className="border-b border-line px-3 py-3">
          <VerdictTape executions={run.executions} size="lg" activeIndex={index} onSelect={(i) => setSelected(run.cases[i]?.id ?? FINAL)} />
          <p className="mt-2 text-[12px] text-muted">
            {run.executedCount} of {run.caseCount} recorded
          </p>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {run.cases.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item.id)}
                aria-current={item.id === selected}
                className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left', item.id === selected ? 'bg-surface shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-sunken')}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[item.execution])} aria-label={EXECUTION_LABELS[item.execution]} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{item.title}</span>
                  <span className="block text-[11.5px] tabular-nums text-faint">{caseNumber(item.caseNo, item.position)}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              onClick={() => setSelected(FINAL)}
              aria-current={selected === FINAL}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', selected === FINAL ? 'bg-surface font-medium shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-sunken')}
            >
              <Flag className="size-3.5 text-muted" /> Finish
            </button>
          </li>
        </ol>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={toggleAssistant} aria-pressed={assistantOpen}>
            {assistantOpen ? <PanelRightClose /> : <PanelRightOpen />} Test Assistant
          </Button>
        </div>
        <div className="max-w-3xl">
          {current ? <ResultPanel key={current.id} run={run} testCase={current} onSaved={goNext} /> : <FinalPanel run={run} />}
        </div>
      </div>

      {assistantOpen ? (
        <ChatPanel
          className="w-[380px] shrink-0 border-l border-line"
          runId={run.id}
          thread="assistant"
          title="Test Assistant"
          intro="Ask about the selected case: what to check, what the expected behavior means, or how the code handles it. The assistant explains; it never changes results."
          caseId={current?.id ?? null}
          caseLabel={label}
          defaultCodebaseId={run.codebaseId}
          defaultProvider={run.provider ?? defaultProvider}
        />
      ) : null}
    </div>
  )
}
