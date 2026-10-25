import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'

const KEYBOARD_STEP = 16

function readStored(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface WidthOptions {
  /** localStorage key the width is remembered under. */
  key: string
  initial: number
  min: number
  max: number
}

export interface PanelWidth {
  width: number
  min: number
  max: number
  setWidth: (width: number) => void
  reset: () => void
}

/** A panel width the user can drag, remembered per panel. */
export function usePanelWidth({ key, initial, min, max }: WidthOptions): PanelWidth {
  const [width, setStateWidth] = useState(() => clamp(readStored(key) ?? initial, min, max))

  const setWidth = useCallback(
    (next: number) => {
      const value = clamp(Math.round(next), min, max)
      setStateWidth(value)
      try {
        localStorage.setItem(key, String(value))
      } catch {
        // Storage is a convenience; the width still applies for this session.
      }
    },
    [key, min, max]
  )

  return { width, min, max, setWidth, reset: () => setWidth(initial) }
}

interface ResizeHandleProps {
  panel: PanelWidth
  /** Which edge of the panel the handle sits on. A handle on a panel's left edge grows it when dragged left. */
  edge: 'left' | 'right'
  label: string
}

/** Draggable panel edge. Arrow keys resize in small steps and a double-click restores the default width. */
export function ResizeHandle({ panel, edge, label }: ResizeHandleProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const direction = edge === 'right' ? 1 : -1

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel.width
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    setDragging(true)

    const onMove = (move: PointerEvent): void => panel.setWidth(startWidth + (move.clientX - startX) * direction)
    const onUp = (): void => {
      setDragging(false)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={panel.reset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') panel.setWidth(panel.width - KEYBOARD_STEP * direction)
        else if (event.key === 'ArrowRight') panel.setWidth(panel.width + KEYBOARD_STEP * direction)
        else return
        event.preventDefault()
      }}
      className={cn(
        'relative z-10 w-0 shrink-0 cursor-col-resize outline-none',
        // An invisible 8px hit area straddles the panel's 1px border; the accent line shows on hover, focus and drag.
        'before:absolute before:inset-y-0 before:-left-1 before:w-2',
        'after:absolute after:inset-y-0 after:-left-px after:w-0.5 after:transition-colors hover:after:bg-accent/50 focus-visible:after:bg-accent',
        dragging && 'after:bg-accent'
      )}
    />
  )
}
