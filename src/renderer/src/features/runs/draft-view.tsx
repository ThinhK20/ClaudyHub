import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ProviderId, Run } from '@shared/domain'
import type { CaseDraft } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/fields'
import { EmptyState, Spinner } from '@/components/ui/misc'
import { ChatPanel } from '@/features/chat/chat-panel'
import { call } from '@/lib/ipc'
import { useRunCache } from '@/lib/queries'
import { cn, errorText } from '@/lib/utils'
import { AiCasesDialog } from './ai-cases-dialog'
import { CaseForm, EMPTY_CASE } from './case-form'

type EditableCase = CaseDraft & { key: string }

function toEditable(run: Run): EditableCase[] {
  return run.cases.map((item) => ({
    key: item.id,
    id: item.id,
    title: item.title,
    summary: item.summary,
    preconditions: item.preconditions,
    steps: item.steps,
    previousBehavior: item.previousBehavior,
    expectedBehavior: item.expectedBehavior,
    priority: item.priority
  }))
}

function stripKey({ key: _key, ...draft }: EditableCase): CaseDraft {
  return draft
}

function missingFields(draft: CaseDraft): number {
  const blanks = [draft.title, draft.summary, draft.previousBehavior, draft.expectedBehavior].filter((value) => !value.trim()).length
  const badSteps = draft.steps.filter((step) => !step.detail.trim() || !step.expected.trim()).length
  return blanks + badSteps + (draft.steps.length ? 0 : 1)
}

