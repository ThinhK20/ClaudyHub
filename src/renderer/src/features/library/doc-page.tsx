import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useBlocker, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Check, ChevronRight, Columns2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Markdown, extractHeadings } from '@/components/markdown'
import { ResizeHandle, usePanelWidth } from '@/components/resizable'
import { Button } from '@/components/ui/button'
import { TextContextMenu } from '@/components/text-context-menu'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNotice, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys } from '@/lib/queries'
import type { DocSection } from '@shared/domain'
import { SECTION_LABELS, cn, errorText, groupLabel } from '@/lib/utils'
import { DocActionsMenu } from './doc-actions-menu'
import type { DocEditorHandle } from './doc-editor'
import { DocFindBar } from './doc-find-bar'
import { DocProperties } from './doc-properties'
import { DocSplitPane } from './doc-split-pane'
import { readMenuActions } from './read-menu-actions'

// The editor and its dependencies load only when a document is first edited.
const DocEditor = lazy(() => import('./doc-editor'))

const route = getRouteApi('/library/doc/$')

/** Returns to the previous screen, or to the document's library group when there is no history (e.g. a fresh launch). */
function BackButton({ section, group }: { section: DocSection; group?: string }): React.JSX.Element {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        if (canGoBack) router.history.back()
        else void navigate({ to: '/library', search: { section, group: group || undefined } })
      }}
      aria-label="Back"
      title="Back"
      className="[&_svg]:size-4"
    >
      <ArrowLeft />
    </Button>
  )
}

interface ConfirmDiscardProps {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

function ConfirmDiscard({ open, onKeep, onDiscard }: ConfirmDiscardProps): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep()
      }}
      title="Discard unsaved changes?"
      description="Your edits to this document have not been saved."
      footer={
        <>
          <Button size="sm" onClick={onKeep}>
            Keep editing
          </Button>
          <Button size="sm" variant="danger" onClick={onDiscard}>
            Discard changes
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted">If you leave now, the changes are lost. Save first to keep them.</p>
    </Dialog>
  )
}

const FULL_WIDTH_KEY = 'qa-hub.doc.full-width'

/** Whether documents use the whole page width instead of a readable line length, remembered across documents. */
function useFullWidth(): [boolean, (fullWidth: boolean) => void] {
  const [fullWidth, setFullWidth] = useState(() => {
    try {
      return localStorage.getItem(FULL_WIDTH_KEY) === '1'
    } catch {
      return false
    }
  })
  const change = (next: boolean): void => {
    setFullWidth(next)
    try {
      localStorage.setItem(FULL_WIDTH_KEY, next ? '1' : '0')
    } catch {
      // Storage is a convenience; the setting still applies for this session.
    }
  }
  return [fullWidth, change]
}

interface DocEditing {
  editing: boolean
  base: string
  dirty: boolean
  saving: boolean
  start: (body: string) => void
  stop: () => void
  setDirty: (dirty: boolean) => void
  save: (stayInEditor: boolean) => Promise<void>
}

