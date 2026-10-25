import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useMatch, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronRight, FileText, FlaskConical, Folder, FolderGit2, FolderOpen, LayoutGrid, Library, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from 'lucide-react'
import type { DocEntry, Workspace } from '@shared/domain'
import { ancestorFolders, buildDocTree, closeTab, filterDocTree, openTab, type DocTreeFile, type DocTreeNode } from '@shared/doc-tree'
import { useCodebases, useDocs, useRuns } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { CommandPalette } from './command-palette'
import { ResizeHandle, usePanelWidth } from './resizable'
import { NavItem, useSidebarCollapsed } from './shell-parts'
import { Input } from './ui/fields'
import { Spinner } from './ui/misc'

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, list: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // Storage is a convenience; the state still applies for this session.
  }
}

/** Folders the user has opened in the tree, remembered per workspace. Ancestors of the open document expand automatically. */
function useExpandedFolders(workspaceId: string, activePath: string | null): [Set<string>, (folder: string) => void] {
  const key = `qa-hub.explorer.expanded.${workspaceId}`
  const [expanded, setExpanded] = useState(() => new Set(readList(key)))
  const [revealed, setRevealed] = useState<string | null>(null)

  if (activePath !== revealed) {
    setRevealed(activePath)
    const missing = activePath ? ancestorFolders(activePath).filter((folder) => !expanded.has(folder)) : []
    if (missing.length) setExpanded(new Set([...expanded, ...missing]))
  }
  useEffect(() => writeList(key, [...expanded]), [key, expanded])

  const toggle = (folder: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(folder)) next.add(folder)
      return next
    })
  return [expanded, toggle]
}

interface DocTabs {
  tabs: string[]
  close: (path: string) => Promise<void>
}

/** Open document tabs, remembered per workspace. Opening a document anywhere in the app adds its tab. */
function useDocTabs(workspaceId: string, activePath: string | null, docs: DocEntry[] | undefined): DocTabs {
  const key = `qa-hub.tabs.${workspaceId}`
  const [stored, setTabs] = useState(() => readList(key))
  const [opened, setOpened] = useState<string | null>(null)
  const navigate = useNavigate()
  const router = useRouter()

  if (activePath !== opened) {
    setOpened(activePath)
    if (activePath && !stored.includes(activePath)) setTabs(openTab(stored, activePath))
  }
  // Documents deleted or renamed on disk lose their tab.
  const tabs = useMemo(() => {
    if (!docs) return stored
    const known = new Set(docs.map((doc) => doc.path))
    return stored.filter((path) => known.has(path) || path === activePath)
  }, [stored, docs, activePath])
  useEffect(() => writeList(key, tabs), [key, tabs])

  const close = async (path: string): Promise<void> => {
    const index = tabs.indexOf(path)
    const result = closeTab(tabs, path, activePath)
    setTabs(result.tabs)
    if (result.next === undefined) return
    await (result.next ? navigate({ to: '/library/doc/$', params: { _splat: result.next } }) : navigate({ to: '/library' }))
    // Unsaved edits can keep the user on the document; its tab then comes back in place.
    const stayed = router.state.location.pathname === router.buildLocation({ to: '/library/doc/$', params: { _splat: path } }).pathname
    if (stayed) setTabs((current) => (current.includes(path) ? current : [...current.slice(0, index), path, ...current.slice(index)]))
  }

  return { tabs, close }
}

const INDENT_PX = 12
/** Files skip the chevron column so their icons line up with folder icons. */
const CHEVRON_PX = 20

function FileRow({ node, active, depth }: { node: DocTreeFile; active: boolean; depth: number }): React.JSX.Element {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <Link
      ref={ref}
      role="treeitem"
      aria-current={active ? 'page' : undefined}
      to="/library/doc/$"
      params={{ _splat: node.path }}
      title={node.path}
      style={{ paddingLeft: 6 + depth * INDENT_PX + CHEVRON_PX }}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded pr-2 text-[12.5px]',
        active ? 'bg-surface font-medium text-ink shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-sunken hover:text-ink'
      )}
    >
      <FileText className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
      <span className="truncate">{node.title}</span>
    </Link>
  )
}

interface TreeProps {
  nodes: DocTreeNode[]
  depth: number
  expanded: Set<string>
  /** While filtering every folder is shown open. */
  expandAll: boolean
  activePath: string | null
  onToggle: (folder: string) => void
}

