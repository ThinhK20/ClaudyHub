import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, FolderGit2, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { Codebase, ProviderId, Workspace } from '@shared/domain'
import { PROVIDER_LABELS } from '@/components/pickers'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/fields'
import { Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useProviders } from '@/lib/queries'
import { cn, errorText } from '@/lib/utils'

type Step = 0 | 1 | 2
const STEPS = ['QA workspace', 'Codebases', 'AI engine'] as const

/** First run: choose the QA repository, connect source codebases, and pick an AI engine. */
export function OnboardingPage(): React.JSX.Element {
  const client = useQueryClient()
  const [step, setStep] = useState<Step>(0)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [codebases, setCodebases] = useState<Codebase[]>([])
  const [busy, setBusy] = useState(false)

  const pickWorkspace = async (): Promise<void> => {
    const folder = await call('dialog:pickFolder', { title: 'Choose your QA repository folder' })
    if (!folder) return
    setBusy(true)
    try {
      setWorkspace(await call('workspaces:add', { path: folder }))
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const addCodebase = async (): Promise<void> => {
    const folder = await call('dialog:pickFolder', { title: 'Choose a codebase the AI may read' })
    if (!folder) return
    try {
      const added = await call('codebases:add', { path: folder })
      setCodebases((current) => [...current, added])
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const finish = async (): Promise<void> => {
    await Promise.all([client.invalidateQueries({ queryKey: keys.bootstrap }), client.invalidateQueries({ queryKey: keys.codebases })])
  }

  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-canvas p-6">
      <div className="w-full max-w-[560px]">
        <h1 className="font-display text-[26px] font-semibold tracking-tight">Set up QA Hub</h1>
        <p className="mt-1 text-muted">Three quick steps. You can change all of this later in Settings.</p>
        <ol className="mt-6 flex gap-2" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={cn(
                'flex flex-1 items-center gap-2 border-t-2 pt-2 text-[12.5px]',
                index < step ? 'border-pass text-ink' : index === step ? 'border-accent font-medium text-ink' : 'border-line text-faint'
              )}
              aria-current={index === step ? 'step' : undefined}
            >
              {index < step ? <Check className="size-3.5 text-pass" /> : <span>{index + 1}.</span>}
              {label}
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-lg border border-line bg-surface p-5">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold">Choose your QA repository</h2>
                <p className="mt-1 text-muted">
                  The folder that holds your test cases and regression checklists (for example a checkout of qa-regression-management). QA Hub indexes its
                  Markdown and never changes it.
                </p>
              </div>
              {workspace ? (
                <div className="flex items-center gap-2 rounded-md bg-pass-soft px-3 py-2 text-[12.5px]">
                  <Check className="size-4 text-pass" />
                  <span className="truncate">{workspace.path}</span>
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button variant={workspace ? 'secondary' : 'primary'} onClick={() => void pickWorkspace()} disabled={busy}>
                  {busy ? <Spinner className="text-current" /> : <FolderOpen />} {workspace ? 'Choose a different folder' : 'Choose folder'}
                </Button>
                {workspace ? (
                  <Button variant="primary" onClick={() => setStep(1)}>
                    Continue
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-semibold">Connect the codebases AI may read</h2>
                <p className="mt-1 text-muted">
                  AI assistants can search a connected codebase to explain behavior and ground new test cases. Access is read-only: they cannot change files or run
                  commands. Connect as many as you like and pick one per run or chat.
                </p>
              </div>
              {codebases.length ? (
                <ul className="flex flex-col gap-1.5">
                  {codebases.map((codebase) => (
                    <li key={codebase.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[12.5px]">
                      <FolderGit2 className="size-4 text-muted" />
                      <span className="font-medium">{codebase.name}</span>
                      <span className="truncate text-faint">{codebase.path}</span>
                      {codebase.isDefault ? <span className="ml-auto text-[11.5px] text-accent">Default</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex gap-2">
                <Button onClick={() => void addCodebase()}>
                  <FolderGit2 /> Connect codebase
                </Button>
                <Button variant="primary" onClick={() => setStep(2)}>
                  {codebases.length ? 'Continue' : 'Skip for now'}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && <AiStep onFinish={() => void finish()} />}
        </div>
      </div>
    </div>
  )
}

function AiStep({ onFinish }: { onFinish: () => void }): React.JSX.Element {
  const client = useQueryClient()
  const providers = useProviders()
  const [provider, setProvider] = useState<ProviderId>('copilot')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await call('settings:update', { defaultProvider: provider })
      if (apiKey.trim()) await call('settings:setClaudeApiKey', { key: apiKey.trim() })
      await client.invalidateQueries({ queryKey: keys.settings })
      onFinish()
    } catch (error) {
      toast.error(errorText(error))
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Pick the default AI engine</h2>
        <p className="mt-1 text-muted">Each chat can switch engines. GitHub Copilot uses your signed-in Copilot CLI; Claude needs an Anthropic API key.</p>
      </div>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Default AI engine">
        {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => {
          const status = providers.data?.find((item) => item.id === id)
          return (
            <label key={id} className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5', provider === id ? 'border-accent bg-accent-soft' : 'border-line')}>
              <input type="radio" name="provider" className="mt-1 accent-[var(--accent)]" checked={provider === id} onChange={() => setProvider(id)} />
              <span>
                <span className="font-medium">{PROVIDER_LABELS[id]}</span>
                <span className={cn('block text-[12px]', status?.ok ? 'text-pass' : 'text-faint')}>
                  {providers.isPending ? 'Checking…' : (status?.detail ?? '')}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      {provider === 'claude' ? (
        <Field label="Anthropic API key" hint="Stored encrypted with your operating system's secure storage.">
          {(id) => <Input id={id} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-ant-…" />}
        </Field>
      ) : null}
      <div>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner className="text-current" /> : null} Finish setup
        </Button>
      </div>
    </div>
  )
}
