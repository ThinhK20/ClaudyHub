import { Link } from '@tanstack/react-router'
import type { DocEntry } from '@shared/domain'
import { Markdown } from '@/components/markdown'
import { Badge } from '@/components/ui/misc'
import { groupLabel } from '@/lib/utils'

/** Pieces shared by the classic Library page and the explorer's folder page. */

function statusTone(status: unknown): 'pass' | 'fail' | 'blocked' | 'neutral' {
  const value = String(status ?? '').toLowerCase()
  if (value === 'passed' || value === 'pass') return 'pass'
  if (value === 'failed' || value === 'fail') return 'fail'
  if (value === 'blocked') return 'blocked'
  return 'neutral'
}

export function DocRow({ doc }: { doc: DocEntry }): React.JSX.Element {
  const status = doc.frontmatter.status
  const id = doc.frontmatter.id
  return (
    <Link
      to="/library/doc/$"
      params={{ _splat: doc.path }}
      className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b border-line px-4 py-2 last:border-b-0 hover:bg-sunken"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{doc.title}</span>
        <span className="block truncate text-[12px] text-faint">{doc.path}</span>
      </span>
      <span className="flex items-center gap-2 text-[12px] text-muted">
        {id ? <span className="tabular-nums">{String(id)}</span> : null}
        {doc.steps ? <span>{doc.steps} steps</span> : null}
        {doc.checks ? (
          <span>
            {doc.done}/{doc.checks} checked
          </span>
        ) : null}
        {status ? <Badge tone={statusTone(status)}>{String(status)}</Badge> : null}
      </span>
    </Link>
  )
}

/** Diagram files are named after a feature's top-level folder, e.g. qa-portal/diagrams/event-management.md. */
export function featureArea(group: string | undefined): string | null {
  const area = group?.split('/')[0] ?? ''
  return /^[a-z0-9-]{1,80}$/.test(area) ? area : null
}

/** Feature-level tab: the workflow diagram for one feature group. */
export function DiagramView({ source, feature }: { source: string; feature: string }): React.JSX.Element {
  // A diagram's source links name the feature's own checklists, so they resolve from the feature folder.
  const linkBase = `qa/regression-assets/${feature}/${feature}.md`
  return (
    <div className="p-6">
      <h2 className="font-display mb-4 text-[15px] font-semibold">{groupLabel(feature)} workflow</h2>
      <div className="rounded-lg border border-line bg-surface p-5">
        <Markdown text={source.includes('```') ? source : `\`\`\`mermaid\n${source}\n\`\`\``} docPath={linkBase} className="prose-wide" />
      </div>
    </div>
  )
}
