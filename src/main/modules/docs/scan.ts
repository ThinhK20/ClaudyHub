import { readdir } from 'node:fs/promises'
import path from 'node:path'

// Same exclusions as qa-portal: tooling folders and attachments are not documentation.
export const SKIP_DIRS = new Set(['node_modules', 'qa-portal', 'attachments', 'scripts'])

/** True for a path segment the indexer should never descend into or index. */
export function isSkippedSegment(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

/** True when a root-relative POSIX path is a Markdown document the index should contain. */
export function isIndexable(relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith('.md')) return false
  return !relativePath.split('/').some(isSkippedSegment)
}

/** Lists every indexable Markdown file under root as absolute paths. */
export async function walkMarkdown(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        if (isSkippedSegment(entry.name)) return
        const full = path.join(folder, entry.name)
        if (entry.isDirectory()) await visit(full)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full)
      })
    )
  }
  await visit(root)
  return found.sort()
}

/** Maps items with at most `limit` promises in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
