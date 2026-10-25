import { useEffect, useState, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

export interface NavItemProps {
  to: '/' | '/library' | '/runs' | '/codebases' | '/settings'
  label: string
  icon: ComponentType<{ className?: string }>
  count?: number
  exact?: boolean
  collapsed: boolean
}

export function NavItem({ to, label, icon: Icon, count, exact, collapsed }: NavItemProps): React.JSX.Element {
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

/** Sidebar collapse state, remembered across launches and toggled with Ctrl+B. Shared by both layouts. */
export function useSidebarCollapsed(): [boolean, () => void] {
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
