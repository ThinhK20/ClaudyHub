import type { ProviderId, Run } from '@shared/domain'
import { EXECUTION_LABELS, VerdictBadge, VerdictTape } from '@/components/verdict'
import { ChatPanel } from '@/features/chat/chat-panel'
import { call } from '@/lib/ipc'
import { caseNumber, cn, formatDateTime } from '@/lib/utils'
import { AttachmentGrid, CaseDetails } from './case-details'

const BANNER = {
  passed: 'border-pass/40 bg-pass-soft',
  failed: 'border-fail/40 bg-fail-soft',
  blocked: 'border-blocked/40 bg-blocked-soft'
} as const

/** Read-only review of a finished, ready or rejected run. */
export function RunReview({ run, defaultProvider }: { run: Run; defaultProvider: ProviderId }): React.JSX.Element {
  const showResults = run.status === 'completed'
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex max-w-4xl flex-col gap-5">
          {run.status === 'completed' && run.outcome ? (
            <div className={cn('rounded-lg border px-4 py-3', BANNER[run.outcome])}>
              <p className="font-display text-[16px] font-semibold">{EXECUTION_LABELS[run.outcome]}</p>
              <p className="text-[12.5px] text-muted">Finished {formatDateTime(run.completedAt)}</p>
              <VerdictTape executions={run.executions} size="lg" className="mt-3" />
            </div>
          ) : null}
          {run.status === 'rejected' ? (
            <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3">
              <p className="font-semibold">Rejected {formatDateTime(run.rejectedAt)}</p>
              <p className="mt-1 whitespace-pre-wrap">{run.rejectionReason}</p>
            </div>
          ) : null}
          {run.analysis ? (
            <section>
              <h2 className="mb-1 text-[12px] font-semibold text-muted">What changed</h2>
              <p className="max-w-[75ch] whitespace-pre-wrap">{run.analysis}</p>
            </section>
          ) : null}
          <ol className="flex flex-col gap-3">
            {run.cases.map((item) => (
              <li key={item.id} className="rounded-lg border border-line bg-surface">
                <details open={showResults && item.execution !== 'passed'}>
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                    <span className="text-[12px] tabular-nums text-faint">{caseNumber(item.caseNo, item.position)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                    {showResults ? <VerdictBadge execution={item.execution} /> : null}
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
                    <CaseDetails testCase={item} />
                    {showResults && (item.resultNote || item.evidence.length || item.attachments.length) ? (
                      <div className="flex flex-col gap-2 border-t border-line pt-3">
                        <h3 className="text-[12px] font-semibold text-muted">Result</h3>
                        {item.resultNote ? <p className="whitespace-pre-wrap">{item.resultNote}</p> : null}
                        {item.evidence.length ? (
                          <ul className="flex flex-col gap-0.5">
                            {item.evidence.map((link) => (
                              <li key={link.url}>
                                <a
                                  href={link.url}
                                  className="text-accent underline underline-offset-2"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    void call('shell:openExternal', { url: link.url })
                                  }}
                                >
                                  {link.label || link.url}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <AttachmentGrid runId={run.id} attachments={item.attachments} />
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <ChatPanel
        className="w-[380px] shrink-0 border-l border-line"
        runId={run.id}
        thread="ask"
        title="Ask AI"
        intro="Ask about this run, its cases or the change behind it."
        defaultCodebaseId={run.codebaseId}
        defaultProvider={run.provider ?? defaultProvider}
      />
    </div>
  )
}
