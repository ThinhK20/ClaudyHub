import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} aria-hidden />
}

type Tone = 'neutral' | 'accent' | 'pass' | 'fail' | 'blocked'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent-soft text-accent',
  pass: 'bg-pass-soft text-pass',
  fail: 'bg-fail-soft text-fail',
  blocked: 'bg-blocked-soft text-blocked'
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium', TONES[tone], className)}>{children}</span>
  )
}

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Shown before the title, e.g. a back button. */
  leading?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, subtitle, actions, leading, children }: PageHeaderProps): React.JSX.Element {
  return (
    <header className="border-b border-line bg-canvas px-6 pb-3 pt-5">
      <div className="flex items-start gap-4">
        {leading ? <div className="-ml-1.5 -mr-2 shrink-0 pt-px">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[19px] font-semibold tracking-tight">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  )
}

interface EmptyStateProps {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, children, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong p-6', className)}>
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-prose text-[12.5px] text-muted">{children}</div> : null}
      {action}
    </div>
  )
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="rounded border border-line-strong bg-surface px-1 text-[11px] text-muted">{children}</kbd>
}

export function ErrorNotice({ error }: { error: unknown }): React.JSX.Element {
  return (
    <div role="alert" className="rounded-md border border-fail/30 bg-fail-soft px-3 py-2 text-[12.5px] text-fail">
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}
