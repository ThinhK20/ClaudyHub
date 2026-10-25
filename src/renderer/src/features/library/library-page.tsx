import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi } from '@tanstack/react-router'
import { LibraryBig, RefreshCw, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { DocEntry, DocSection } from '@shared/domain'
import { Markdown } from '@/components/markdown'
import { ResizeHandle, usePanelWidth } from '@/components/resizable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { groupIcon } from '@/lib/group-icons'
import { keys, useDocs } from '@/lib/queries'
import { SECTION_LABELS, SECTION_ORDER, cn, errorText, groupLabel } from '@/lib/utils'

const route = getRouteApi('/library')

function statusTone(status: unknown): 'pass' | 'fail' | 'blocked' | 'neutral' {
  const value = String(status ?? '').toLowerCase()
  if (value === 'passed' || value === 'pass') return 'pass'
  if (value === 'failed' || value === 'fail') return 'fail'
  if (value === 'blocked') return 'blocked'
  return 'neutral'
}

function DocRow({ doc }: { doc: DocEntry }): React.JSX.Element {
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
function featureArea(group: string | undefined): string | null {
  const area = group?.split('/')[0] ?? ''
  return /^[a-z0-9-]{1,80}$/.test(area) ? area : null
}

/** Feature-level tab: the workflow diagram for one feature group. */
function DiagramView({ source, feature }: { source: string; feature: string }): React.JSX.Element {
  return (
    <div className="p-6">
      <h2 className="font-display mb-4 text-[15px] font-semibold">{groupLabel(feature)} workflow</h2>
      <div className="rounded-lg border border-line bg-surface p-5">
        <Markdown text={source.includes('```') ? source : `\`\`\`mermaid\n${source}\n\`\`\``} className="prose-wide" />
      </div>
    </div>
  )
}

interface GroupLinkProps {
  section: DocSection
  group?: string
  active: boolean
  icon: LucideIcon
  label: string
  count: number
}

function GroupLink({ section, group, active, icon: Icon, label, count }: GroupLinkProps): React.JSX.Element {
  return (
    <Link
      to="/library"
      search={{ section, group }}
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1 text-[12.5px]',
        active ? 'bg-surface font-medium text-ink shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-sunken hover:text-ink'
      )}
      title={group}
    >
      <Icon className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11.5px] text-faint tabular-nums">{count}</span>
    </Link>
  )
}

/** Browses the workspace's indexed Markdown by section and feature group. */
export function LibraryPage(): React.JSX.Element {
  const search = route.useSearch()
  const section: DocSection = search.section ?? 'test-cases'
  const docs = useDocs()
  const [filter, setFilter] = useState('')
  const [reindexing, setReindexing] = useState(false)
  const groupsPanel = usePanelWidth({ key: 'qa-hub.width.library-groups', initial: 256, min: 180, max: 480 })
  const area = featureArea(search.group)
  const diagram = useQuery({
    queryKey: keys.diagram(area ?? ''),
    queryFn: () => call('docs:diagram', { area: area ?? '' }),
    enabled: area !== null
  })
  const hasDiagram = Boolean(area && diagram.data)
  const showDiagram = hasDiagram && search.view === 'diagram'

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of docs.data ?? []) if (doc.section === section) counts.set(doc.group, (counts.get(doc.group) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [docs.data, section])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (docs.data ?? []).filter(
      (doc) =>
        doc.section === section &&
        (search.group === undefined || doc.group === search.group || doc.group.startsWith(`${search.group}/`)) &&
        (!needle || doc.title.toLowerCase().includes(needle) || String(doc.frontmatter.id ?? '').includes(needle))
    )
  }, [docs.data, section, search.group, filter])

  const reindex = async (): Promise<void> => {
    setReindexing(true)
    try {
      const { count } = await call('docs:reindex')
      toast.success(`Indexed ${count} documents`)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        subtitle="Test cases, checklists and guides from your QA repository. Changes on disk appear automatically."
        actions={
          <Button size="sm" onClick={() => void reindex()} disabled={reindexing}>
            {reindexing ? <Spinner className="size-3.5" /> : <RefreshCw />} Re-index
          </Button>
        }
      >
        <nav className="-mb-3 mt-3 flex gap-1" aria-label="Sections">
          {SECTION_ORDER.map((item) => (
            <Link
              key={item}
              to="/library"
              search={{ section: item }}
              className={cn('border-b-2 px-2.5 pb-2 text-[13px]', item === section ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
            >
              {SECTION_LABELS[item]}
              <span className="ml-1.5 text-[11.5px] text-faint">{(docs.data ?? []).filter((doc) => doc.section === item).length}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <aside className="shrink-0 overflow-y-auto border-r border-line p-2" style={{ width: groupsPanel.width }} aria-label="Groups">
          <GroupLink section={section} active={search.group === undefined} icon={LibraryBig} label="All" count={(docs.data ?? []).filter((doc) => doc.section === section).length} />
          {groups.map(([group, count]) => (
            <GroupLink key={group} section={section} group={group} active={search.group === group} icon={groupIcon(group)} label={groupLabel(group)} count={count} />
          ))}
        </aside>
        <ResizeHandle panel={groupsPanel} edge="right" label="Resize group list" />

        <div className="flex min-w-0 flex-1 flex-col">
          {hasDiagram ? (
            <nav className="flex gap-1 border-b border-line px-4" aria-label={`${groupLabel(search.group ?? '')} views`}>
              {(
                [
                  ['documents', 'Documents'],
                  ['diagram', 'Workflow diagram']
                ] as const
              ).map(([view, label]) => {
                const active = (view === 'diagram') === showDiagram
                return (
                  <Link
                    key={view}
                    to="/library"
                    search={{ section, group: search.group, view: view === 'diagram' ? 'diagram' : undefined }}
                    aria-current={active ? 'page' : undefined}
                    className={cn('border-b-2 px-2.5 py-2 text-[13px]', active ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
                  >
                    {label}
                  </Link>
                )
              })}
            </nav>
          ) : null}
          {showDiagram ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DiagramView source={diagram.data ?? ''} feature={area ?? ''} />
            </div>
          ) : (
            <>
          <div className="border-b border-line px-4 py-2">
            <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title or case ID" className="max-w-sm" aria-label="Filter documents" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {docs.isPending ? (
              <div className="p-6">
                <Spinner />
              </div>
            ) : visible.length ? (
              <div className="bg-surface">
                {visible.map((doc) => (
                  <DocRow key={doc.path} doc={doc} />
                ))}
              </div>
            ) : (
              <EmptyState title="No documents here" className="m-6">
                {filter ? 'Nothing matches the filter.' : 'This section of the workspace has no Markdown files yet.'}
              </EmptyState>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
