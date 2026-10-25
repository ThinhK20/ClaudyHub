import { useState } from 'react'
import { Sparkles, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { ProviderId, Run } from '@shared/domain'
import { CodebaseSelect, ProviderSelect } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/fields'
import { Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { useAiJob } from '@/lib/use-ai-job'
import { errorText } from '@/lib/utils'

interface AiCasesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: Run
  defaultProvider: ProviderId
  onAdded: (run: Run, addedCount: number) => void
}

/** Asks the AI for up to five more draft cases, optionally grounded in a connected codebase. */
export function AiCasesDialog({ open, onOpenChange, run, defaultProvider, onAdded }: AiCasesDialogProps): React.JSX.Element {
  const job = useAiJob()
  const [request, setRequest] = useState('')
  const [codebaseId, setCodebaseId] = useState<string | null>(run.codebaseId)
  const [provider, setProvider] = useState<ProviderId>(run.provider ?? defaultProvider)

  const generate = async (): Promise<void> => {
    try {
      const result = await job.run((jobId) => call('runs:aiAddCases', { runId: run.id, request: request.trim(), codebaseId, provider, jobId }))
      onAdded(result.run, result.added.length)
      setRequest('')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !job.running && onOpenChange(next)}
      title="Ask AI to add cases"
      description="Describe the coverage you want. The AI proposes up to five cases; review and edit them before approving."
      footer={
        job.running ? (
          <Button variant="danger" onClick={job.cancel}>
            <Square /> Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!request.trim()} onClick={() => void generate()}>
            <Sparkles /> Propose cases
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What should the new cases cover?">
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              value={request}
              disabled={job.running}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="e.g. negative cases for invalid dates, and permissions for read-only users"
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Codebase to read" hint="Read-only. Choose none to use only the run details.">
            {(id) => <CodebaseSelect id={id} value={codebaseId} onChange={setCodebaseId} disabled={job.running} className="w-full" />}
          </Field>
          <Field label="AI engine">{(id) => <ProviderSelect id={id} value={provider} onChange={setProvider} disabled={job.running} className="w-full" />}</Field>
        </div>
        {job.running ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <Spinner className="size-3.5" /> {job.status || 'Drafting cases…'}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
