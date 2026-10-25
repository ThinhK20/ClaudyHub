import { X } from 'lucide-react'
import type { Attachment, TestCase } from '@shared/domain'

/** Read-only view of a test case's scenario: summary, behaviors, preconditions and steps. */
export function CaseDetails({ testCase }: { testCase: TestCase }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {testCase.summary ? <p className="max-w-[75ch]">{testCase.summary}</p> : null}
      {testCase.previousBehavior || testCase.expectedBehavior ? (
        <dl className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-line bg-sunken/60 px-3 py-2">
            <dt className="text-[12px] font-medium text-muted">Previous behavior</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{testCase.previousBehavior || '—'}</dd>
          </div>
          <div className="rounded-md border border-pass/30 bg-pass-soft/50 px-3 py-2">
            <dt className="text-[12px] font-medium text-pass">Expected behavior</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{testCase.expectedBehavior || '—'}</dd>
          </div>
        </dl>
      ) : null}
      {testCase.preconditions.length ? (
        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-muted">Preconditions</h3>
          <ul className="list-disc pl-5">
            {testCase.preconditions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {testCase.steps.length ? (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="w-10 border-b border-line-strong py-1.5 pr-2 font-semibold">Step</th>
              <th className="border-b border-line-strong px-2 py-1.5 font-semibold">Action</th>
              <th className="border-b border-line-strong px-2 py-1.5 font-semibold">Expected result</th>
            </tr>
          </thead>
          <tbody>
            {testCase.steps.map((step, index) => (
              <tr key={index} className="align-top">
                <td className="border-b border-line py-1.5 pr-2 tabular-nums text-faint">{index + 1}</td>
                <td className="whitespace-pre-wrap border-b border-line px-2 py-1.5">{step.detail}</td>
                <td className="whitespace-pre-wrap border-b border-line px-2 py-1.5">{step.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

interface AttachmentGridProps {
  runId: string
  attachments: readonly Attachment[]
  onRemove?: (attachment: Attachment) => void
}

/** Evidence thumbnails served through the qa-evidence:// protocol. */
export function AttachmentGrid({ runId, attachments, onRemove }: AttachmentGridProps): React.JSX.Element | null {
  if (!attachments.length) return null
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
      {attachments.map((attachment) => {
        const src = `qa-evidence://${runId}/${attachment.id}`
        return (
          <li key={attachment.id} className="group relative overflow-hidden rounded-md border border-line bg-sunken">
            {attachment.mime.startsWith('video/') ? (
              <video src={src} controls preload="metadata" className="aspect-video w-full object-cover" />
            ) : (
              <a href={src} target="_blank" rel="noreferrer" onClick={(event) => event.preventDefault()}>
                <img src={src} alt={attachment.name} className="aspect-video w-full object-cover" loading="lazy" />
              </a>
            )}
            <div className="truncate px-2 py-1 text-[11.5px] text-muted" title={attachment.name}>
              {attachment.name}
            </div>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(attachment)}
                className="absolute right-1 top-1 rounded bg-surface/90 p-0.5 text-muted opacity-0 hover:text-fail focus:opacity-100 group-hover:opacity-100"
                aria-label={`Remove ${attachment.name}`}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