/** Draft stage: edit run details and cases, ask AI for more, then approve or reject. */
export function DraftView({ run, defaultProvider }: { run: Run; defaultProvider: ProviderId }): React.JSX.Element {
  const cacheRun = useRunCache()
  const [cases, setCases] = useState<EditableCase[]>(() => toEditable(run))
  const [analysis, setAnalysis] = useState(run.analysis)
  const [coverageNote, setCoverageNote] = useState(run.coverageNote)
  const [dirty, setDirty] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(run.cases[0]?.id ?? null)
  const [saving, setSaving] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<string[]>([])

  // A newer copy of the run replaces the form unless the user has unsaved edits.
  const [syncedRun, setSyncedRun] = useState(run)
  if (!dirty && run !== syncedRun) {
    setSyncedRun(run)
    setCases(toEditable(run))
    setAnalysis(run.analysis)
    setCoverageNote(run.coverageNote)
  }

  const edit = (updater: (current: EditableCase[]) => EditableCase[]): void => {
    setCases(updater)
    setDirty(true)
  }

  const save = async (): Promise<Run | null> => {
    setSaving(true)
    try {
      await call('runs:update', { id: run.id, analysis, coverageNote })
      const saved = await call('runs:saveCases', { id: run.id, cases: cases.map(stripKey) })
      cacheRun(saved)
      setDirty(false)
      return saved
    } catch (error) {
      toast.error(errorText(error))
      return null
    } finally {
      setSaving(false)
    }
  }

  const approve = async (): Promise<void> => {
    if (dirty && !(await save())) return
    try {
      cacheRun(await call('runs:transition', { id: run.id, action: 'approve' }))
      setProblems([])
      toast.success('Cases approved. Start testing when you are ready.')
    } catch (error) {
      setProblems(errorText(error).split('\n'))
    }
  }

  const reject = async (): Promise<void> => {
    try {
      cacheRun(await call('runs:transition', { id: run.id, action: 'reject', reason }))
      setRejectOpen(false)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const openAi = async (): Promise<void> => {
    if (dirty && !(await save())) return
    setAiOpen(true)
  }

  const addManual = (): void => {
    const key = crypto.randomUUID()
    edit((current) => [...current, { ...EMPTY_CASE, key }])
    setExpanded(key)
  }

  const incomplete = useMemo(() => cases.filter((item) => missingFields(item) > 0).length, [cases])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex max-w-4xl flex-col gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="What changed / analysis" hint="The ticket summary or your analysis. AI features use it as context.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  value={analysis}
                  onChange={(event) => {
                    setAnalysis(event.target.value)
                    setDirty(true)
                  }}
                />
              )}
            </Field>
            <Field label="Coverage note" hint="What this run covers and deliberately leaves out.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  value={coverageNote}
                  onChange={(event) => {
                    setCoverageNote(event.target.value)
                    setDirty(true)
                  }}
                />
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold">
              Cases <span className="font-normal text-muted">({cases.length})</span>
            </h2>
            <div className="flex gap-2">
              <Button size="sm" onClick={addManual}>
                <Plus /> Add case
              </Button>
              <Button size="sm" onClick={() => void openAi()}>
                <Sparkles /> Ask AI to add cases
              </Button>
            </div>
          </div>

          {cases.length ? (
            <ol className="flex flex-col gap-2">
              {cases.map((item, index) => {
                const open = expanded === item.key
                const missing = missingFields(item)
                return (
                  <li key={item.key} className={cn('rounded-lg border bg-surface', open ? 'border-line-strong' : 'border-line')}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setExpanded(open ? null : item.key)} aria-expanded={open}>
                        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                        <span className="w-6 shrink-0 text-[12px] tabular-nums text-faint">{index + 1}</span>
                        <span className={cn('truncate font-medium', !item.title && 'text-faint')}>{item.title || 'Untitled case'}</span>
                        {missing ? <span className="shrink-0 text-[11.5px] text-blocked">{missing} to fill in</span> : null}
                      </button>
                      <Button size="sm" variant="ghost" onClick={() => edit((current) => current.filter((entry) => entry.key !== item.key))}>
                        Remove
                      </Button>
                    </div>
                    {open ? (
                      <div className="border-t border-line px-4 py-4">
                        <CaseForm value={item} onChange={(next) => edit((current) => current.map((entry) => (entry.key === item.key ? { ...next, key: item.key } : entry)))} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          ) : (
            <EmptyState title="No cases yet">Add a case by hand, or describe the coverage you want and let the AI draft cases from the run details and your codebase.</EmptyState>
          )}

          {problems.length ? (
            <div role="alert" className="rounded-md border border-blocked/40 bg-blocked-soft px-3 py-2 text-[12.5px]">
              <p className="font-medium">Fix these before approving:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-6 flex items-center gap-2 border-t border-line bg-canvas/95 px-6 py-3 backdrop-blur">
            <Button variant="primary" onClick={() => void approve()} disabled={saving || !cases.length}>
              Approve cases
            </Button>
            <Button onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Spinner className="size-3.5" /> : null} Save draft
            </Button>
            <span className="text-[12px] text-muted">{dirty ? 'Unsaved changes' : incomplete ? `${incomplete} case${incomplete === 1 ? '' : 's'} incomplete` : 'All changes saved'}</span>
            <Button variant="ghost" className="ml-auto" onClick={() => setRejectOpen(true)}>
              Reject run
            </Button>
          </div>
        </div>
      </div>

      <ChatPanel
        className="w-[380px] shrink-0 border-l border-line"
        runId={run.id}
        thread="ask"
        title="Ask AI"
        intro="Ask about the change behind this run. Pick a codebase so the AI can look up how it is implemented."
        defaultCodebaseId={run.codebaseId}
        defaultProvider={run.provider ?? defaultProvider}
      />

      <AiCasesDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        run={run}
        defaultProvider={defaultProvider}
        onAdded={(updated, count) => {
          cacheRun(updated)
          setDirty(false)
          setCases(toEditable(updated))
          setExpanded(updated.cases.at(-count)?.id ?? null)
          toast.success(`Added ${count} case${count === 1 ? '' : 's'}. Review them before approving.`)
        }}
      />

      <Dialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this run"
        description="The run is kept for reference but can no longer be tested."
        footer={
          <Button variant="danger" disabled={!reason.trim()} onClick={() => void reject()}>
            Reject run
          </Button>
        }
      >
        <Field label="Reason">{(id) => <Textarea id={id} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}</Field>
      </Dialog>
    </div>
  )
}
