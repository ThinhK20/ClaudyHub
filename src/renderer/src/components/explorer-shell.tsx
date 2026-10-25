import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useMatch, useRouterState } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Folder,
  FolderGit2,
  FolderOpen,
  LayoutGrid,
  Library,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Search,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { DocEntry, DocSection, Workspace } from '@shared/domain'
import { buildDocTree, filterDocTree, folderId, folderTrail, type DocTreeFile, type DocTreeFolder, type DocTreeNode } from '@shared/doc-tree'
import { useCodebases, useDocs, useRuns } from '@/lib/queries'
import { readList, writeList } from '@/lib/stored-list'
import { groupIcon } from '@/lib/group-icons'
import { SECTION_LABELS, SECTION_ORDER, cn, groupLabel } from '@/lib/utils'
import { CommandPalette } from './command-palette'
import { TabBar, useDocTabs } from './doc-tabs'
import { ResizeHandle, usePanelWidth } from './resizable'
import { NavItem, useSidebarCollapsed } from './shell-parts'
import { Input } from './ui/fields'
import { Spinner } from './ui/misc'

const SECTION_ICONS: Record<DocSection, LucideIcon> = {
  'test-cases': ListChecks,
  assets: ClipboardCheck,
  releases: Rocket,
  'test-runs': FlaskConical,
  guides: BookOpen
}

/**
 * Folders open in the tree, remembered per workspace (sections start open). The folders leading to the open
 * document or folder (`reveal`) open automatically.
 */
function useExpandedFolders(workspaceId: string, reveal: readonly string[]): [Set<string>, (folder: string, open: boolean) => void] {
  const key = `qa-hub.explorer.folders.${workspaceId}`
  const [expanded, setExpanded] = useState(() =>
    localStorage.getItem(key) === null ? new Set(SECTION_ORDER.map((section) => folderId(section, ''))) : new Set(readList(localStorage, key))
  )
  const revealKey = reveal.join('\n')
  const [revealed, setRevealed] = useState('')

  if (revealKey !== revealed) {
    setRevealed(revealKey)
    const missing = reveal.filter((folder) => !expanded.has(folder))
    if (missing.length) setExpanded(new Set([...expanded, ...missing]))
  }
  useEffect(() => writeList(localStorage, key, [...expanded]), [key, expanded])

  const setOpen = (folder: string, open: boolean): void =>
    setExpanded((current) => {
      if (open === current.has(folder)) return current
      const next = new Set(current)
      if (open) next.add(folder)
      else next.delete(folder)
      return next
    })
  return [expanded, setOpen]
}

const INDENT_PX = 12
/** Files skip the chevron column so their icons line up with folder icons. */
const CHEVRON_PX = 20

function useScrollIntoView<T extends HTMLElement>(active: boolean): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return ref
}

function rowClass(active: boolean): string {
  return cn(
    'flex h-7 items-center gap-1.5 rounded text-[12.5px]',
    active ? 'bg-surface font-medium text-ink shadow-[inset_2px_0_0_var(--accent)]' : 'text-muted hover:bg-sunken hover:text-ink'
  )
}

function FileRow({ node, active, depth }: { node: DocTreeFile; active: boolean; depth: number }): React.JSX.Element {
  const ref = useScrollIntoView<HTMLAnchorElement>(active)
  return (
    <Link
      ref={ref}
      role="treeitem"
      aria-current={active ? 'page' : undefined}
      to="/library/doc/$"
      params={{ _splat: node.path }}
      title={node.path}
      style={{ paddingLeft: 6 + depth * INDENT_PX + CHEVRON_PX }}
      className={cn(rowClass(active), 'pr-2')}
    >
      <FileText className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint')} />
      <span className="truncate">{node.title}</span>
    </Link>
  )
}

function folderLabel(node: DocTreeFolder): string {
  return node.group ? groupLabel(node.name) : SECTION_LABELS[node.section]
}

function folderIcon(node: DocTreeFolder, open: boolean): LucideIcon {
  if (!node.group) return SECTION_ICONS[node.section]
  // Feature groups get the same icons as in the classic Library; deeper folders are plain folders.
  if (!node.group.includes('/')) return groupIcon(node.group)
  return open ? FolderOpen : Folder
}

interface FolderRowProps {
  node: DocTreeFolder
  open: boolean
  active: boolean
  depth: number
  onOpenChange: (open: boolean) => void
}

