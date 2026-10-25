import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { EvidenceLink, ResultState, Run, TestCase } from '@shared/domain'
import { EXECUTION_LABELS, VerdictBadge } from '@/components/verdict'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/fields'
import { Badge, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useRunCache } from '@/lib/queries'
import { caseNumber, cn, errorText, timeAgo } from '@/lib/utils'
import { AttachmentGrid, CaseDetails } from './case-details'

const RESULT_STYLE: Record<ResultState, string> = {
  passed: 'data-[on=true]:border-pass data-[on=true]:bg-pass-soft data-[on=true]:text-pass',
  failed: 'data-[on=true]:border-fail data-[on=true]:bg-fail-soft data-[on=true]:text-fail',
  blocked: 'data-[on=true]:border-blocked data-[on=true]:bg-blocked-soft data-[on=true]:text-blocked'
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime'

interface ResultPanelProps {
  run: Run
  testCase: TestCase
  onSaved: () => void
}

/** Records one case's result: verdict, notes, evidence links and evidence files. */
export function ResultPanel({ run, testCase, onSaved }: ResultPanelProps): React.JSX.Element {
  const client = useQueryClient()
  const cacheRun = useRunCache()
  const fileInput = useRef<HTMLInputElement>(null)
  const [execution, setExecution] = useState<ResultState | null>(testCase.execution === 'not-run' ? null : testCase.execution)
  const [note, setNote] = useState(testCase.resultNote)
  const [links, setLinks] = useState<EvidenceLink[]>(testCase.evidence)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)

  const dirty =
    execution !== (testCase.execution === 'not-run' ? null : testCase.execution) || note !== testCase.resultNote || JSON.stringify(links) !== JSON.stringify(testCase.evidence)

  const save = async (): Promise<void> => {
    if (!execution) return
    setSaving(true)
    try {
      const evidence = links.filter((link) => link.url.trim())
      cacheRun(await call('runs:recordResult', { runId: run.id, caseId: testCase.id, execution, resultNote: note, evidence }))
      onSaved()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (files: readonly File[]): Promise<void> => {
    for (const file of files) {
      setUploading((count) => count + 1)
      try {
        await call('attachments:add', { runId: run.id, caseId: testCase.id, name: file.name || 'pasted.png', bytes: new Uint8Array(await file.arrayBuffer()) })
      } catch (error) {
        toast.error(`${file.name}: ${errorText(error)}`)
      } finally {
        setUploading((count) => count - 1)
      }
    }
    await client.invalidateQueries({ queryKey: keys.run(run.id) })
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    void upload([...event.dataTransfer.files])
  }
  const onPaste = (event: ClipboardEvent): void => {
    const files = [...event.clipboardData.files]
    if (files.length) void upload(files)
  }

  const removeCase = async (): Promise<void> => {
    try {
      cacheRun(await call('runs:removeCase', { runId: run.id, caseId: testCase.id }))
      toast.success('Case removed from this test window')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <div className="flex flex-col gap-6" onPaste={onPaste}>
      <header>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span className="tabular-nums">{caseNumber(testCase.caseNo, testCase.position)}</span>
          {testCase.priority === 'high' ? <Badge tone="blocked">High priority</Badge> : null}
          <VerdictBadge execution={testCase.execution} />
          {testCase.executedAt ? <span>saved {timeAgo(testCase.executedAt)}</span> : null}
        </div>
        <h2 className="font-display mt-1 text-[18px] font-semibold tracking-tight">{testCase.title}</h2>
      </header>

      <CaseDetails testCase={testCase} />

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4" aria-label="Result">
        <div role="radiogroup" aria-label="Result" className="flex gap-2">
          {(['passed', 'failed', 'blocked'] as const).map((state) => (
            <button
              key={state}
              type="button"
              role="radio"
              aria-checked={execution === state}
              data-on={execution === state}
              onClick={() => setExecution(state)}
              className={cn('h-9 flex-1 rounded-md border border-line-strong text-[13px] font-medium text-muted hover:bg-sunken', RESULT_STYLE[state])}
            >
              {EXECUTION_LABELS[state]}
            </button>
          ))}
        </div>
        <Field label="Notes" hint="What you observed. For failed or blocked cases, describe the actual behavior or the blocker.">
          {(id) => <Textarea id={id} rows={4} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[12px] font-medium text-muted">Evidence links</legend>
          {links.map((link, index) => (
            <div key={index} className="flex gap-1">
              <Input
                aria-label={`Evidence link ${index + 1} URL`}
                placeholder="https://"
                value={link.url}
                onChange={(event) => setLinks(links.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))}
              />
              <Input
                aria-label={`Evidence link ${index + 1} label`}
                placeholder="Label (optional)"
                className="w-48"
                value={link.label}
                onChange={(event) => setLinks(links.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))}
              />
              <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => setLinks(links.filter((_, i) => i !== index))}>
                <X />
              </Button>
            </div>
          ))}
          {links.length < 10 ? (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setLinks([...links, { url: '', label: '' }])}>
                <Plus /> Add link
              </Button>
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={!execution || saving || !dirty} onClick={() => void save()}>
            {saving ? <Spinner className="size-3.5 text-current" /> : null} Save result
          </Button>
          {!execution ? <span className="text-[12px] text-muted">Choose passed, failed or blocked first.</span> : dirty ? <span className="text-[12px] text-muted">Unsaved</span> : null}
        </div>
      </section>

      <section aria-label="Evidence files" className="flex flex-col gap-2">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-muted"
        >
          <span>Drop screenshots or recordings here, paste an image, or</span>
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            {uploading ? <Spinner className="size-3.5" /> : <ImagePlus />} Choose files
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              void upload([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
        </div>
        <AttachmentGrid
          runId={run.id}
          attachments={testCase.attachments}
          onRemove={(attachment) =>
            void call('attachments:remove', { runId: run.id, caseId: testCase.id, attachmentId: attachment.id })
              .then(() => client.invalidateQueries({ queryKey: keys.run(run.id) }))
              .catch((error: unknown) => toast.error(errorText(error)))
          }
        />
        <p className="text-[11.5px] text-faint">PNG, JPEG, GIF, WebP, MP4, WebM or MOV, up to 32 MB each and 20 per case.</p>
      </section>

      {run.cases.length > 1 ? (
        <div className="border-t border-line pt-4">
          <Button variant="ghost" size="sm" onClick={() => void removeCase()}>
            Remove this case from the test window
          </Button>
        </div>
      ) : null}
    </div>
  )
}
