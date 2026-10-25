import { useState } from 'react'
import {
  BadgeCheck,
  Bot,
  CalendarCheck,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  Gauge,
  Hash,
  Info,
  ListChecks,
  ListTree,
  SlidersHorizontal,
  Tag,
  Timer,
  UserRound,
  type LucideIcon
} from 'lucide-react'
import { call } from '@/lib/ipc'
import { cn } from '@/lib/utils'

const COPIED_RESET_MS = 1500

/** First matching rule wins. */
const FIELD_ICONS: [RegExp, LucideIcon][] = [
  [/tag|label|categor/, Tag],
  [/area|group|feature|module/, Folder],
  [/(^|_)id$|key|number/, Hash],
  [/trello|link|url/, ExternalLink],
  [/estimate|duration|effort/, Timer],
  [/automat/, Bot],
  [/checklist|items|steps|count/, ListChecks],
  [/review|date|updated|created/, CalendarCheck],
  [/status|state|result/, BadgeCheck],
  [/priority|severity|risk/, Gauge],
  [/owner|author|assignee|tester/, UserRound]
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function fieldIcon(key: string): LucideIcon {
  return FIELD_ICONS.find(([pattern]) => pattern.test(key.toLowerCase()))?.[1] ?? Info
}

function fieldLabel(key: string): string {
  return key.replaceAll('_', ' ').replace(/^\w/, (char) => char.toUpperCase())
}

function listOf(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).filter(Boolean)
  return null
}

function scalarText(value: unknown): string {
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '')
}

function hasValue(value: unknown): boolean {
  const list = listOf(value)
  return list ? list.length > 0 : scalarText(value) !== ''
}

function formatDate(text: string): string {
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Chips({ items, tone }: { items: string[]; tone: 'accent' | 'neutral' }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className={cn('rounded px-1.5 py-px text-[11.5px] leading-[18px]', tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink')}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function PropertyValue({ field, value }: { field: string; value: unknown }): React.JSX.Element {
  const list = listOf(value)
  const key = field.toLowerCase()
  if (list) return <Chips items={list} tone={/tag|label/.test(key) ? 'accent' : 'neutral'} />

  const text = scalarText(value)
  if (/^tags?$/.test(key)) return <Chips items={text.split(',').map((part) => part.trim()).filter(Boolean)} tone="accent" />
  if (key === 'trello_shortlink' && /^[A-Za-z0-9]+$/.test(text)) {
    return (
      <button
        type="button"
        onClick={() => void call('shell:openExternal', { url: `https://trello.com/c/${text}` })}
        className="inline-flex items-center gap-1 font-mono text-[11.5px] text-accent hover:underline"
        title="Open the Trello card"
      >
        {text}
        <ExternalLink className="size-3" />
      </button>
    )
  }
  if (ISO_DATE.test(text)) return <span title={text}>{formatDate(text)}</span>
  if (/(^|_)id$|shortlink/.test(key)) return <span className="font-mono text-[11.5px]">{text}</span>
  if (/^(tbd|n\/a|none|-)$/i.test(text)) return <span className="italic text-faint">{text}</span>
  return <span className="break-words">{text}</span>
}

/** Frontmatter as rows, with estimate and its unit merged into one value. */
function propertyRows(frontmatter: Record<string, unknown>): [string, unknown][] {
  const unit = frontmatter.estimate_unit
  return Object.entries(frontmatter)
    .filter(([key, value]) => key !== 'title' && hasValue(value))
    .filter(([key]) => !(key === 'estimate_unit' && hasValue(frontmatter.estimate)))
    .map(([key, value]): [string, unknown] => (key === 'estimate' && hasValue(unit) ? [key, `${scalarText(value)} ${scalarText(unit)}`] : [key, value]))
}

function PanelHeading({ icon: Icon, children }: { icon: LucideIcon; children: string }): React.JSX.Element {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
      <Icon className="size-3.5" />
      {children}
    </h2>
  )
}

function CopyPath({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-surface px-2.5 py-2">
      <FileText className="mt-0.5 size-3.5 shrink-0 text-faint" />
      <p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-muted">{path}</p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(path).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), COPIED_RESET_MS)
          })
        }}
        className="rounded p-0.5 text-faint hover:bg-sunken hover:text-ink"
        aria-label="Copy file path"
        title="Copy file path"
      >
        {copied ? <Check className="size-3.5 text-pass" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

interface DocPropertiesProps {
  frontmatter: Record<string, unknown>
  headings: { depth: 2 | 3; text: string; id: string }[]
  path: string
}

/** Side panel of a library document: its frontmatter, an outline and the file path. */
export function DocProperties({ frontmatter, headings, path }: DocPropertiesProps): React.JSX.Element {
  const rows = propertyRows(frontmatter)
  return (
    <div className="flex flex-col gap-6">
      {rows.length ? (
        <section>
          <PanelHeading icon={SlidersHorizontal}>Properties</PanelHeading>
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface text-[12.5px]">
            {rows.map(([key, value]) => {
              const Icon = fieldIcon(key)
              return (
                <div key={key} className="flex gap-3 px-3 py-2">
                  <dt className="flex w-[42%] shrink-0 items-start gap-1.5 text-muted">
                    <Icon className="mt-[3px] size-3.5 shrink-0 text-faint" />
                    <span className="min-w-0">{fieldLabel(key)}</span>
                  </dt>
                  <dd className="min-w-0 flex-1 text-ink">
                    <PropertyValue field={key} value={value} />
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ) : null}
      {headings.length ? (
        <nav aria-label="On this page">
          <PanelHeading icon={ListTree}>On this page</PanelHeading>
          <ul className="flex flex-col border-l border-line text-[12.5px]">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className={cn(
                    '-ml-px block border-l-2 border-transparent py-1 pr-2 text-muted hover:border-accent hover:text-ink',
                    heading.depth === 3 ? 'pl-6 text-[12px]' : 'pl-3'
                  )}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <CopyPath path={path} />
    </div>
  )
}
