import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { ProviderId } from '@shared/domain'
import { CodebaseSelect, ProviderSelect } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/fields'
import { call } from '@/lib/ipc'
import { keys, useCodebases, useSettings } from '@/lib/queries'
import { errorText } from '@/lib/utils'

/** Creates a draft run; the codebase and engine chosen here become the run's AI defaults. */
export function NewRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const client = useQueryClient()
  const navigate = useNavigate()
  const settings = useSettings().data
  const codebases = useCodebases().data ?? []
  const [title, setTitle] = useState('')
  const [issueUrl, setIssueUrl] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [codebaseId, setCodebaseId] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderId>('copilot')
  const [creating, setCreating] = useState(false)

  // Each time the dialog opens (or its defaults load while open) the pickers start on the defaults.
  const defaultCodebaseId = codebases.find((item) => item.isDefault)?.id ?? null
  const defaultProvider = settings?.defaultProvider ?? 'copilot'
  const defaults = open ? `${defaultCodebaseId ?? ''}|${defaultProvider}` : null
  const [appliedDefaults, setAppliedDefaults] = useState<string | null>(null)
  if (defaults !== appliedDefaults) {
    setAppliedDefaults(defaults)
    if (open) {
      setCodebaseId(defaultCodebaseId)
      setProvider(defaultProvider)
    }
  }

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      const run = await call('runs:create', { title: title.trim(), issueUrl: issueUrl.trim(), analysis, codebaseId, provider })
      await client.invalidateQueries({ queryKey: keys.runs })
      onOpenChange(false)
      setTitle('')
      setIssueUrl('')
      setAnalysis('')
      void navigate({ to: '/runs/$runId', params: { runId: run.id } })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New test run"
      description="Start a draft for a change you need to test. You can add cases by hand or let the AI draft them."
      footer={
        <Button variant="primary" disabled={!title.trim() || creating} onClick={() => void create()}>
          Create draft
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim()) void create()
        }}
      >
        <Field label="Title">{(id) => <Input id={id} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Event sign-up respects standby list" />}</Field>
        <Field label="Issue link" hint="Optional. The GitHub issue or ticket this run verifies.">
          {(id) => <Input id={id} value={issueUrl} onChange={(event) => setIssueUrl(event.target.value)} placeholder="https://github.com/…/issues/123" />}
        </Field>
        <Field label="What changed" hint="Paste the ticket description or your analysis. AI features use it as context.">
          {(id) => <Textarea id={id} rows={5} value={analysis} onChange={(event) => setAnalysis(event.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Codebase for AI" hint="Read-only access.">
            {(id) => <CodebaseSelect id={id} value={codebaseId} onChange={setCodebaseId} className="w-full" />}
          </Field>
          <Field label="AI engine">{(id) => <ProviderSelect id={id} value={provider} onChange={setProvider} className="w-full" />}</Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  )
}
