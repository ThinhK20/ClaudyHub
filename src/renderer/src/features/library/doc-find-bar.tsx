import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MATCH_HIGHLIGHT = 'doc-find'
const CURRENT_HIGHLIGHT = 'doc-find-current'
const MAX_MATCHES = 1000

/** Case-insensitive matches of `query` inside the text of `root`. A match never spans two text nodes. */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at !== -1 && ranges.length < MAX_MATCHES; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

function clearHighlights(): void {
  CSS.highlights.delete(MATCH_HIGHLIGHT)
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

function showMatches(ranges: Range[], current: number): void {
  clearHighlights()
  if (!ranges.length) return
  CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges))
  const active = ranges[current]
  if (!active) return
  CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(active))
  active.startContainer.parentElement?.scrollIntoView({ block: 'center' })
}

interface DocFindBarProps {
  /** The element whose text is searched (the document being read or edited). */
  getRoot: () => HTMLElement | null
  onClose: () => void
}

/** Find in the open note: highlights every match, Enter / Shift+Enter step through them, Escape closes. */
export function DocFindBar({ getRoot, onClose }: DocFindBarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.select()
    return clearHighlights
  }, [])
  useLayoutEffect(() => showMatches(ranges, current), [ranges, current])

  const search = (value: string): void => {
    setQuery(value)
    const root = getRoot()
    setRanges(root ? findRanges(root, value) : [])
    setCurrent(0)
  }
  const step = (by: number): void => {
    if (!ranges.length) return
    setCurrent((index) => (index + by + ranges.length) % ranges.length)
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-surface px-6 py-1.5" role="search">
      <Search className="size-3.5 shrink-0 text-faint" />
      <input
        ref={input}
        value={query}
        onChange={(event) => search(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1)
          else if (event.key === 'Escape') onClose()
          else return
          event.preventDefault()
        }}
        placeholder="Search in note"
        aria-label="Search in note"
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      <span className="shrink-0 text-[12px] tabular-nums text-muted" aria-live="polite">
        {query ? (ranges.length ? `${current + 1} of ${ranges.length}` : 'No results') : null}
      </span>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => step(-1)}
        disabled={!ranges.length}
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
      >
        <ChevronUp />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => step(1)} disabled={!ranges.length} aria-label="Next match" title="Next (Enter)">
        <ChevronDown />
      </Button>
      <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close search" title="Close (Esc)">
        <X />
      </Button>
    </div>
  )
}
