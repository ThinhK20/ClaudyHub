import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { toast } from 'sonner'
import { TextContextMenu, type TextMenuActions } from '@/components/text-context-menu'
import { Spinner } from '@/components/ui/misc'
import { errorText } from '@/lib/utils'
import { AiMenu } from './ai/ai-menu'
import { AiPanel } from './ai/ai-panel'
import { applyProposal, captureDocument, captureSelection, trackRange, type CapturedSelection } from './ai/apply-proposal'
import { ASK_AI, type AiRequest } from './ai/shortcuts'
import { useAiEngine } from './ai/use-ai-engine'
import { EditorToolbar } from './doc-editor-toolbar'
import { docExtensions } from './editor-extensions'
import { serializePreserving } from './markdown-preserve'
import { editorSelectionMarkdown } from './selection-markdown'

export interface DocEditorHandle {
  getMarkdown: () => string
  /** Treats the current content as saved, so it no longer counts as unsaved changes. */
  markSaved: () => void
}

interface DocEditorProps {
  markdown: string
  /** Workspace-relative path of the document, used to show its relative images. */
  docPath: string
  onDirtyChange: (dirty: boolean) => void
  ref?: Ref<DocEditorHandle>
}

/** Clipboard actions for the right-click menu. Paste reads the clipboard itself, since a page cannot trigger a native paste. */
function editorMenuActions(editor: Editor): TextMenuActions {
  const clipboardCommand = (command: 'cut' | 'copy') => (): void => {
    editor.commands.focus()
    document.execCommand(command)
  }
  return {
    selectedText: () => {
      const { from, to } = editor.state.selection
      return editor.state.doc.textBetween(from, to, ' ')
    },
    cut: clipboardCommand('cut'),
    copy: clipboardCommand('copy'),
    copyMarkdown: () => editorSelectionMarkdown(editor),
    paste: async () => {
      editor.commands.focus()
      for (const item of await navigator.clipboard.read()) {
        if (!item.types.includes('text/html')) continue
        editor.view.pasteHTML(await (await item.getType('text/html')).text())
        return
      }
      editor.view.pasteText(await navigator.clipboard.readText())
    },
    pastePlain: async () => {
      editor.commands.focus()
      editor.view.pasteText(await navigator.clipboard.readText())
    }
  }
}

/** Rich-text editor over a document's Markdown body. Loaded on demand, only when a document enters edit mode. */
export default function DocEditor({ markdown, docPath, onDirtyChange, ref }: DocEditorProps): React.JSX.Element {
  const baseline = useRef<{ doc: ProseMirrorNode; markdown: string } | null>(null)
  const onDirtyChangeRef = useRef(onDirtyChange)
  useLayoutEffect(() => {
    onDirtyChangeRef.current = onDirtyChange
  })

  const editor = useEditor({
    extensions: docExtensions(docPath),
    content: markdown,
    contentType: 'markdown',
    autofocus: 'start',
    editorProps: {
      attributes: { class: 'prose-qa doc-editor outline-none', spellcheck: 'true', 'aria-label': 'Document content' }
    },
    onCreate: ({ editor: created }) => {
      baseline.current = { doc: created.state.doc, markdown: created.getMarkdown().trimEnd() }
    },
    // Tiptap normalizes the document right after loading (e.g. a trailing paragraph after a table), so "changed"
    // means the Markdown that would be saved differs, not that the editor tree differs.
    onUpdate: ({ editor: updated }) => {
      const base = baseline.current
      // Updates can arrive while the editor is still being created; those are never user edits.
      if (!base) return
      onDirtyChangeRef.current(!base.doc.eq(updated.state.doc) && updated.getMarkdown().trimEnd() !== base.markdown)
    }
  })

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => (editor ? serializePreserving(editor, markdown) : markdown),
      markSaved: () => {
        if (editor) baseline.current = { doc: editor.state.doc, markdown: editor.getMarkdown().trimEnd() }
        onDirtyChangeRef.current(false)
      }
    }),
    [editor, markdown]
  )

  // AI assistant: the request being worked on, the selection it is about, and that selection followed through later edits.
  const engine = useAiEngine()
  const [ai, setAi] = useState<{ id: number; request: AiRequest; selection: CapturedSelection } | null>(null)
  const tracker = useRef<ReturnType<typeof trackRange> | null>(null)
  useEffect(() => () => tracker.current?.dispose(), [])

  const openAi = (request: AiRequest, scope: 'selection' | 'document' = 'selection'): void => {
    if (!editor) return
    const selection = scope === 'document' ? captureDocument(editor) : captureSelection(editor)
    tracker.current?.dispose()
    tracker.current = trackRange(editor, selection)
    setAi({ id: Date.now(), request, selection })
  }
  const closeAi = (): void => {
    tracker.current?.dispose()
    tracker.current = null
    setAi(null)
  }
  const applyAi = (markdown: string, mode: 'insert' | 'replace'): void => {
    if (editor && ai && tracker.current) {
      try {
        applyProposal(editor, markdown, { ...tracker.current.current(), inline: ai.selection.inline, code: ai.selection.code }, mode)
      } catch (error) {
        // Keep the panel open so the result is not lost, and say why nothing changed.
        console.error('[ai] applying the result failed', error)
        toast.error(`Could not apply the AI result: ${errorText(error)}`)
        return
      }
    }
    closeAi()
  }

  if (!editor) return <Spinner />

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20">
        <EditorToolbar editor={editor} onAskAi={() => openAi(ASK_AI, 'document')} />
      </div>
      <TextContextMenu
        actions={editorMenuActions(editor)}
        aiMenu={({ hasSelection }) => <AiMenu engine={engine} hasSelection={hasSelection} onRequest={openAi} />}
      >
        <div className="flex-1 px-8 py-6" onClick={(event) => event.target === event.currentTarget && editor.commands.focus('end')}>
          <EditorContent editor={editor} />
        </div>
      </TextContextMenu>
      {ai ? (
        <AiPanel key={ai.id} editor={editor} docPath={docPath} engine={engine} request={ai.request} selection={ai.selection} onApply={applyAi} onClose={closeAi} />
      ) : null}
    </div>
  )
}
