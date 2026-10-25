import type { TextMenuActions } from '@/components/text-context-menu'

/** Read mode offers the copy actions; editing ones stay disabled. Markdown conversion loads the editor code on first use. */
export function readMenuActions(docPath: string): TextMenuActions {
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
