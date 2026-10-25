import type { Editor, JSONContent } from '@tiptap/react'

const BLOCK_SEPARATOR = '\n\n'

interface SourceBlock {
  raw: string
  /** Position among the original's blocks, to tell whether two reused blocks were neighbours. */
  order: number
  start: number
  end: number
}

/**
 * Serializes the editor content, reusing the original source text of every top-level block the user did not change.
 *
 * Tiptap's serializer normalizes Markdown (escapes `[`, rewrites `_x_` as `*x*`, re-pads tables…), so saving its output
 * as-is would rewrite most of a file and bury the real edit in diff noise. A block is reused only when the original
 * source parses to exactly the same content, so the result reads the same as `editor.getMarkdown()`. Between two
 * reused neighbouring blocks the original spacing is kept too (e.g. a list directly under a paragraph).
 */
export function serializePreserving(editor: Editor, original: string): string {
  const manager = editor.markdown
  if (!manager) return editor.getMarkdown()
  const canonical = (content: JSONContent[]): string => manager.serialize({ type: 'doc', content }).trim()

  // Original blocks keyed by how they serialize; identical blocks queue up in document order.
  const sources = new Map<string, SourceBlock[]>()
  let offset = 0
  let order = 0
  for (const token of manager.instance.lexer(original)) {
    const start = offset
    offset += token.raw.length
    if (token.type === 'space') continue
    const raw = token.raw.replace(/\s+$/, '')
    const key = canonical(manager.parse(raw).content ?? [])
    if (!key) continue
    sources.set(key, [...(sources.get(key) ?? []), { raw, order, start, end: start + raw.length }])
    order += 1
  }

  const used = new Map<string, number>()
  let previous: SourceBlock | undefined
  let text = ''
  for (const node of editor.getJSON().content ?? []) {
    const key = canonical([node])
    if (!key) continue
    const index = used.get(key) ?? 0
    used.set(key, index + 1)
    const source = sources.get(key)?.[index]
    if (text) text += source && previous && source.order === previous.order + 1 ? original.slice(previous.end, source.start) : BLOCK_SEPARATOR
    text += source?.raw ?? key
    previous = source
  }
  return `${text}\n`
}
