import type { Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Image } from '@tiptap/extension-image'
import { resolveRelative } from '@/components/markdown'

/** Images keep their Markdown path in the document but load through the workspace protocol while editing. */
function workspaceImage(docPath: string): typeof Image {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      const src = String(HTMLAttributes.src ?? '')
      const shown = src && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? `qa-workspace://file/${encodeURIComponent(resolveRelative(docPath, src))}` : src
      return ['img', { ...HTMLAttributes, src: shown }]
    }
  })
}

/** Everything a document can contain, shared by the editor and by Markdown conversion of read-mode selections. */
export function docExtensions(docPath: string): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true }, underline: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    workspaceImage(docPath),
    Markdown.configure({ markedOptions: { gfm: true } })
  ]
}
