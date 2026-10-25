import { useState, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { DropdownMenu, Popover } from 'radix-ui'
import {
  Bold,
  ChevronDown,
  Code,
  FileCode2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Network,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  Undo2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/fields'
import { cn } from '@/lib/utils'

const BLOCK_TYPES = [
  { label: 'Paragraph', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 }
] as const

const MERMAID_TEMPLATE = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Pass]\n  B -->|no| D[Fail]'

type Chain = ReturnType<Editor['chain']>

interface ToolButtonProps {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function ToolButton({ label, shortcut, active, disabled, onClick, children }: ToolButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        'grid size-7 place-items-center rounded text-muted hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
      )}
    >
      {children}
    </button>
  )
}

const Divider = (): React.JSX.Element => <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

const menuItem = 'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[12.5px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-sunken'
const menuContent = 'z-50 min-w-44 rounded-md border border-line bg-surface p-1 shadow-lg'

function BlockTypeMenu({ editor, level }: { editor: Editor; level: number }): React.JSX.Element {
  const current = BLOCK_TYPES.find((item) => item.level === level) ?? BLOCK_TYPES[0]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex h-7 w-32 items-center justify-between rounded px-2 text-[12.5px] text-ink hover:bg-sunken" aria-label="Text style">
        {current.label}
        <ChevronDown className="size-3.5 text-faint" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContent} align="start" sideOffset={4}>
          {BLOCK_TYPES.map((item) => (
            <DropdownMenu.Item
              key={item.level}
              className={cn(menuItem, item.level === level && 'font-medium text-accent')}
              onSelect={() => {
                const chain = editor.chain().focus()
                if (item.level === 0) chain.setParagraph().run()
                else chain.setHeading({ level: item.level }).run()
              }}
            >
              <span className={cn(item.level === 1 && 'text-[16px] font-semibold', item.level === 2 && 'text-[14.5px] font-semibold', item.level >= 3 && 'font-semibold')}>
                {item.label}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')

  const apply = (): void => {
    const value = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (value) chain.setLink({ href: value }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setHref(String(editor.getAttributes('link').href ?? ''))
        setOpen(next)
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Link"
          aria-pressed={active}
          title="Link"
          className={cn('grid size-7 place-items-center rounded text-muted hover:bg-sunken hover:text-ink [&_svg]:size-4', active && 'bg-accent-soft text-accent')}
        >
          <Link2 />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-50 w-80 rounded-md border border-line bg-surface p-2.5 shadow-lg" sideOffset={4} align="start">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              apply()
            }}
          >
            <Input autoFocus value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://… or ../other-doc.md" aria-label="Link address" />
            <Button type="submit" size="sm" variant="primary">
              {href.trim() ? 'Apply' : 'Remove'}
            </Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function TableMenu({ editor, inTable }: { editor: Editor; inTable: boolean }): React.JSX.Element {
  const run = (action: (chain: Chain) => Chain) => () => action(editor.chain().focus()).run()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn('flex h-7 items-center gap-0.5 rounded px-1.5 text-muted hover:bg-sunken hover:text-ink', inTable && 'text-accent')}
        aria-label="Table"
        title="Table"
      >
        <Table className="size-4" />
        <ChevronDown className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContent} align="start" sideOffset={4}>
          <DropdownMenu.Item className={menuItem} onSelect={run((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>
            Insert table
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={menuItem} disabled={!inTable} onSelect={run((chain) => chain.addRowAfter())}>
            Add row below
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} disabled={!inTable} onSelect={run((chain) => chain.addColumnAfter())}>
            Add column right
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} disabled={!inTable} onSelect={run((chain) => chain.deleteRow())}>
            Delete row
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} disabled={!inTable} onSelect={run((chain) => chain.deleteColumn())}>
            Delete column
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={cn(menuItem, 'text-fail')} disabled={!inTable} onSelect={run((chain) => chain.deleteTable())}>
            Delete table
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Formatting toolbar for the document editor. Only offers what Markdown can store, so nothing is lost on save. */
export function EditorToolbar({ editor }: { editor: Editor }): React.JSX.Element {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      level: ([1, 2, 3, 4] as const).find((level) => e.isActive('heading', { level })) ?? 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      inTable: e.isActive('table'),
      canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
      canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo()
    })
  })
  const chain = (): Chain => editor.chain().focus()
  const listItemType = state.taskList ? 'taskItem' : 'listItem'

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-3 py-1.5">
      <BlockTypeMenu editor={editor} level={state.level} />
      <Divider />
      <ToolButton label="Bold" shortcut="Ctrl+B" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" shortcut="Ctrl+I" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Strikethrough" shortcut="Ctrl+Shift+S" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolButton>
      <ToolButton label="Inline code" shortcut="Ctrl+E" active={state.code} onClick={() => chain().toggleCode().run()}>
        <Code />
      </ToolButton>
      <LinkButton editor={editor} active={state.link} />
      <ToolButton label="Clear formatting" onClick={() => chain().unsetAllMarks().run()}>
        <RemoveFormatting />
      </ToolButton>
      <Divider />
      <ToolButton label="Bulleted list" shortcut="Ctrl+Shift+8" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label="Numbered list" shortcut="Ctrl+Shift+7" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Checklist" shortcut="Ctrl+Shift+9" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks />
      </ToolButton>
      <ToolButton label="Decrease indent" shortcut="Shift+Tab" disabled={!state.canLift} onClick={() => chain().liftListItem(listItemType).run()}>
        <IndentDecrease />
      </ToolButton>
      <ToolButton label="Increase indent" shortcut="Tab" disabled={!state.canSink} onClick={() => chain().sinkListItem(listItemType).run()}>
        <IndentIncrease />
      </ToolButton>
      <Divider />
      <ToolButton label="Quote" shortcut="Ctrl+Shift+B" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolButton>
      <ToolButton label="Code block" shortcut="Ctrl+Alt+C" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <FileCode2 />
      </ToolButton>
      <ToolButton
        label="Mermaid diagram"
        onClick={() => chain().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: MERMAID_TEMPLATE }] }).run()}
      >
        <Network />
      </ToolButton>
      <TableMenu editor={editor} inTable={state.inTable} />
      <ToolButton label="Divider line" onClick={() => chain().setHorizontalRule().run()}>
        <Minus />
      </ToolButton>
      <Divider />
      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 />
      </ToolButton>
    </div>
  )
}
