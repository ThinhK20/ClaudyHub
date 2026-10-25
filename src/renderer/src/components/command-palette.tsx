import { useDeferredValue, useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FileText, FlaskConical, FolderGit2, LayoutGrid, Library, Search, Settings } from 'lucide-react'
import { call } from '@/lib/ipc'
import { keys, useRuns } from '@/lib/queries'
import { SECTION_LABELS } from '@/lib/utils'

const PAGES = [
  { to: '/', label: 'Overview', icon: LayoutGrid },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/runs', label: 'Test runs', icon: FlaskConical },
  { to: '/codebases', label: 'Codebases', icon: FolderGit2 },
  { to: '/settings', label: 'Settings', icon: Settings }
] as const

const item = 'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink [&_svg]:size-3.5 [&_svg]:text-muted'

/** Ctrl+K: jump to a page, a run, or any document in the library. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query.trim())
  const runs = useRuns().data ?? []
  const docs = useQuery({
    queryKey: keys.search(deferred),
    queryFn: () => call('docs:search', { query: deferred, limit: 12 }),
    enabled: open && deferred.length >= 2
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const go = (action: () => void): void => {
    onOpenChange(false)
    setQuery('')
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Go to"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-muted" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Search documents, runs and pages" className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-muted">Nothing matches “{query}”.</Command.Empty>
        <Command.Group heading="Pages" className="text-[11.5px] text-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1">
          {PAGES.filter((page) => page.label.toLowerCase().includes(query.toLowerCase())).map((page) => (
            <Command.Item key={page.to} value={`page-${page.to}`} className={item} onSelect={() => go(() => void navigate({ to: page.to }))}>
              <page.icon /> {page.label}
            </Command.Item>
          ))}
        </Command.Group>
        {runs.some((run) => run.title.toLowerCase().includes(query.toLowerCase())) && (
          <Command.Group heading="Test runs" className="text-[11.5px] text-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1">
            {runs
              .filter((run) => run.title.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8)
              .map((run) => (
                <Command.Item key={run.id} value={`run-${run.id}`} className={item} onSelect={() => go(() => void navigate({ to: '/runs/$runId', params: { runId: run.id } }))}>
                  <FlaskConical /> <span className="truncate">{run.title}</span>
                </Command.Item>
              ))}
          </Command.Group>
        )}
        {(docs.data ?? []).length > 0 && (
          <Command.Group heading="Documents" className="text-[11.5px] text-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1">
            {(docs.data ?? []).map((hit) => (
              <Command.Item key={hit.path} value={`doc-${hit.path}`} className={item} onSelect={() => go(() => void navigate({ to: '/library/doc/$', params: { _splat: hit.path } }))}>
                <FileText />
                <span className="truncate text-ink">{hit.title}</span>
                <span className="ml-auto shrink-0 text-[11.5px] text-faint">{SECTION_LABELS[hit.section]}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {deferred.length >= 2 && (
          <Command.Item value="search-all" className={item} onSelect={() => go(() => void navigate({ to: '/search', search: { q: deferred } }))}>
            <Search /> Search the library for “{deferred}”
          </Command.Item>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
