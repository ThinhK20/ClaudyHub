import { Fragment, createElement, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi } from '@tanstack/react-router'
import { ChevronRight, LibraryBig } from 'lucide-react'
import type { DocEntry, DocSection } from '@shared/domain'
import { Input } from '@/components/ui/fields'
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { groupIcon } from '@/lib/group-icons'
import { call } from '@/lib/ipc'
import { keys, useDocs } from '@/lib/queries'
import { SECTION_LABELS, cn, groupLabel } from '@/lib/utils'
import { DiagramView, DocRow, featureArea } from './library-parts'

const route = getRouteApi('/library/folder')

function inFolder(doc: DocEntry, section: DocSection, group: string): boolean {
  return doc.section === section && (!group || doc.group === group || doc.group.startsWith(`${group}/`))
}

/** Direct subfolders of `group` (given only documents inside it) with how many documents each holds, in natural order. */
function subfolders(docs: readonly DocEntry[], group: string): [string, number][] {
  const counts = new Map<string, number>()
  for (const doc of docs) {
    const rest = group ? doc.group.slice(group.length + 1) : doc.group
    const child = rest.split('/')[0]
    if (!child) continue
    const path = group ? `${group}/${child}` : child
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
}

function statusCounts(docs: readonly DocEntry[]): { passed: number; failed: number; blocked: number } {
  let passed = 0
  let failed = 0
  let blocked = 0
  for (const doc of docs) {
    const status = String(doc.frontmatter.status ?? '').toLowerCase()
    if (status === 'passed' || status === 'pass') passed += 1
    else if (status === 'failed' || status === 'fail') failed += 1
    else if (status === 'blocked') blocked += 1
  }
  return { passed, failed, blocked }
}

function Breadcrumb({ section, group }: { section: DocSection; group: string }): React.JSX.Element {
  const parents = group.split('/').slice(0, -1)
  return (
    <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1">
      <Link to="/library/folder" search={{ section, group: '' }} className="hover:text-ink hover:underline">
        {SECTION_LABELS[section]}
      </Link>
      {parents.map((part, index) => (
        <Fragment key={index}>
          <ChevronRight className="size-3" />
          <Link to="/library/folder" search={{ section, group: parents.slice(0, index + 1).join('/') }} className="hover:text-ink hover:underline">
            {groupLabel(part)}
          </Link>
        </Fragment>
      ))}
    </nav>
  )
}

function SubfolderList({ section, folders }: { section: DocSection; folders: [string, number][] }): React.JSX.Element {
  return (
    <section aria-label="Folders" className="border-b border-line px-4 py-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Folders</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
        {folders.map(([group, count]) => {
          return (
            <Link
              key={group}
              to="/library/folder"
              search={{ section, group }}
              className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] hover:border-line-strong hover:bg-sunken"
            >
              {createElement(groupIcon(group), { className: 'size-4 shrink-0 text-faint' })}
              <span className="flex-1 truncate font-medium">{groupLabel(group.split('/').pop() ?? group)}</span>
              <span className="text-[11.5px] text-faint tabular-nums">{count}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

interface DocumentsViewProps {
  section: DocSection
  docs: DocEntry[]
  folders: [string, number][]
  pending: boolean
}

function DocumentsView({ section, docs, folders, pending }: DocumentsViewProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? docs.filter((doc) => doc.title.toLowerCase().includes(needle) || String(doc.frontmatter.id ?? '').includes(needle)) : docs
  }, [docs, filter])

  if (pending) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    )
  }
  return (
    <>
      {folders.length ? <SubfolderList section={section} folders={folders} /> : null}
      <div className="border-b border-line px-4 py-2">
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title or case ID" className="max-w-sm" aria-label="Filter folder documents" />
      </div>
      {visible.length ? (
        <div className="bg-surface">
          {visible.map((doc) => (
            <DocRow key={doc.path} doc={doc} />
          ))}
        </div>
      ) : (
        <EmptyState title="No documents here" className="m-6">
          {filter ? 'Nothing matches the filter.' : 'This folder has no Markdown files yet.'}
        </EmptyState>
      )}
    </>
  )
}

const VIEWS = [
  ['diagram', 'Workflow diagram'],
  ['documents', 'Documents']
] as const

/** An explorer folder: its feature's workflow diagram when there is one, then its subfolders and documents. */
export function FolderPage(): React.JSX.Element {
  const { section, group, view } = route.useSearch()
  const docs = useDocs()
  const area = featureArea(group || undefined)
  const diagram = useQuery({
    queryKey: keys.diagram(area ?? ''),
    queryFn: () => call('docs:diagram', { area: area ?? '' }),
    enabled: area !== null
  })
  const hasDiagram = Boolean(area && diagram.data)
  // A folder with a diagram opens on it; the Documents view is one click away.
  const showDiagram = hasDiagram && view !== 'documents'

  const folderDocs = useMemo(() => (docs.data ?? []).filter((doc) => inFolder(doc, section, group)), [docs.data, section, group])
  const folders = useMemo(() => subfolders(folderDocs, group), [folderDocs, group])
  const status = statusCounts(folderDocs)
  const title = group ? groupLabel(group.split('/').pop() ?? group) : SECTION_LABELS[section]

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        leading={createElement(group ? groupIcon(group) : LibraryBig, { className: 'mt-1 size-5 text-accent', 'aria-hidden': true })}
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {group ? <Breadcrumb section={section} group={group} /> : null}
            <span>
              {folderDocs.length} {folderDocs.length === 1 ? 'document' : 'documents'}
            </span>
            {status.passed ? <Badge tone="pass">{status.passed} passed</Badge> : null}
            {status.failed ? <Badge tone="fail">{status.failed} failed</Badge> : null}
            {status.blocked ? <Badge tone="blocked">{status.blocked} blocked</Badge> : null}
          </span>
        }
      >
        {hasDiagram ? (
          <nav className="-mb-3 mt-3 flex gap-1" aria-label={`${title} views`}>
            {VIEWS.map(([item, label]) => {
              const active = (item === 'diagram') === showDiagram
              return (
                <Link
                  key={item}
                  to="/library/folder"
                  search={{ section, group, view: item }}
                  aria-current={active ? 'page' : undefined}
                  className={cn('border-b-2 px-2.5 pb-2 text-[13px]', active ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
                >
                  {label}
                </Link>
              )
            })}
          </nav>
        ) : null}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showDiagram ? (
          <DiagramView source={diagram.data ?? ''} feature={area ?? ''} />
        ) : (
          <DocumentsView key={`${section}:${group}`} section={section} docs={folderDocs} folders={folders} pending={docs.isPending} />
        )}
      </div>
    </div>
  )
}
