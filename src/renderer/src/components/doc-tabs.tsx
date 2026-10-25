import { useEffect, useMemo, useState } from 'react'
import { ContextMenu } from 'radix-ui'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { AppWindow, FileText, Pin, PinOff, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { DocEntry } from '@shared/domain'
import { closeTab, closeTabs, openTab, rememberClosed, tabsToClose, togglePin, type TabCloseScope } from '@shared/doc-tree'
import { call } from '@/lib/ipc'
import { readList, writeList } from '@/lib/stored-list'
import { cn, errorText } from '@/lib/utils'
import { menuContent, menuItem, menuSeparator } from './text-context-menu'

const CLOSED_HISTORY_LIMIT = 20

/** Windows opened with "Move/Copy this tab to a new window" keep their tabs to themselves (per-window session storage). */
const isDocWindow = new URLSearchParams(window.location.search).get('window') === 'doc'

export interface DocTabs {
  tabs: string[]
  pinned: ReadonlySet<string>
  canReopen: boolean
  /** Resolves false when the document stayed open (e.g. the user kept unsaved edits). */
  close: (path: string) => Promise<boolean>
  closeMany: (path: string, scope: TabCloseScope) => Promise<void>
  togglePin: (path: string) => void
  reopen: () => Promise<void>
}

/** Open document tabs, remembered per workspace. Opening a document anywhere in the app adds its tab. */
export function useDocTabs(workspaceId: string, activePath: string | null, docs: DocEntry[] | undefined): DocTabs {
  const storage = isDocWindow ? sessionStorage : localStorage
  const key = `qa-hub.tabs.${workspaceId}`
  const pinnedKey = `${key}.pinned`
  const [stored, setTabs] = useState(() => readList(storage, key))
  const [storedPinned, setPinned] = useState(() => readList(storage, pinnedKey))
  const [history, setHistory] = useState<string[]>([])
  const [opened, setOpened] = useState<string | null>(null)
  const navigate = useNavigate()
  const router = useRouter()

  if (activePath !== opened) {
    setOpened(activePath)
    if (activePath && !stored.includes(activePath)) setTabs(openTab(stored, activePath))
  }
  // Documents deleted or renamed on disk lose their tab.
  const known = useMemo(() => (docs ? new Set(docs.map((doc) => doc.path)) : null), [docs])
  const tabs = useMemo(() => (known ? stored.filter((path) => known.has(path) || path === activePath) : stored), [stored, known, activePath])
  const pinned = useMemo(() => new Set(storedPinned.filter((path) => tabs.includes(path))), [storedPinned, tabs])
  useEffect(() => writeList(storage, key, tabs), [storage, key, tabs])
  useEffect(() => writeList(storage, pinnedKey, [...pinned]), [storage, pinnedKey, pinned])
  const reopenable = known ? history.filter((path) => known.has(path) && !tabs.includes(path)) : history

  const isShowing = (path: string): boolean =>
    router.state.location.pathname === router.buildLocation({ to: '/library/doc/$', params: { _splat: path } }).pathname

  const apply = async (closing: string[], result: { tabs: string[]; next?: string | null }): Promise<boolean> => {
    if (!closing.length) return true
    setTabs(result.tabs)
    setPinned((current) => current.filter((path) => !closing.includes(path)))
    setHistory((current) => rememberClosed(current, closing, CLOSED_HISTORY_LIMIT))
    if (result.next === undefined || !activePath) return true
    await (result.next ? navigate({ to: '/library/doc/$', params: { _splat: result.next } }) : navigate({ to: '/library' }))
    if (!isShowing(activePath)) return true
    // Unsaved edits can keep the user on the document; its tab then comes back in place.
    const restored = activePath
    const before = tabs.slice(0, tabs.indexOf(restored)).filter((path) => result.tabs.includes(path)).length
    setTabs((current) => (current.includes(restored) ? current : [...current.slice(0, before), restored, ...current.slice(before)]))
    if (pinned.has(restored)) setPinned((current) => [...current, restored])
    setHistory((current) => current.filter((path) => path !== restored))
    return false
  }

  return {
    tabs,
    pinned,
    canReopen: reopenable.length > 0,
    close: (path) => apply(tabs.includes(path) ? [path] : [], closeTab(tabs, path, activePath)),
    closeMany: async (path, scope) => {
      const closing = tabsToClose(tabs, pinned, path, scope)
      await apply(closing, closeTabs(tabs, closing, activePath, path))
    },
    togglePin: (path) => {
      const result = togglePin(tabs, [...pinned], path)
      setTabs(result.tabs)
      setPinned(result.pinned)
    },
    reopen: async () => {
      const path = reopenable.at(-1)
      if (!path) return
      setHistory((current) => current.filter((item) => item !== path))
      setTabs((current) => openTab(current, path))
      await navigate({ to: '/library/doc/$', params: { _splat: path } })
    }
  }
}

/** Resolves false (after telling the user) when the window could not be opened. */
async function openInNewWindow(path: string): Promise<boolean> {
  try {
    await call('window:openDoc', { path })
    return true
  } catch (error) {
    toast.error(errorText(error))
    return false
  }
}

/** Keeps menu labels aligned when an item has no icon. */
const iconSpacer = <span className="size-3.5 shrink-0" aria-hidden />

function TabMenu({ path, state }: { path: string; state: DocTabs }): React.JSX.Element {
  const { tabs, pinned } = state
  const isPinned = pinned.has(path)
  const has = (scope: TabCloseScope): boolean => tabsToClose(tabs, pinned, path, scope).length > 0
  // Open first so a failure never loses the tab.
  const moveToNewWindow = async (): Promise<void> => {
    if (await openInNewWindow(path)) await state.close(path)
  }

  return (
    <ContextMenu.Content className={menuContent}>
      <ContextMenu.Item className={menuItem} onSelect={() => state.togglePin(path)}>
        {isPinned ? <PinOff /> : <Pin />} {isPinned ? 'Unpin tab' : 'Pin tab'}
      </ContextMenu.Item>
      <ContextMenu.Separator className={menuSeparator} />
      <ContextMenu.Item className={menuItem} onSelect={() => void state.close(path)}>
        <X /> Close
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItem} disabled={!has('others')} onSelect={() => void state.closeMany(path, 'others')}>
        {iconSpacer} Close other tabs
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItem} disabled={!has('right')} onSelect={() => void state.closeMany(path, 'right')}>
        {iconSpacer} Close tabs to the right
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItem} disabled={!has('all')} onSelect={() => void state.closeMany(path, 'all')}>
        {iconSpacer} Close all tabs
      </ContextMenu.Item>
      <ContextMenu.Separator className={menuSeparator} />
      <ContextMenu.Item className={menuItem} disabled={!state.canReopen} onSelect={() => void state.reopen()}>
        <Undo2 /> Reopen last closed tab
      </ContextMenu.Item>
      <ContextMenu.Separator className={menuSeparator} />
      <ContextMenu.Item className={menuItem} onSelect={() => void moveToNewWindow()}>
        <AppWindow /> Move this tab to a new window
      </ContextMenu.Item>
      <ContextMenu.Item className={menuItem} onSelect={() => void openInNewWindow(path)}>
        {iconSpacer} Copy this tab to a new window
      </ContextMenu.Item>
    </ContextMenu.Content>
  )
}

