import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { Bot, FlaskConical, FolderGit2, LayoutGrid, Library, PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react'
import { OnboardingPage } from '@/features/onboarding/onboarding'
import { useBootstrap, useCodebases, useRuns } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { CommandPalette } from './command-palette'
import { ErrorNotice, Kbd, Spinner } from './ui/misc'

interface NavItemProps {
  to: '/' | '/library' | '/runs' | '/codebases' | '/settings'
  label: string
  icon: ComponentType<{ className?: string }>
  count?: number
  exact?: boolean
  collapsed: boolean
}

function NavItem({ to, label, icon: Icon, count, exact, collapsed }: NavItemProps): React.JSX.Element {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      title={collapsed ? (count ? `${label} (${count})` : label) : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] text-muted hover:bg-sunken hover:text-ink',
        collapsed ? 'justify-center' : 'px-2.5'
      )}
      activeProps={{ className: 'bg-surface text-ink font-medium shadow-[inset_2px_0_0_var(--accent)]' }}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? (
        count ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /> : null
      ) : (
        <>
          <span className="flex-1 truncate">{label}</span>
          {count ? <span className="text-[11.5px] text-faint">{count}</span> : null}
        </>
      )}
    </Link>
  )
}

const COLLAPSED_KEY = 'qa-hub.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

/** Sidebar collapse state, remembered across launches and toggled with Ctrl+B. */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = (): void =>
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!current))
      } catch {
        // Storage is a convenience; the toggle still applies for this session.
      }
      return !current
    })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Inside editable text Ctrl+B means bold, so leave it to the editor.
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return [collapsed, toggle]
}

const PEEK_OPEN_MS = 120
const PEEK_CLOSE_MS = 200

/** While the sidebar is hidden, hovering it (or tabbing into it) expands it over the page until the pointer or focus leaves. */
function useSidebarPeek(collapsed: boolean): {
  peeking: boolean
  close: () => void
  handlers: Pick<React.HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur'>
} {
  const [peeking, setPeeking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const schedule = (open: boolean, delay: number): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPeeking(open), delay)
  }
  const close = (): void => {
    clearTimeout(timer.current)
    setPeeking(false)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    peeking: collapsed && peeking,
    close,
    handlers: {
      onMouseEnter: () => {
        if (collapsed) schedule(true, PEEK_OPEN_MS)
      },
      onMouseLeave: () => schedule(false, PEEK_CLOSE_MS),
      // Only keyboard focus opens it, so focus left on a clicked link doesn't hold it open after the pointer leaves.
      onFocus: (event) => {
        if (collapsed && event.target.matches(':focus-visible')) schedule(true, 0)
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) schedule(false, 0)
      }
    }
  }
}

/** Window chrome: sidebar navigation around the routed page. Shows onboarding until a workspace is chosen. */
export function AppShell(): React.JSX.Element {
  const bootstrap = useBootstrap()
  const runs = useRuns()
  const codebases = useCodebases().data ?? []
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const peek = useSidebarPeek(collapsed)
  const compact = collapsed && !peek.peeking

  if (bootstrap.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    )
  }
  if (bootstrap.error) {
    return (
      <div className="p-8">
        <ErrorNotice error={bootstrap.error} />
      </div>
    )
  }
  if (!bootstrap.data.workspace) return <OnboardingPage />

  const activeRuns = (runs.data ?? []).filter((run) => run.status === 'running' || run.status === 'ready').length
  const defaultCodebase = codebases.find((codebase) => codebase.isDefault)

  return (
    <div className="flex h-full">
      {/* Keeps the layout width fixed so a peeking sidebar overlays the page instead of pushing it. */}
      <div className={cn('relative shrink-0 transition-[width] duration-150', collapsed ? 'w-14' : 'w-56')}>
        <aside
          {...peek.handlers}
          className={cn(
            'flex h-full flex-col border-r border-line bg-canvas pb-3 pt-4 transition-[width,box-shadow] duration-150',
            collapsed && 'absolute inset-y-0 left-0 z-30',
            compact ? 'w-14 px-2' : 'w-56 px-2.5',
            peek.peeking && 'shadow-xl'
          )}
        >
          <div className={cn('flex items-start gap-1', compact ? 'justify-center' : 'pl-2.5')}>
            {compact ? null : (
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15px] font-semibold tracking-tight">QA Hub</div>
                <div className="truncate text-[12px] text-muted" title={bootstrap.data.workspace.path}>
                  {bootstrap.data.workspace.name}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                peek.close()
                toggleCollapsed()
              }}
              className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-sunken hover:text-ink"
              aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-expanded={!collapsed}
              title={`${collapsed ? 'Show' : 'Hide'} sidebar (Ctrl+B)`}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title={compact ? 'Search (Ctrl K)' : undefined}
            aria-label={compact ? 'Search' : undefined}
            className={cn(
              'mt-4 flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface text-[12.5px] text-faint hover:text-muted',
              compact ? 'justify-center' : 'mx-0.5 px-2.5'
            )}
          >
            <Search className="size-3.5" />
            {compact ? null : (
              <>
                <span className="flex-1 text-left">Search</span>
                <Kbd>Ctrl K</Kbd>
              </>
            )}
          </button>
          <nav className="mt-4 flex flex-col gap-0.5" aria-label="Main">
            <NavItem to="/" label="Overview" icon={LayoutGrid} exact collapsed={compact} />
            <NavItem to="/library" label="Library" icon={Library} collapsed={compact} />
            <NavItem to="/runs" label="Test runs" icon={FlaskConical} count={activeRuns} collapsed={compact} />
            <NavItem to="/codebases" label="Codebases" icon={FolderGit2} count={codebases.length} collapsed={compact} />
          </nav>
          <div className="mt-auto flex flex-col gap-2">
            {compact ? (
              <Link
                to="/codebases"
                title={`AI reads: ${defaultCodebase ? defaultCodebase.name : 'no codebase connected'}`}
                aria-label="AI codebase"
                className="grid h-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
              >
                <Bot className={cn('size-4', !defaultCodebase && 'text-faint')} />
              </Link>
            ) : (
              <Link
                to="/codebases"
                className={cn('mx-0.5 rounded-md border border-line px-2.5 py-2 text-[12px] hover:bg-sunken', !defaultCodebase && 'border-dashed')}
              >
                <div className="text-faint">AI reads</div>
                <div className="truncate font-medium text-ink">{defaultCodebase ? defaultCodebase.name : 'No codebase connected'}</div>
              </Link>
            )}
            <NavItem to="/settings" label="Settings" icon={Settings} collapsed={compact} />
          </div>
        </aside>
      </div>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
