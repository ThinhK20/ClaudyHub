import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FolderOpen, Import, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ImportSummary, Settings } from '@shared/domain'
import type { IpcInput } from '@shared/ipc'
import { PROVIDER_LABELS, ProviderSelect } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/fields'
import { Badge, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useBootstrap, useProviders, useSettings, useWorkspaces } from '@/lib/queries'
import { cn, errorText } from '@/lib/utils'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="grid gap-4 border-b border-line py-6 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-[12.5px] text-muted">{description}</p> : null}
      </div>
      <div className="flex max-w-xl flex-col gap-4">{children}</div>
    </section>
  )
}

function useSaveSettings(): (patch: IpcInput<'settings:update'>) => Promise<void> {
  const client = useQueryClient()
  return async (patch) => {
    try {
      const updated = await call('settings:update', patch)
      client.setQueryData(keys.settings, updated)
      void client.invalidateQueries({ queryKey: keys.providers })
    } catch (error) {
      toast.error(errorText(error))
    }
  }
}

function AiSection({ settings }: { settings: Settings }): React.JSX.Element {
  const client = useQueryClient()
  const save = useSaveSettings()
  const providers = useProviders()
  const [model, setModel] = useState(settings.claudeModel)
  const [apiKey, setApiKey] = useState('')

  const setKey = async (key: string | null): Promise<void> => {
    try {
      client.setQueryData(keys.settings, await call('settings:setClaudeApiKey', { key }))
      setApiKey('')
      void client.invalidateQueries({ queryKey: keys.providers })
      toast.success(key ? 'API key saved' : 'API key removed')
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <Section title="AI engines" description="The default engine is preselected in every chat. Both engines only ever get read-only access to a codebase.">
      <Field label="Default engine">{(id) => <ProviderSelect id={id} value={settings.defaultProvider} onChange={(value) => void save({ defaultProvider: value })} />}</Field>
      <div className="rounded-md border border-line">
        {(['copilot', 'claude'] as const).map((id) => {
          const status = providers.data?.find((item) => item.id === id)
          return (
            <div key={id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <div>
                <div className="font-medium">{PROVIDER_LABELS[id]}</div>
                <div className={cn('text-[12px]', status?.ok ? 'text-pass' : 'text-muted')}>{providers.isFetching ? 'Checking…' : (status?.detail ?? '')}</div>
              </div>
              {status ? <Badge tone={status.ok ? 'pass' : 'neutral'}>{status.ok ? 'Ready' : 'Not ready'}</Badge> : null}
            </div>
          )
        })}
      </div>
      <div>
        <Button size="sm" variant="ghost" onClick={() => void providers.refetch()}>
          <RefreshCw /> Check again
        </Button>
      </div>
      <Field label="Claude model" hint="Model id passed to the Claude Agent SDK.">
        {(id) => (
          <div className="flex gap-2">
            <Input id={id} value={model} onChange={(event) => setModel(event.target.value)} />
            <Button disabled={!model.trim() || model === settings.claudeModel} onClick={() => void save({ claudeModel: model.trim() })}>
              Save
            </Button>
          </div>
        )}
      </Field>
      <Field label="Anthropic API key" hint="Encrypted with your operating system's secure storage. Never shown again after saving.">
        {(id) => (
          <div className="flex gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={settings.hasClaudeApiKey ? 'A key is saved' : 'sk-ant-…'}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button disabled={!apiKey.trim()} onClick={() => void setKey(apiKey.trim())}>
              Save key
            </Button>
            {settings.hasClaudeApiKey ? (
              <Button variant="danger" onClick={() => void setKey(null)}>
                Remove
              </Button>
            ) : null}
          </div>
        )}
      </Field>
    </Section>
  )
}

function WorkspaceSection(): React.JSX.Element {
  const client = useQueryClient()
  const workspaces = useWorkspaces()
  const active = useBootstrap().data?.workspace

  const refresh = async (): Promise<void> => {
    await Promise.all([client.invalidateQueries({ queryKey: keys.workspaces }), client.invalidateQueries({ queryKey: keys.bootstrap }), client.invalidateQueries({ queryKey: keys.docs })])
  }
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
      await refresh()
    } catch (error) {
      toast.error(errorText(error))
    }
  }
  const add = async (): Promise<void> => {
    const folder = await call('dialog:pickFolder', { title: 'Choose a QA repository folder' })
    if (folder) await run(() => call('workspaces:add', { path: folder }))
  }

  return (
    <Section title="QA workspaces" description="QA repositories indexed by the Library. One is active at a time.">
      <ul className="rounded-md border border-line">
        {(workspaces.data ?? []).map((workspace) => (
          <li key={workspace.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {workspace.name} {workspace.id === active?.id ? <Check className="size-3.5 text-pass" aria-label="Active" /> : null}
              </div>
              <div className="truncate text-[12px] text-muted">{workspace.path}</div>
            </div>
            {workspace.id !== active?.id ? (
              <Button size="sm" onClick={() => void run(() => call('workspaces:activate', { id: workspace.id }))}>
                Switch
              </Button>
            ) : null}
            <Button size="icon" variant="ghost" aria-label="Remove workspace" title="Remove (files are not touched)" onClick={() => void run(() => call('workspaces:remove', { id: workspace.id }))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button onClick={() => void add()}>
          <FolderOpen /> Add workspace
        </Button>
      </div>
    </Section>
  )
}

function ImportSection(): React.JSX.Element {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const runImport = async (): Promise<void> => {
    const dataDir = await call('dialog:pickFolder', { title: 'Choose the qa-portal/.data folder' })
    if (!dataDir) return
    setBusy(true)
    try {
      setSummary(await call('import:qaPortal', { dataDir }))
      await client.invalidateQueries({ queryKey: keys.runs })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Import from qa-portal" description="Bring runs, results, evidence and chats over from the old web portal. Runs already imported are skipped.">
      <div>
        <Button onClick={() => void runImport()} disabled={busy}>
          {busy ? <Spinner className="size-3.5" /> : <Import />} Choose qa-portal/.data folder
        </Button>
      </div>
      {summary ? (
        <p className="text-[12.5px] text-muted">
          Imported {summary.runs} runs, {summary.cases} cases, {summary.attachments} evidence files and {summary.chatMessages} chat messages.
          {summary.skipped.length ? ` Skipped: ${summary.skipped.join('; ')}.` : ''}
        </p>
      ) : null}
    </Section>
  )
}

function GeneralSection({ settings }: { settings: Settings }): React.JSX.Element {
  const save = useSaveSettings()
  const [displayName, setDisplayName] = useState(settings.displayName)
  const [github, setGithub] = useState(settings.github)
  useEffect(() => setGithub(settings.github), [settings.github])

  return (
    <>
      <Section title="Appearance">
        <Field label="Theme">
          {(id) => (
            <Select id={id} className="w-48" value={settings.theme} onChange={(event) => void save({ theme: event.target.value as Settings['theme'] })}>
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          )}
        </Field>
      </Section>
      <Section title="Profile" description="How you are named when results are shared through GitHub publishing (coming next).">
        <Field label="Display name">
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              <Button disabled={!displayName.trim() || displayName === settings.displayName} onClick={() => void save({ displayName: displayName.trim() })}>
                Save
              </Button>
            </div>
          )}
        </Field>
      </Section>
      <Section title="GitHub" description="Used by upcoming GitHub sync and publishing. Nothing is sent to GitHub yet.">
        <div className="grid grid-cols-3 gap-2">
          {(['org', 'sourceRepo', 'qaRepo'] as const).map((key) => (
            <Field key={key} label={{ org: 'Organization', sourceRepo: 'Product repository', qaRepo: 'QA repository' }[key]}>
              {(id) => <Input id={id} value={github[key]} onChange={(event) => setGithub({ ...github, [key]: event.target.value })} />}
            </Field>
          ))}
        </div>
        <div>
          <Button disabled={JSON.stringify(github) === JSON.stringify(settings.github)} onClick={() => void save({ github })}>
            Save GitHub settings
          </Button>
        </div>
      </Section>
    </>
  )
}

export function SettingsPage(): React.JSX.Element {
  const settings = useSettings()
  const version = useBootstrap().data?.version
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Settings" subtitle={version ? `QA Hub ${version}` : undefined} />
      <div className="px-6">
        {settings.data ? (
          <>
            <AiSection settings={settings.data} />
            <WorkspaceSection />
            <GeneralSection settings={settings.data} />
            <ImportSection />
          </>
        ) : (
          <div className="py-6">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  )
}
