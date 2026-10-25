import { ContextMenu } from 'radix-ui'
import { ChevronRight, Cpu, MessageSquareText, Sparkles } from 'lucide-react'
import type { ProviderId } from '@shared/domain'
import { menuContent, menuItem, menuSeparator } from '@/components/text-context-menu'
import { AI_SHORTCUTS, AI_SHORTCUT_GROUPS, ASK_AI, shortcutRequest, type AiRequest } from './shortcuts'
import type { AiEngine } from './use-ai-engine'

interface AiMenuProps {
  engine: AiEngine
  hasSelection: boolean
  onRequest: (request: AiRequest) => void
}

const subTrigger = `${menuItem} data-[state=open]:bg-sunken`

/** The "AI assistant" submenu of the editor's right-click menu. Shortcuts need a selection; Ask AI… always works. */
export function AiMenu({ engine, hasSelection, onRequest }: AiMenuProps): React.JSX.Element {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={subTrigger}>
        <Sparkles /> AI assistant <ChevronRight className="ml-auto" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className={menuContent} sideOffset={4}>
          <ContextMenu.Item className={menuItem} onSelect={() => onRequest(ASK_AI)}>
            <MessageSquareText /> Ask AI…
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparator} />
          {AI_SHORTCUTS.map((shortcut) => (
            <ContextMenu.Item key={shortcut.id} className={menuItem} disabled={!hasSelection} onSelect={() => onRequest(shortcutRequest(shortcut))}>
              {shortcut.label}
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className={menuSeparator} />
          {AI_SHORTCUT_GROUPS.map((group) => (
            <ContextMenu.Sub key={group.label}>
              <ContextMenu.SubTrigger className={subTrigger} disabled={!hasSelection}>
                {group.label} <ChevronRight className="ml-auto" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={menuContent} sideOffset={4}>
                  {group.items.map((shortcut) => (
                    <ContextMenu.Item key={shortcut.id} className={menuItem} onSelect={() => onRequest(shortcutRequest(shortcut))}>
                      {shortcut.label}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          ))}
          <ContextMenu.Separator className={menuSeparator} />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={subTrigger}>
              <Cpu /> <span className="max-w-48 truncate">Engine: {engine.label(engine.provider)}</span> <ChevronRight className="ml-auto" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menuContent} sideOffset={4}>
                <ContextMenu.RadioGroup value={engine.provider} onValueChange={(value) => engine.setProvider(value as ProviderId)}>
                  {(['claude', 'copilot'] as const).map((id) => {
                    const status = engine.providers.find((item) => item.id === id)
                    return (
                      <ContextMenu.RadioItem
                        key={id}
                        value={id}
                        className={`${menuItem} data-[state=checked]:font-medium data-[state=checked]:text-accent`}
                        disabled={status ? !status.ok : false}
                      >
                        {engine.label(id)}
                        {status && !status.ok ? <span className="ml-auto pl-4 text-[11px] text-faint">{status.detail}</span> : null}
                      </ContextMenu.RadioItem>
                    )
                  })}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  )
}
