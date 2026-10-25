import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderGit2, GitBranch, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Codebase } from '@shared/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys, useCodebases } from '@/lib/queries'
import { errorText, timeAgo } from '@/lib/utils'

function CodebaseRow({ codebase, onChanged }: { codebase: Codebase; onChanged: () => Promise<void> }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(codebase.name)
  const [busy, setBusy] = useState(false)

  const act = async (action: () => Promise<unknown>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await onChanged()
      if (success) toast.success(success)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <FolderGit2 className="mt-0.5 size-4 text-muted" />
      <div className="min-w-0">
        {renaming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act(() => call('codebases:update', { id: codebase.id, name: name.trim() || codebase.name })).then(() => setRenaming(false))
            }}
          >
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="h-7 max-w-xs" aria-label="Codebase name" />
            <Button size="sm" type="submit" variant="primary">
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium">{codebase.name}</span>
            {codebase.isDefault ? <Badge tone="accent">Default</Badge> : null}
            {!codebase.available ? (
              <Badge tone="fail">
                <AlertTriangle className="size-3" /> Folder missing
              </Badge>
            ) : null}
          </div>
        )}
        <div className="mt-0.5 truncate text-[12px] text-muted" title={codebase.path}>
          {codebase.path}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-faint">
          {codebase.isGitRepo ? (
            <span className="flex items-center gap-1">
              <GitBranch className="size-3" /> {codebase.gitBranch ?? 'detached'} @ {codebase.gitHead ?? '?'}
            </span>
          ) : (
            <span>Not a git repository</span>
          )}
          {codebase.lastCheckedAt ? <span>checked {timeAgo(codebase.lastCheckedAt)}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {busy ? <Spinner className="mr-1 size-3.5" /> : null}
        {!codebase.isDefault ? (
          <Button size="sm" variant="ghost" onClick={() => void act(() => call('codebases:update', { id: codebase.id, isDefault: true }), `${codebase.name} is now the default`)}>
            <Star /> Make default
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" aria-label="Rename" title="Rename" onClick={() => setRenaming(true)}>
          <Pencil />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Refresh git info" title="Refresh git info" onClick={() => void act(() => call('codebases:refresh', { id: codebase.id }))}>
          <RefreshCw />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Disconnect"
          title="Disconnect (files are not touched)"
          onClick={() => void act(() => call('codebases:remove', { id: codebase.id }), `Disconnected ${codebase.name}`)}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

/** Manages the source folders AI assistants may read. */
export function CodebasesPage(): React.JSX.Element {
  const client = useQueryClient()
  const codebases = useCodebases()

  const refresh = async (): Promise<void> => {
    await Promise.all([client.invalidateQueries({ queryKey: keys.codebases }), client.invalidateQueries({ queryKey: keys.bootstrap })])
  }

  const connect = async (): Promise<void> => {
    const folder = await call('dialog:pickFolder', { title: 'Choose a codebase the AI may read' })
    if (!folder) return
    try {
      const added = await call('codebases:add', { path: folder })
      await refresh()
      toast.success(`Connected ${added.name}`)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Codebases"
        subtitle="Source folders the AI assistants may search. Access is read-only: they can read and search files but never change them or run commands."
        actions={
          <Button variant="primary" onClick={() => void connect()}>
            <Plus /> Connect codebase
          </Button>
        }
      />
      <div className="max-w-4xl p-6">
        {codebases.isPending ? (
          <Spinner />
        ) : codebases.data?.length ? (
          <>
            <ul className="rounded-lg border border-line bg-surface">
              {codebases.data.map((codebase) => (
                <CodebaseRow key={codebase.id} codebase={codebase} onChanged={refresh} />
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-muted">
              The default codebase is preselected for new runs and chats. Each run and each question can use a different codebase, or none.
            </p>
          </>
        ) : (
          <EmptyState
            title="No codebases connected"
            action={
              <Button variant="primary" onClick={() => void connect()}>
                <Plus /> Connect codebase
              </Button>
            }
          >
            Connect the product's source checkout so assistants can explain what the code does and propose test cases grounded in it.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
