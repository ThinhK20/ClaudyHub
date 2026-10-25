import { useRef, useState, type RefObject } from 'react'

const VIEWPORT_MARGIN = 8

interface Offset {
  x: number
  y: number
}

interface DragStart {
  pointerId: number
  clientX: number
  clientY: number
  offset: Offset
  /** How far the panel may move each way before it leaves the window. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

type HandleProps = Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

/**
 * Lets a floating panel be dragged by a handle. Returns the offset to add to the panel's own position
 * and the pointer handlers for the handle. The panel always stays inside the window.
 */
export function useDragOffset(panel: RefObject<HTMLElement | null>): { offset: Offset; dragging: boolean; handleProps: HandleProps } {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragStart | null>(null)

  const end = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  return {
    offset,
    dragging,
    handleProps: {
      onPointerDown: (event) => {
        // Controls inside the handle (e.g. Close) keep working as controls.
        if (event.button !== 0 || (event.target as HTMLElement).closest('button, select, input, textarea')) return
        const rect = panel.current?.getBoundingClientRect()
        if (!rect) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          offset,
          bounds: {
            minX: VIEWPORT_MARGIN - rect.left,
            maxX: window.innerWidth - VIEWPORT_MARGIN - rect.right,
            minY: VIEWPORT_MARGIN - rect.top,
            maxY: window.innerHeight - VIEWPORT_MARGIN - rect.bottom
          }
        }
        setDragging(true)
      },
      onPointerMove: (event) => {
        const start = drag.current
        if (!start || start.pointerId !== event.pointerId) return
        const { bounds } = start
        setOffset({
          x: start.offset.x + clamp(event.clientX - start.clientX, bounds.minX, bounds.maxX),
          y: start.offset.y + clamp(event.clientY - start.clientY, bounds.minY, bounds.maxY)
        })
      },
      onPointerUp: end,
      onPointerCancel: end
    }
  }
}
