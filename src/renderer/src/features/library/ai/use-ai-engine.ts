import { useState } from 'react'
import type { ProviderId, ProviderStatus } from '@shared/domain'
import { PROVIDER_LABELS } from '@/components/pickers'
import { useProviders, useSettings } from '@/lib/queries'

const STORAGE_KEY = 'qa-hub.ai-assistant.provider'

function storedProvider(): ProviderId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'claude' || value === 'copilot' ? value : null
  } catch {
    return null
  }
}

export interface AiEngine {
  provider: ProviderId
  setProvider: (id: ProviderId) => void
  providers: ProviderStatus[]
  label: (id: ProviderId) => string
}

/** The engine for editor AI requests: remembered per device, starting from the Settings default. Never writes Settings. */
export function useAiEngine(): AiEngine {
  const settings = useSettings().data
  const providers = useProviders().data ?? []
  const [chosen, setChosen] = useState<ProviderId | null>(storedProvider)

  return {
    provider: chosen ?? settings?.defaultProvider ?? 'claude',
    setProvider: (id) => {
      setChosen(id)
      try {
        localStorage.setItem(STORAGE_KEY, id)
      } catch {
        // Storage can be unavailable; the choice still applies until the editor closes.
      }
    },
    providers,
    label: (id) => (id === 'claude' && settings?.claudeModel ? `${PROVIDER_LABELS.claude} · ${settings.claudeModel}` : PROVIDER_LABELS[id])
  }
}
