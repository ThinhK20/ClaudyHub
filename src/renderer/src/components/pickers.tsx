import type { ProviderId } from '@shared/domain'
import { useCodebases } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Select } from './ui/fields'

export const PROVIDER_LABELS: Record<ProviderId, string> = { copilot: 'GitHub Copilot', claude: 'Claude' }

interface CodebaseSelectProps {
  value: string | null
  onChange: (id: string | null) => void
  id?: string
  className?: string
  disabled?: boolean
}

/** Chooses which connected codebase an AI request may read ("No codebase" keeps it prompt-only). */
export function CodebaseSelect({ value, onChange, id, className, disabled }: CodebaseSelectProps): React.JSX.Element {
  const codebases = useCodebases().data ?? []
  return (
    <Select
      id={id}
      aria-label="Codebase"
      className={cn('w-auto min-w-36', className)}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">No codebase</option>
      {codebases.map((codebase) => (
        <option key={codebase.id} value={codebase.id} disabled={!codebase.available}>
          {codebase.name}
          {codebase.available ? '' : ' (folder missing)'}
        </option>
      ))}
    </Select>
  )
}

interface ProviderSelectProps {
  value: ProviderId
  onChange: (id: ProviderId) => void
  id?: string
  className?: string
  disabled?: boolean
}

export function ProviderSelect({ value, onChange, id, className, disabled }: ProviderSelectProps): React.JSX.Element {
  return (
    <Select
      id={id}
      aria-label="AI engine"
      className={cn('w-auto', className)}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as ProviderId)}
    >
      {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((provider) => (
        <option key={provider} value={provider}>
          {PROVIDER_LABELS[provider]}
        </option>
      ))}
    </Select>
  )
}
