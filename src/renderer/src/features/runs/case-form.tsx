import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { CaseDraft } from '@shared/schemas'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

export const EMPTY_CASE: CaseDraft = {
  title: '',
  summary: '',
  preconditions: [''],
  steps: [{ detail: '', expected: '' }],
  previousBehavior: '',
  expectedBehavior: '',
  priority: ''
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items]
  const copy = [...items]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item as T)
  return copy
}

const replaceAt = <T,>(items: readonly T[], index: number, value: T): T[] => items.map((item, i) => (i === index ? value : item))
const removeAt = <T,>(items: readonly T[], index: number): T[] => items.filter((_, i) => i !== index)

function RowActions({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-start gap-0.5 pt-0.5">
      <Button size="icon" variant="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp />
      </Button>
      <Button size="icon" variant="ghost" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown />
      </Button>
      <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
        <X />
      </Button>
    </div>
  )
}

/** Field editor for one draft case. Every change produces a new CaseDraft. */
export function CaseForm({ value, onChange }: { value: CaseDraft; onChange: (next: CaseDraft) => void }): React.JSX.Element {
  const set = <K extends keyof CaseDraft>(key: K, next: CaseDraft[K]): void => onChange({ ...value, [key]: next })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Title">{(id) => <Input id={id} value={value.title} onChange={(event) => set('title', event.target.value)} placeholder="Short scenario name" />}</Field>
        <label className="flex h-8 items-center gap-2 text-[12.5px] text-muted">
          <input type="checkbox" className="accent-[var(--accent)]" checked={value.priority === 'high'} onChange={(event) => set('priority', event.target.checked ? 'high' : '')} />
          High priority
        </label>
      </div>
      <Field label="Summary">{(id) => <Textarea id={id} rows={2} value={value.summary} onChange={(event) => set('summary', event.target.value)} />}</Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Previous behavior">{(id) => <Textarea id={id} rows={2} value={value.previousBehavior} onChange={(event) => set('previousBehavior', event.target.value)} />}</Field>
        <Field label="Expected behavior">{(id) => <Textarea id={id} rows={2} value={value.expectedBehavior} onChange={(event) => set('expectedBehavior', event.target.value)} />}</Field>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[12px] font-medium text-muted">Preconditions</legend>
        {value.preconditions.map((item, index) => (
          <div key={index} className="flex gap-1">
            <Input aria-label={`Precondition ${index + 1}`} value={item} onChange={(event) => set('preconditions', replaceAt(value.preconditions, index, event.target.value))} />
            <RowActions
              index={index}
              count={value.preconditions.length}
              label={`precondition ${index + 1}`}
              onMove={(to) => set('preconditions', move(value.preconditions, index, to))}
              onRemove={() => set('preconditions', removeAt(value.preconditions, index))}
            />
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => set('preconditions', [...value.preconditions, ''])}>
            <Plus /> Add precondition
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[12px] font-medium text-muted">Steps</legend>
        {value.steps.map((step, index) => (
          <div key={index} className="flex gap-1">
            <span className="w-6 shrink-0 pt-1.5 text-right text-[12px] tabular-nums text-faint">{index + 1}</span>
            <div className="grid flex-1 gap-1 md:grid-cols-2">
              <Textarea
                rows={1}
                aria-label={`Step ${index + 1} action`}
                placeholder="Action"
                value={step.detail}
                onChange={(event) => set('steps', replaceAt(value.steps, index, { ...step, detail: event.target.value }))}
              />
              <Textarea
                rows={1}
                aria-label={`Step ${index + 1} expected result`}
                placeholder="Expected result"
                className={cn(!step.expected && step.detail && 'border-blocked/60')}
                value={step.expected}
                onChange={(event) => set('steps', replaceAt(value.steps, index, { ...step, expected: event.target.value }))}
              />
            </div>
            <RowActions
              index={index}
              count={value.steps.length}
              label={`step ${index + 1}`}
              onMove={(to) => set('steps', move(value.steps, index, to))}
              onRemove={() => set('steps', removeAt(value.steps, index))}
            />
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => set('steps', [...value.steps, { detail: '', expected: '' }])}>
            <Plus /> Add step
          </Button>
        </div>
      </fieldset>
    </div>
  )
}
