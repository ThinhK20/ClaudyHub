import { useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { useNavigate } from '@tanstack/react-router'
import { ChevronsLeftRight, Download, Ellipsis, Printer, TextSearch, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Doc } from '@shared/domain'
import { menuContent, menuItem, menuSeparator } from '@/components/text-context-menu'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/misc'
import { call } from '@/lib/ipc'
import { cn, errorText } from '@/lib/utils'
import { printElement } from './print-doc'

const dangerItem = 'text-fail data-[highlighted]:bg-fail-soft [&_svg]:text-fail'

interface ConfirmDeleteProps {
  doc: Doc
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs before navigating away, e.g. to leave edit mode without the unsaved-changes prompt. */
  onDeleted: () => void
}

function ConfirmDelete({ doc, open, onOpenChange, onDeleted }: ConfirmDeleteProps): React.JSX.Element {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)

  const remove = async (): Promise<void> => {
    setDeleting(true)
    try {
      await call('docs:delete', { path: doc.path })
      toast.success(`Moved "${doc.title}" to the recycle bin`)
      onOpenChange(false)
      onDeleted()
      await navigate({
        to: '/library',
        search: { section: doc.section, group: doc.group || undefined }
      })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next)
      }}
      title="Delete this note?"
      description={doc.path}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove()} disabled={deleting}>
            {deleting ? <Spinner className="size-3.5" /> : <Trash2 />} Delete note
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted">
        <span className="font-medium text-ink">{doc.title}</span> moves to the recycle bin, so you can restore it from there.
      </p>
    </Dialog>
  )
}

/** Switch look for a checkbox menu item; the item itself carries the checked state for assistive tech. */
function Switch({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span aria-hidden className={cn('ml-auto flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
      <span className={cn('size-3 rounded-full bg-surface shadow-sm transition-transform', checked && 'translate-x-3')} />
    </span>
  )
}

interface DocActionsMenuProps {
  doc: Doc
  /** The rendered note, printed by "Print / Export to PDF". */
  getContent: () => HTMLElement | null
  fullWidth: boolean
  onFullWidthChange: (fullWidth: boolean) => void
  onSearch: () => void
  onDeleted: () => void
}

/** The "…" menu next to Edit: search, download, print and delete the open note. */
export function DocActionsMenu({ doc, getContent, fullWidth, onFullWidthChange, onSearch, onDeleted }: DocActionsMenuProps): React.JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const download = async (): Promise<void> => {
    try {
      const saved = await call('docs:download', { path: doc.path })
      if (saved) toast.success(`Saved to ${saved}`)
    } catch (error) {
      toast.error(errorText(error))
    }
  }
  const print = (): void => {
    const content = getContent()
    if (!content) return
    try {
      printElement(content, doc.title)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="icon" variant="ghost" aria-label="More actions" title="More actions">
            <Ellipsis />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          {/* Focus stays where the chosen action puts it (e.g. the search box), not back on the "…" button. */}
          <DropdownMenu.Content align="end" sideOffset={4} className={menuContent} onCloseAutoFocus={(event) => event.preventDefault()}>
            {/* Keeps the menu open so the switch is seen flipping. */}
            <DropdownMenu.CheckboxItem
              className={menuItem}
              checked={fullWidth}
              onCheckedChange={onFullWidthChange}
              onSelect={(event) => event.preventDefault()}
            >
              <ChevronsLeftRight /> Full width
              <Switch checked={fullWidth} />
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Separator className={menuSeparator} />
            <DropdownMenu.Item className={menuItem} onSelect={onSearch}>
              <TextSearch /> Search in note
              <span className="ml-auto pl-6 text-[11.5px] text-faint">Ctrl+F</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} onSelect={() => void download()}>
              <Download /> Download
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} onSelect={print}>
              <Printer /> Print / Export to PDF
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparator} />
            <DropdownMenu.Item className={cn(menuItem, dangerItem)} onSelect={() => setConfirmDelete(true)}>
              <Trash2 /> Delete note
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConfirmDelete doc={doc} open={confirmDelete} onOpenChange={setConfirmDelete} onDeleted={onDeleted} />
    </>
  )
}
