import { Editor } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { docExtensions } from './editor-extensions'

/** The editor's current selection (or the given range) as Markdown, keeping the lists, tables or quotes it sits in. */
export function editorSelectionMarkdown(editor: Editor, range?: { from: number; to: number }): string {
  const { selection, schema, doc } = editor.state
  const from = range?.from ?? selection.from
  const to = range?.to ?? selection.to
  if (from === to) return ''
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  // Text inside one code block is code, not Markdown to escape.
  if (!editor.markdown || ($from.sameParent($to) && $from.parent.type.spec.code)) return doc.textBetween(from, to, '\n\n')

  let content = range ? doc.slice(from, to).content : selection.content().content
  let depth = $from.sharedDepth($to.pos)
  // A selection within one textblock serializes as a paragraph (no heading marker for part of a heading).
  if (content.firstChild?.isInline) {
    content = Fragment.from(schema.node('paragraph', null, content))
    depth -= 1
  }
  // Rows or list items alone are not a valid document: wrap them back in their table or list.
  while (depth > 0 && !schema.topNodeType.validContent(content)) {
    content = Fragment.from($from.node(depth).copy(content))
    depth -= 1
  }
  return editor.markdown.serialize({ type: 'doc', content: content.toJSON() ?? [] }).trim()
}

const WRAPPING_TAGS = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'BLOCKQUOTE'])

/** Turns read-mode HTML back into what the editor schema parses: checklists, original image paths, Mermaid sources. */
function toEditorHtml(container: HTMLElement): void {
  for (const list of container.querySelectorAll('ul.contains-task-list')) list.setAttribute('data-type', 'taskList')
  for (const item of container.querySelectorAll('li.task-list-item')) {
    const box = item.querySelector(':scope > input[type="checkbox"]')
    item.setAttribute('data-type', 'taskItem')
    item.setAttribute('data-checked', String(box instanceof HTMLInputElement && box.checked))
    box?.remove()
  }
  for (const image of container.querySelectorAll('img[data-src]')) image.setAttribute('src', image.getAttribute('data-src') ?? '')
  for (const diagram of container.querySelectorAll('[data-mermaid]')) {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.className = 'language-mermaid'
    code.textContent = diagram.getAttribute('data-mermaid')
    pre.append(code)
    diagram.replaceWith(pre)
  }
}

/** The page selection inside `root` (rendered Markdown) as Markdown, or '' when nothing in it is selected. */
export function domSelectionMarkdown(root: HTMLElement, docPath: string): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return ''

  // cloneContents drops the common ancestor, so list items or rows would lose their list or table: put those back.
  // A selection inside a Mermaid diagram keeps its wrapper too, which then stands for the diagram's whole source.
  let content: Node = range.cloneContents()
  const ancestor = range.commonAncestorContainer
  for (let node = ancestor instanceof Element ? ancestor : ancestor.parentElement; node && node !== root; node = node.parentElement) {
    if (!WRAPPING_TAGS.has(node.tagName) && !node.hasAttribute('data-mermaid')) continue
    const wrapper = node.cloneNode(false)
    wrapper.appendChild(content)
    content = wrapper
  }
  const container = document.createElement('div')
  container.appendChild(content)
  toEditorHtml(container)

  const editor = new Editor({ extensions: docExtensions(docPath), content: container.innerHTML })
  try {
    return editor.getMarkdown().trim()
  } finally {
    editor.destroy()
  }
}
