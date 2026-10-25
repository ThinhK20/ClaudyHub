import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, ChevronRight, FileText, Search, X } from 'lucide-react'
import type { DocEntry } from '@shared/domain'
import { Markdown } from '@/components/markdown'
import { TextContextMenu } from '@/components/text-context-menu'
import { Button } from '@/components/ui/button'
import { ErrorNotice, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useDocs } from '@/lib/queries'
import { SECTION_LABELS, cn, groupLabel } from '@/lib/utils'
import { readMenuActions } from './read-menu-actions'

const MAX_RESULTS = 100

/** "Section › Group › Sub-folder" for a document, as shown in the picker. */
function trail(doc: DocEntry): string[] {
  const folders = doc.group ? doc.group.split('/').map(groupLabel) : []
  return [SECTION_LABELS[doc.section], ...folders]
}

/** Documents whose trail or title contain every word of the query. */
function matchDocs(docs: DocEntry[], query: string): DocEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return docs.slice(0, MAX_RESULTS)
  return docs
    .filter((doc) => {
      const text = [...trail(doc), doc.title].join(' ').toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .slice(0, MAX_RESULTS)
}

function DocPicker({ onPick }: { onPick: (path: string) => void }): React.JSX.Element {
  const docs = useDocs()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const results = useMemo(() => matchDocs(docs.data ?? [], deferred), [docs.data, deferred])
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const selected = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') setActive(Math.min(selected + 1, results.length - 1))
    else if (event.key === 'ArrowUp') setActive(Math.max(selected - 1, 0))
    else if (event.key === 'Enter' && results[selected]) onPick(results[selected].path)
    else return
    event.preventDefault()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
      <p className="text-[12.5px] text-muted">Open a note by typing its title below or choose one from the list.</p>
      <label className="mt-2 flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-accent">
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search for a note by its name"
          aria-label="Search for a note by its name"
          aria-controls="split-doc-results"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <Search className="size-3.5 shrink-0 text-faint" />
      </label>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {docs.isPending ? <Spinner /> : null}
        {docs.error ? <ErrorNotice error={docs.error} /> : null}
        {docs.data && !results.length ? <p className="px-2 py-3 text-[12.5px] text-muted">No notes match &ldquo;{query}&rdquo;.</p> : null}
        <ul ref={list} id="split-doc-results" role="listbox" aria-label="Notes">
          {results.map((doc, index) => (
            <li
              key={doc.path}
              role="option"
              aria-selected={index === selected}
              title={doc.path}
              onMouseMove={() => setActive(index)}
              onClick={() => onPick(doc.path)}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[12.5px] text-muted',
                index === selected && 'bg-sunken text-ink'
              )}
            >
              <FileText className="mt-0.5 size-3.5 shrink-0 text-faint" />
              <span className="min-w-0">
                {trail(doc).map((part, at) => (
                  <span key={at}>
                    {part}
                    <ChevronRight className="mx-0.5 inline size-3 text-faint" />
                  </span>
                ))}
                <span className="text-ink">{doc.title}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SplitDoc({ path }: { path: string }): React.JSX.Element {
  const doc = useQuery({
    queryKey: keys.doc(path),
    queryFn: () => call('docs:get', { path })
  })
  if (doc.isPending) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    )
  }
  if (doc.error) {
    return (
      <div className="p-6">
        <ErrorNotice error={doc.error} />
      </div>
    )
  }
  return (
    <TextContextMenu actions={readMenuActions(doc.data.path)}>
      <article className="min-w-0 px-6 py-5">
        <Markdown text={doc.data.body} docPath={doc.data.path} />
      </article>
    </TextContextMenu>
  )
}

interface DocSplitPaneProps {
  /** The document in the main view, which takes this pane's place when the user swaps sides. */
  mainPath: string
  /** The document shown in this pane, or null while the user picks one. */
  path: string | null
  onPathChange: (path: string | null) => void
  onClose: () => void
}

/** The right half of a split document view: pick a note, then read it beside the main one. */
export function DocSplitPane({ mainPath, path, onPathChange, onClose }: DocSplitPaneProps): React.JSX.Element {
  const navigate = useNavigate()
  const docs = useDocs()
  const title = path ? (docs.data?.find((doc) => doc.path === path)?.title ?? path.split('/').pop()) : 'New split'

  return (
    <section aria-label="Split view" className="flex min-w-0 flex-1 basis-0 flex-col border-l border-line bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line pl-4 pr-2">
        {path ? <FileText className="size-3.5 shrink-0 text-accent" /> : <Search className="size-3.5 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title={path ?? undefined}>
          {title}
        </span>
        {path ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                onPathChange(mainPath)
                void navigate({
                  to: '/library/doc/$',
                  params: { _splat: path }
                })
              }}
              aria-label="Swap sides"
              title="Swap with the main view"
            >
              <ArrowLeftRight />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onPathChange(null)} aria-label="Open another note" title="Open another note">
              <Search />
            </Button>
          </>
        ) : null}
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close split" title="Close split">
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {path ? <SplitDoc path={path} /> : <DocPicker onPick={onPathChange} />}
      </div>
    </section>
  )
}
