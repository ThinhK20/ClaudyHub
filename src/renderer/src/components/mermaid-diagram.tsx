import { useEffect, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Spinner } from './ui/misc'

const ZOOM_STEP = 0.25
const MAX_ZOOM = 4

let initializedTheme: string | null = null
let renderCount = 0
// Mermaid's render() is not safe to run concurrently (renders share temporary DOM nodes), so queue them.
let queue: Promise<unknown> = Promise.resolve()

function renderSvg(code: string): Promise<string> {
  const task = queue.then(async () => {
    const mermaid = (await import('mermaid')).default
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'neutral'
    if (initializedTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
      initializedTheme = theme
    }
    renderCount += 1
    const { svg } = await mermaid.render(`qa-hub-mermaid-${renderCount}`, code)
    return svg
  })
  queue = task.catch(() => undefined)
  return task
}

/** Renders Mermaid source to SVG. Mermaid is loaded on first use and runs with securityLevel "strict". */
export function MermaidDiagram({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    renderSvg(code)
      .then((result) => {
        if (!cancelled) setSvg(result)
      })
      .catch((error: unknown) => {
        console.error('[mermaid] render failed', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 text-[12px]" title="Diagram could not be rendered">
        <code>{code}</code>
      </pre>
    )
  }
  if (!svg) return <Spinner />
  // Mermaid output is sanitized by securityLevel "strict".
  return (
    <div className="group relative">
      <div className="flex justify-center overflow-x-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <Button
        variant="secondary"
        size="icon"
        className="absolute right-0 top-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => setExpanded(true)}
        aria-label="Open diagram in a larger view"
        title="Open in a larger view"
      >
        <Maximize2 />
      </Button>
      {expanded ? <ExpandedDiagram svg={svg} onClose={() => setExpanded(false)} /> : null}
    </div>
  )
}

/** Near full-screen view of a rendered diagram. Zoom 1 fits the whole diagram in the window; larger zooms scroll. */
function ExpandedDiagram({ svg, onClose }: { svg: string; onClose: () => void }): React.JSX.Element {
  const [zoom, setZoom] = useState(1)
  const size = `${zoom * 100}%`

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Diagram"
      className="top-[3vh] h-[94vh] max-h-[94vh] w-[calc(100vw-48px)]"
      footer={
        <>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.max(1, z - ZOOM_STEP))} disabled={zoom <= 1} aria-label="Zoom out">
            <Minus />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)} className="w-20 tabular-nums" title="Fit to window">
            {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            <Plus />
          </Button>
        </>
      }
    >
      <div className="h-full overflow-auto">
        <div
          style={{ width: size, height: size }}
          className="[&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-none!"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </Dialog>
  )
}