/** Clicking the name shows the folder (diagram, subfolders, documents) and opens it; the chevron only opens or closes it. */
function FolderRow({ node, open, active, depth, onOpenChange }: FolderRowProps): React.JSX.Element {
  const ref = useScrollIntoView<HTMLDivElement>(active)
  const label = folderLabel(node)
  return (
    <div ref={ref} style={{ paddingLeft: 6 + depth * INDENT_PX }} className={cn(rowClass(active), !node.group && 'font-semibold text-ink')}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onOpenChange(!open)}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
        className="-ml-1 -mr-0.5 grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-sunken hover:text-ink"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      <Link
        role="treeitem"
        aria-expanded={open}
        aria-current={active ? 'page' : undefined}
        to="/library/folder"
        search={{ section: node.section, group: node.group }}
        onClick={() => onOpenChange(active ? !open : true)}
        title={node.group || SECTION_LABELS[node.section]}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-2"
      >
        {createElement(folderIcon(node, open), { className: cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-faint') })}
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[11px] font-normal text-faint tabular-nums">{node.count}</span>
      </Link>
    </div>
  )
}

interface TreeProps {
  nodes: DocTreeNode[]
  depth: number
  expanded: Set<string>
  /** While filtering every folder is shown open. */
  expandAll: boolean
  /** The open document's path or the open folder's id. */
  activeId: string | null
  onOpenChange: (folder: string, open: boolean) => void
}

function Tree({ nodes, depth, expanded, expandAll, activeId, onOpenChange }: TreeProps): React.JSX.Element {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Workspace documents' : undefined}>
      {nodes.map((node) => {
        if (node.kind === 'file') {
          return (
            <li key={node.id} role="none">
              <FileRow node={node} active={node.id === activeId} depth={depth} />
            </li>
          )
        }
        const open = expandAll || expanded.has(node.id)
        return (
          <li key={node.id} role="none">
            <FolderRow node={node} open={open} active={node.id === activeId} depth={depth} onOpenChange={(next) => onOpenChange(node.id, next)} />
            {open ? <Tree nodes={node.children} depth={depth + 1} expanded={expanded} expandAll={expandAll} activeId={activeId} onOpenChange={onOpenChange} /> : null}
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

/** Quick filter over the workspace's documents, organised by section and feature group like the classic Library. */
function ExplorerPanel({ workspace, docs, activePath }: ExplorerPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const folder = useMatch({ from: '/library/folder', shouldThrow: false })?.search
  const activeDoc = activePath ? docs?.find((doc) => doc.path === activePath) : undefined
  const activeId = activePath ?? (folder ? folderId(folder.section, folder.group) : null)
  const reveal = activeDoc ? folderTrail(activeDoc.section, activeDoc.group) : folder ? folderTrail(folder.section, folder.group).slice(0, -1) : []
  const [expanded, setOpen] = useExpandedFolders(workspace.id, reveal)
  const tree = useMemo(() => buildDocTree(docs ?? [], SECTION_ORDER), [docs])
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
          <Tree nodes={visible} depth={0} expanded={expanded} expandAll={query.trim() !== ''} activeId={activeId} onOpenChange={setOpen} />
        ) : (
          <p className="px-3 py-2 text-[12.5px] text-muted">{query ? 'No documents match.' : 'This workspace has no Markdown files yet.'}</p>
        )}
      </nav>
    </>
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
  // The document tree belongs to the Library; other pages get the full width.
  const inLibrary = useRouterState({ select: (state) => state.location.pathname.startsWith('/library') })
  const showPanel = inLibrary && !collapsed
  const docTabs = useDocTabs(workspace.id, activePath, docs)
  const titles = useMemo(() => new Map((docs ?? []).map((doc) => [doc.path, doc.title])), [docs])

  const activeRuns = (runs.data ?? []).filter((run) => run.status === 'running' || run.status === 'ready').length

  return (
    <div className="flex h-full">
      <aside className="flex w-12 shrink-0 flex-col gap-0.5 border-r border-line bg-canvas px-1.5 pb-3 pt-4" aria-label="Main">
        <button
          type="button"
          onClick={toggleCollapsed}
          disabled={!inLibrary}
          className="grid h-8 place-items-center rounded-md text-faint enabled:hover:bg-sunken enabled:hover:text-ink disabled:opacity-40"
          aria-label={showPanel ? 'Hide explorer' : 'Show explorer'}
          aria-expanded={showPanel}
          title={inLibrary ? `${collapsed ? 'Show' : 'Hide'} explorer (Ctrl+B)` : 'The explorer is available in the Library'}
        >
          {showPanel ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
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
      {showPanel ? (
        <>
          <aside className="flex shrink-0 flex-col border-r border-line bg-canvas" style={{ width: panel.width }} aria-label="Explorer">
            <ExplorerPanel workspace={workspace} docs={docs} activePath={activePath} />
          </aside>
          <ResizeHandle panel={panel} edge="right" label="Resize explorer" />
        </>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {docTabs.tabs.length ? <TabBar state={docTabs} titles={titles} activePath={activePath} /> : null}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
