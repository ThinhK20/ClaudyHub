import type { Editor, JSONContent } from '@tiptap/react'
import type { Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { editorSelectionMarkdown } from '../selection-markdown'

/** The selection the AI request is about, captured when the panel opens. */
export interface CapturedSelection {
  from: number
  to: number
  markdown: string
  /** True when the selection sits inside a single paragraph, list item text or table cell. */
  inline: boolean
  /** True when the selection sits inside a single code block: the answer goes in as literal text. */
  code: boolean
  /** False for an empty selection or several table cells, which can only be inserted below. */
  replaceable: boolean
  /** The request is about the whole document, not a selection: Replace swaps out all of it. */
  wholeDocument?: boolean
}

export interface TrackedTarget {
  from: number
  to: number
  /** The selected content was removed while the panel was open. */
  deleted: boolean
}

export function captureSelection(editor: Editor): CapturedSelection {
  const { selection } = editor.state
  const { from, to, $from, $to, empty } = selection
  if (empty) return { from, to, markdown: '', inline: false, code: false, replaceable: false }
  // A cell selection's from/to cover only its first cell, so replacing would break the table.
  if (selection instanceof CellSelection) {
    return { from, to, markdown: editorSelectionMarkdown(editor), inline: false, code: false, replaceable: false }
  }
  const sameBlock = $from.sameParent($to) && $from.parent.isTextblock
  const code = sameBlock && Boolean($from.parent.type.spec.code)
  if (sameBlock) return { from, to, markdown: editorSelectionMarkdown(editor), inline: !code, code, replaceable: true }
  // Across blocks, widen to whole paragraphs at both ends so replacing never leaves split-off fragments.
  const range = { from: $from.parent.isTextblock ? $from.before() : from, to: $to.parent.isTextblock ? $to.after() : to }
  return { ...range, markdown: editorSelectionMarkdown(editor, range), inline: false, code: false, replaceable: true }
}

/** The whole document as the AI target, whatever is selected. */
export function captureDocument(editor: Editor): CapturedSelection {
  const markdown = editor.getMarkdown()
  return { from: 0, to: editor.state.doc.content.size, markdown, inline: false, code: false, replaceable: markdown.trim().length > 0, wholeDocument: true }
}

/** Follows a range through later edits, so a result still lands where the user asked even if they kept typing. */
export function trackRange(editor: Editor, range: { from: number; to: number }): { current: () => TrackedTarget; dispose: () => void } {
  let target: TrackedTarget = { ...range, deleted: false }
  const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
    if (!transaction.docChanged) return
    const start = transaction.mapping.mapResult(target.from, 1)
    const end = transaction.mapping.mapResult(target.to, -1)
    const deleted = target.deleted || (target.from !== target.to && start.pos >= end.pos)
    target = { from: start.pos, to: Math.max(start.pos, end.pos), deleted }
  }
  editor.on('transaction', onTransaction)
  return { current: () => target, dispose: () => editor.off('transaction', onTransaction) }
}

/** Puts an AI proposal (Markdown) into the document as one undoable step. */
export function applyProposal(
  editor: Editor,
  markdown: string,
  target: TrackedTarget & Pick<CapturedSelection, 'inline' | 'code'>,
  mode: 'insert' | 'replace'
): void {
  const parsed: JSONContent = editor.markdown
    ? editor.markdown.parse(markdown)
    : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }] }
  const blocks = parsed.content ?? []
  const docSize = editor.state.doc.content.size
  const from = Math.min(target.from, docSize)
  const to = Math.min(target.to, docSize)

  if (mode === 'replace' && !target.deleted && target.code) {
    editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text: markdown }).run()
    return
  }
  if (mode === 'replace' && !target.deleted) {
    const single = blocks.length === 1 && blocks[0]?.type === 'paragraph' ? blocks[0] : null
    const content = target.inline && single ? (single.content ?? []) : blocks
    editor.chain().focus().insertContentAt({ from, to }, content).run()
    return
  }
  // Insert after the top-level block that holds the end of the selection (or the cursor).
  const $end = editor.state.doc.resolve(to)
  const after = $end.depth > 0 ? $end.after(1) : to
  editor.chain().focus().insertContentAt(after, blocks).run()
}
