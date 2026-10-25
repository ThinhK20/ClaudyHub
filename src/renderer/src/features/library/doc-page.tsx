import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useBlocker, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Check, ChevronRight, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Markdown, extractHeadings } from '@/components/markdown'
import { ResizeHandle, usePanelWidth } from '@/components/resizable'
import { Button } from '@/components/ui/button'
import { TextContextMenu, type TextMenuActions } from '@/components/text-context-menu'
import { Dialog } from '@/components/ui/dialog'
import { ErrorNotice, PageHeader, Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { keys } from '@/lib/queries'
import type { DocSection } from '@shared/domain'
import { SECTION_LABELS, errorText, groupLabel } from '@/lib/utils'
import type { DocEditorHandle } from './doc-editor'
import { DocProperties } from './doc-properties'

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

/** Read mode offers the copy actions; editing ones stay disabled. Markdown conversion loads the editor code on first use. */
function readMenuActions(docPath: string): TextMenuActions {
  return {
    selectedText: (root) => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) return ''
      return selection.toString()
    },
    copy: () => document.execCommand('copy'),
    copyMarkdown: async (root) => {
      const { domSelectionMarkdown } = await import('./selection-markdown')
      return domSelectionMarkdown(root, docPath)
    }
  }
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
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => edit.start(data.body)}
              disabled={!data.editable}
              title={data.editable ? 'Edit this document' : 'This document cannot be edited here because its frontmatter could not be read'}
            >
              <Pencil /> Edit
            </Button>
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
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {edit.editing ? (
          <article className="min-w-0 flex-1">
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
            <article className="min-w-0 flex-1 px-8 py-6">
              <Markdown text={data.body} docPath={data.path} />
            </article>
          </TextContextMenu>
        )}
        <div className="sticky top-0 hidden self-stretch lg:flex">
          <ResizeHandle panel={sidePanel} edge="left" label="Resize properties panel" />
        </div>
        <aside className="hidden shrink-0 border-l border-line bg-canvas px-4 py-6 lg:block" style={{ width: sidePanel.width }}>
          <DocProperties frontmatter={data.frontmatter} headings={headings} path={data.path} />
        </aside>
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
