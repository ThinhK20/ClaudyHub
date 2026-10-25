import os from 'node:os'
import type { GithubSettings, LayoutPreference, ProviderId, Settings, ThemePreference } from '@shared/domain'
import type { Db } from '../../db/connection'
import { UserError } from '../../errors'
import { parseJson } from '../util'

/** Encrypts secrets at rest. Backed by Electron safeStorage in the app and a fake in tests. */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): string
  decrypt(encoded: string): string
}

interface StoredSettings {
  defaultProvider: ProviderId
  claudeModel: string
  theme: ThemePreference
  layout: LayoutPreference
  displayName: string
  github: GithubSettings
}

export type SettingsPatch = Partial<StoredSettings>

const CLAUDE_KEY = 'secret.claudeApiKey'

function defaults(): StoredSettings {
  return {
    defaultProvider: 'copilot',
    claudeModel: 'claude-opus-5-5',
    theme: 'system',
    layout: 'classic',
    displayName: safeUsername(),
    // Configuration, not constants: the GitHub phase reads these instead of hard-coded names.
    github: { org: 'omniaintranet', sourceRepo: 'OmniaMono', qaRepo: 'qa-regression-management' }
  }
}

function safeUsername(): string {
  try {
    return os.userInfo().username || 'QA'
  } catch {
    return 'QA'
  }
}

export interface SettingsService {
  get(): Settings
  update(patch: SettingsPatch): Settings
  setClaudeApiKey(key: string | null): Settings
  getClaudeApiKey(): string | null
}

export function createSettingsService(db: Db, cipher: SecretCipher): SettingsService {
  const read = (key: string): string | null => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? String(row.value) : null
  }
  const write = (key: string, value: string): void => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value
    )
  }

  const stored = (): StoredSettings => {
    const base = defaults()
    return {
      defaultProvider: parseJson(read('defaultProvider'), base.defaultProvider),
      claudeModel: parseJson(read('claudeModel'), base.claudeModel),
      theme: parseJson(read('theme'), base.theme),
      layout: parseJson(read('layout'), base.layout),
      displayName: parseJson(read('displayName'), base.displayName),
      github: { ...base.github, ...parseJson<Partial<GithubSettings>>(read('github'), {}) }
    }
  }

  const get = (): Settings => ({ ...stored(), hasClaudeApiKey: read(CLAUDE_KEY) !== null })

  return {
    get,
    update(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) write(key, JSON.stringify(value))
      }
      return get()
    },
    setClaudeApiKey(key) {
      if (key === null) {
        db.prepare('DELETE FROM settings WHERE key = ?').run(CLAUDE_KEY)
        return get()
      }
      if (!cipher.isAvailable()) {
        throw new UserError('Secure storage is not available on this system, so the API key cannot be saved.')
      }
      write(CLAUDE_KEY, cipher.encrypt(key.trim()))
      return get()
    },
    getClaudeApiKey() {
      const encoded = read(CLAUDE_KEY)
      if (!encoded) return null
      try {
        return cipher.decrypt(encoded)
      } catch {
        return null
      }
    }
  }
}
