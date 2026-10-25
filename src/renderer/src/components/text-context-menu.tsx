import { useRef, useState, type ReactNode } from 'react'
import { ContextMenu } from 'radix-ui'
import { ClipboardPaste, Copy, FileCode2, Scissors, Search, Type } from 'lucide-react'
import { toast } from 'sonner'
import { call } from '@/lib/ipc'
import { errorText } from '@/lib/utils'

const SEARCH_LABEL_LENGTH = 32

/** What the menu does in one place. A missing action shows its item disabled, so the menu looks the same everywhere. */
export interface TextMenuActions {
  /** The selected text inside `root` (the right-clicked element), read when the menu opens. */
  selectedText: (root: HTMLElement) => string
  copy: () => void
  copyMarkdown: (root: HTMLElement) => string | Promise<string>
  cut?: () => void
  paste?: () => void | Promise<void>
  pastePlain?: () => void | Promise<void>
}

interface TextContextMenuProps {
  actions: TextMenuActions
  /** Extra items shown first (e.g. the editor's AI assistant submenu). */
  aiMenu?: (state: { hasSelection: boolean }) => ReactNode
  /** A single element that receives the right-click. */
  children: ReactNode
}

export const menuItem =
  'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[12.5px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-sunken [&_svg]:size-3.5 [&_svg]:text-muted'
export const menuContent = 'z-50 min-w-56 rounded-md border border-line bg-surface p-1 shadow-lg'
export const menuSeparator = 'my-1 h-px bg-line'
const shortcutClass = 'ml-auto pl-6 text-[11.5px] text-faint'

function quoted(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SEARCH_LABEL_LENGTH ? `${flat.slice(0, SEARCH_LABEL_LENGTH)}…` : flat
}

/** Right-click menu for document text: clipboard actions, Copy as Markdown and a web search for the selection. */
export function TextContextMenu({ actions, aiMenu, children }: TextContextMenuProps): React.JSX.Element {
  const [selected, setSelected] = useState('')
  // Opening the menu can move focus away from the page selection, so it is put back before each action.
  const savedRange = useRef<Range | null>(null)
  const trigger = useRef<HTMLElement | null>(null)

  const run = async (action: () => unknown): Promise<void> => {
    const selection = window.getSelection()
    if (savedRange.current && selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange.current)
    }
    try {
      await action()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const copyMarkdown = async (): Promise<void> => {
    if (!trigger.current) return
    const markdown = await actions.copyMarkdown(trigger.current)
    if (!markdown) return
    await navigator.clipboard.writeText(markdown)
    toast.success('Copied as Markdown')
  }

  const hasSelection = selected.trim().length > 0

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (!open) return
        const selection = window.getSelection()
        savedRange.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
        setSelected(trigger.current ? actions.selectedText(trigger.current) : '')
      }}
    >
      <ContextMenu.Trigger asChild ref={trigger}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={menuContent}
          // Keep focus where the action left it (e.g. in the editor after a paste).
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {aiMenu ? (
            <>
              {aiMenu({ hasSelection })}
              <ContextMenu.Separator className={menuSeparator} />
            </>
          ) : null}
          <ContextMenu.Item className={menuItem} disabled={!actions.cut || !hasSelection} onSelect={() => void run(() => actions.cut?.())}>
            <Scissors /> Cut <span className={shortcutClass}>Ctrl+X</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} disabled={!hasSelection} onSelect={() => void run(actions.copy)}>
            <Copy /> Copy <span className={shortcutClass}>Ctrl+C</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} disabled={!hasSelection} onSelect={() => void run(copyMarkdown)}>
            <FileCode2 /> Copy as Markdown
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} disabled={!actions.paste} onSelect={() => void run(() => actions.paste?.())}>
            <ClipboardPaste /> Paste <span className={shortcutClass}>Ctrl+V</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} disabled={!actions.pastePlain} onSelect={() => void run(() => actions.pastePlain?.())}>
            <Type /> Paste as plain text <span className={shortcutClass}>Ctrl+Shift+V</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Item
            className={menuItem}
            disabled={!hasSelection}
            onSelect={() => void run(() => call('shell:openExternal', { url: `https://www.google.com/search?q=${encodeURIComponent(selected.trim())}` }))}
          >
            <Search />
            <span className="max-w-72 truncate">{hasSelection ? `Search for “${quoted(selected)}” with Google` : 'Search with Google'}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