function Tree({ nodes, depth, expanded, expandAll, activePath, onToggle }: TreeProps): React.JSX.Element {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Workspace documents' : undefined}>
      {nodes.map((node) => {
        if (node.kind === 'file') {
          return (
            <li key={node.path} role="none">
              <FileRow node={node} active={node.path === activePath} depth={depth} />
            </li>
          )
        }
        const open = expandAll || expanded.has(node.path)
        const Icon = open ? FolderOpen : Folder
        return (
          <li key={node.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={open}
              onClick={() => onToggle(node.path)}
              title={node.path}
              style={{ paddingLeft: 6 + depth * INDENT_PX }}
              className="flex h-7 w-full items-center gap-1.5 rounded pr-2 text-left text-[12.5px] text-muted hover:bg-sunken hover:text-ink"
            >
              <ChevronRight className={cn('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
              <Icon className="size-3.5 shrink-0 text-faint" />
              <span className="truncate">{node.name}</span>
            </button>
            {open ? <Tree nodes={node.children} depth={depth + 1} expanded={expanded} expandAll={expandAll} activePath={activePath} onToggle={onToggle} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

interface ExplorerPanelProps {
  workspace: Workspace
  docs: DocEntry[] | undefined
  activePath: string | null
}

/** Quick filter over a folder tree of every document in the workspace. */
function ExplorerPanel({ workspace, docs, activePath }: ExplorerPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [expanded, toggle] = useExpandedFolders(workspace.id, activePath)
  const tree = useMemo(() => buildDocTree(docs ?? []), [docs])
  const visible = useMemo(() => filterDocTree(tree, query), [tree, query])

  return (
    <>
      <div className="px-3 pb-2 pt-4">
        <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-faint" title={workspace.path}>
          {workspace.name}
        </div>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('')
          }}
          placeholder="Quick search"
          aria-label="Filter documents"
          className="mt-2"
        />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" aria-label="Explorer">
        {docs === undefined ? (
          <div className="p-3">
            <Spinner />
          </div>
        ) : visible.length ? (
          <Tree nodes={visible} depth={0} expanded={expanded} expandAll={query.trim() !== ''} activePath={activePath} onToggle={toggle} />
        ) : (
          <p className="px-3 py-2 text-[12.5px] text-muted">{query ? 'No documents match.' : 'This workspace has no Markdown files yet.'}</p>
        )}
      </nav>
    </>
  )
}

interface TabBarProps {
  tabs: string[]
  titles: Map<string, string>
  activePath: string | null
  onClose: (path: string) => void
}

function TabBar({ tabs, titles, activePath, onClose }: TabBarProps): React.JSX.Element {
  return (
    <div role="tablist" aria-label="Open documents" className="flex shrink-0 overflow-x-auto border-b border-line bg-canvas">
      {tabs.map((path) => {
        const active = path === activePath
        const title = titles.get(path) ?? path.split('/').pop() ?? path
        return (
          <div
            key={path}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(path)
            }}
            className={cn(
              'group flex h-9 max-w-56 shrink-0 items-center gap-1.5 border-r border-line pl-3 pr-1 text-[12.5px]',
              active ? 'bg-surface text-ink shadow-[inset_0_2px_0_var(--accent)]' : 'text-muted hover:bg-sunken hover:text-ink'
            )}
          >
            <Link role="tab" aria-selected={active} to="/library/doc/$" params={{ _splat: path }} title={path} className="flex min-w-0 items-center gap-1.5">
              <FileText className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
              <span className="truncate">{title}</span>
            </Link>
            <button
              type="button"
              onClick={() => onClose(path)}
              aria-label={`Close ${title}`}
              title="Close (middle-click)"
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-sunken hover:text-ink',
                !active && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Explorer layout: an icon rail, a folder tree of the workspace's documents, and open documents as tabs. */
export function ExplorerShell({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const runs = useRuns()
  const codebases = useCodebases().data ?? []
  const docs = useDocs().data
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const panel = usePanelWidth({ key: 'qa-hub.width.explorer', initial: 272, min: 200, max: 520 })
  const activePath = useMatch({ from: '/library/doc/$', shouldThrow: false })?.params._splat ?? null
  const { tabs, close } = useDocTabs(workspace.id, activePath, docs)
  const titles = useMemo(() => new Map((docs ?? []).map((doc) => [doc.path, doc.title])), [docs])

  const activeRuns = (runs.data ?? []).filter((run) => run.status === 'running' || run.status === 'ready').length

  return (
    <div className="flex h-full">
      <aside className="flex w-12 shrink-0 flex-col gap-0.5 border-r border-line bg-canvas px-1.5 pb-3 pt-4" aria-label="Main">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="grid h-8 place-items-center rounded-md text-faint hover:bg-sunken hover:text-ink"
          aria-label={collapsed ? 'Show explorer' : 'Hide explorer'}
          aria-expanded={!collapsed}
          title={`${collapsed ? 'Show' : 'Hide'} explorer (Ctrl+B)`}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mb-2 grid h-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
          aria-label="Search"
          title="Search (Ctrl K)"
        >
          <Search className="size-4" />
        </button>
        <NavItem to="/" label="Overview" icon={LayoutGrid} exact collapsed />
        <NavItem to="/library" label="Library" icon={Library} collapsed />
        <NavItem to="/runs" label="Test runs" icon={FlaskConical} count={activeRuns} collapsed />
        <NavItem to="/codebases" label="Codebases" icon={FolderGit2} count={codebases.length} collapsed />
        <div className="mt-auto">
          <NavItem to="/settings" label="Settings" icon={Settings} collapsed />
        </div>
      </aside>
      {collapsed ? null : (
        <>
          <aside className="flex shrink-0 flex-col border-r border-line bg-canvas" style={{ width: panel.width }} aria-label="Explorer">
            <ExplorerPanel workspace={workspace} docs={docs} activePath={activePath} />
          </aside>
          <ResizeHandle panel={panel} edge="right" label="Resize explorer" />
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {tabs.length ? <TabBar tabs={tabs} titles={titles} activePath={activePath} onClose={(path) => void close(path)} /> : null}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