/** Edit-mode state for one document: the body it was opened with (to detect changes on disk) and whether there are unsaved changes. */
function useDocEditing(path: string, editorRef: React.RefObject<DocEditorHandle | null>): DocEditing {
  const client = useQueryClient()
  const [session, setSession] = useState<{ path: string; base: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const editing = session?.path === path

  const stop = (): void => {
    setSession(null)
    setDirty(false)
  }

  const save = async (stayInEditor: boolean): Promise<void> => {
    if (!session || !editorRef.current || saving) return
    setSaving(true)
    try {
      const saved = await call('docs:save', { path, body: editorRef.current.getMarkdown(), baseBody: session.base })
      client.setQueryData(keys.doc(path), saved)
      toast.success('Document saved')
      if (stayInEditor) {
        setSession({ path, base: saved.body })
        editorRef.current.markSaved()
      } else {
        stop()
      }
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  return {
    editing,
    base: session?.base ?? '',
    dirty: editing && dirty,
    saving,
    start: (body) => {
      setSession({ path, base: body })
      setDirty(false)
    },
    stop,
    setDirty,
    save
  }
}

export function DocPage(): React.JSX.Element {
  const path = route.useParams()._splat ?? ''
  const doc = useQuery({ queryKey: keys.doc(path), queryFn: () => call('docs:get', { path }) })
  const headings = useMemo(() => extractHeadings(doc.data?.body ?? ''), [doc.data?.body])
  const sidePanel = usePanelWidth({ key: 'qa-hub.width.doc-properties', initial: 288, min: 220, max: 520 })
  const editorRef = useRef<DocEditorHandle | null>(null)
  const edit = useDocEditing(path, editorRef)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [finding, setFinding] = useState(false)
  // The split stays open while moving between documents; `path` is null while a note is being picked.
  const [split, setSplit] = useState<{ path: string | null } | null>(null)
  const [fullWidth, setFullWidth] = useFullWidth()
  const contentRef = useRef<HTMLElement>(null)
  // Leaving the page (back button, links, sidebar) with unsaved edits asks first.
  const blocker = useBlocker({ shouldBlockFn: () => edit.dirty, withResolver: true, enableBeforeUnload: false })

  const saveRef = useRef(edit.save)
  useLayoutEffect(() => {
    saveRef.current = edit.save
  })
  useEffect(() => {
    if (!edit.editing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [edit.editing])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setFinding(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (doc.isPending) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    )
  }
  if (doc.error) {
    return (
      <div className="p-6">
        <ErrorNotice error={doc.error} />
      </div>
    )
  }

  const data = doc.data
  const docActions = (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setSplit(split ? null : { path: null })}
        aria-pressed={Boolean(split)}
        aria-label={split ? 'Close split' : 'Create new split'}
        title={split ? 'Close split' : 'Create new split'}
        className={split ? 'bg-sunken text-ink' : undefined}
      >
        <Columns2 />
      </Button>
      <DocActionsMenu
        doc={data}
        getContent={() => contentRef.current}
        fullWidth={fullWidth}
        onFullWidthChange={setFullWidth}
        onSearch={() => setFinding(true)}
        onDeleted={edit.stop}
      />
    </>
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        leading={<BackButton section={data.section} group={data.group} />}
        title={data.title}
        actions={
          edit.editing ? (
            <>
              <span className="mr-1 flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
                <span className={edit.dirty ? 'size-1.5 rounded-full bg-blocked' : 'size-1.5 rounded-full bg-pass'} aria-hidden />
                {edit.saving ? 'Saving…' : edit.dirty ? 'Unsaved changes' : 'No changes'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => (edit.dirty ? setConfirmCancel(true) : edit.stop())} disabled={edit.saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void edit.save(false)}
                disabled={!edit.dirty || edit.saving}
                title="Save and return to reading (Ctrl+S saves and keeps editing)"
              >
                {edit.saving ? <Spinner className="size-3.5" /> : <Check />} Save
              </Button>
              {docActions}
            </>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => edit.start(data.body)}
                disabled={!data.editable}
                title={data.editable ? 'Edit this document' : 'This document cannot be edited here because its frontmatter could not be read'}
              >
                <Pencil /> Edit
              </Button>
              {docActions}
            </>
          )
        }
        subtitle={
          <span className="flex items-center gap-1">
            <Link to="/library" search={{ section: data.section }} className="hover:text-ink hover:underline">
              {SECTION_LABELS[data.section]}
            </Link>
            {data.group ? (
              <>
                <ChevronRight className="size-3" />
                <Link to="/library" search={{ section: data.section, group: data.group }} className="hover:text-ink hover:underline">
                  {groupLabel(data.group)}
                </Link>
              </>
            ) : null}
          </span>
        }
      />
      {finding ? <DocFindBar key={path} getRoot={() => contentRef.current} onClose={() => setFinding(false)} /> : null}
      <div className={cn('flex min-h-0 flex-1', fullWidth && 'doc-full-width')}>
        <div className="flex min-w-0 flex-1 basis-0 overflow-y-auto">
          {edit.editing ? (
            <article ref={contentRef} className="min-w-0 flex-1">
              <Suspense
                fallback={
                  <div className="p-8">
                    <Spinner />
                  </div>
                }
              >
                <DocEditor ref={editorRef} markdown={edit.base} docPath={data.path} onDirtyChange={edit.setDirty} />
              </Suspense>
            </article>
          ) : (
            <TextContextMenu actions={readMenuActions(data.path)}>
              <article ref={contentRef} className="min-w-0 flex-1 px-8 py-6">
                <Markdown text={data.body} docPath={data.path} />
              </article>
            </TextContextMenu>
          )}
          {/* A split takes the properties panel's room so both notes get half the width. */}
          {split ? null : (
            <>
              <div className="sticky top-0 hidden self-stretch lg:flex">
                <ResizeHandle panel={sidePanel} edge="left" label="Resize properties panel" />
              </div>
              <aside className="hidden shrink-0 border-l border-line bg-canvas px-4 py-6 lg:block" style={{ width: sidePanel.width }}>
                <DocProperties frontmatter={data.frontmatter} headings={headings} path={data.path} />
              </aside>
            </>
          )}
        </div>
        {split ? (
          <DocSplitPane mainPath={data.path} path={split.path} onPathChange={(next) => setSplit({ path: next })} onClose={() => setSplit(null)} />
        ) : null}
      </div>
      <ConfirmDiscard
        open={confirmCancel || blocker.status === 'blocked'}
        onKeep={() => {
          setConfirmCancel(false)
          blocker.reset?.()
        }}
        onDiscard={() => {
          setConfirmCancel(false)
          edit.stop()
          blocker.proceed?.()
        }}
      />
    </div>
  )
}
