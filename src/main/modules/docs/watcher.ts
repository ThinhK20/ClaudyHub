import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { toPosix } from '../fs-paths'
import { isIndexable, isSkippedSegment } from './scan'

const BATCH_DELAY_MS = 300

/**
 * Watches a workspace for Markdown changes and hands batches of changed root-relative paths to onBatch.
 * Returns a stop function.
 */
export function watchWorkspace(root: string, onBatch: (paths: string[]) => Promise<void>): () => Promise<void> {
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null

  const flush = (): void => {
    timer = null
    const batch = [...pending]
    pending.clear()
    onBatch(batch).catch((error: unknown) => console.error('[docs] incremental index failed', error))
  }

  const queue = (full: string): void => {
    const relative = toPosix(path.relative(root, full))
    if (!isIndexable(relative)) return
    pending.add(relative)
    if (!timer) timer = setTimeout(flush, BATCH_DELAY_MS)
  }

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    ignored: (full: string) => path.relative(root, full).split(path.sep).some((part) => part && isSkippedSegment(part)),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  watcher.on('add', queue).on('change', queue).on('unlink', queue)
  watcher.on('error', (error) => console.error('[docs] watcher error', error))

  return async () => {
    if (timer) clearTimeout(timer)
    await watcher.close()
  }
}