interface TabBarProps {
  state: DocTabs
  titles: Map<string, string>
  activePath: string | null
}

/** Open documents as tabs. Pinned tabs sit first; right-click a tab for pin, close and window actions. */
export function TabBar({ state, titles, activePath }: TabBarProps): React.JSX.Element {
  return (
    <div role="tablist" aria-label="Open documents" className="flex shrink-0 overflow-x-auto border-b border-line bg-canvas">
      {state.tabs.map((path) => {
        const active = path === activePath
        const isPinned = state.pinned.has(path)
        const title = titles.get(path) ?? path.split('/').pop() ?? path
        return (
          <ContextMenu.Root key={path}>
            <ContextMenu.Trigger asChild>
              <div
                onAuxClick={(event) => {
                  if (event.button === 1) void state.close(path)
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
                {isPinned ? (
                  <button
                    type="button"
                    onClick={() => state.togglePin(path)}
                    aria-label={`Unpin ${title}`}
                    title="Unpin"
                    className="grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-sunken hover:text-ink"
                  >
                    <Pin className="size-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void state.close(path)}
                    aria-label={`Close ${title}`}
                    title="Close (middle-click)"
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-sunken hover:text-ink',
                      !active && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                    )}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <TabMenu path={path} state={state} />
            </ContextMenu.Portal>
          </ContextMenu.Root>
        )
      })}
    </div>
  )
}
