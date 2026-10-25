import type { AiEvent } from '@shared/ipc'
import { UserError } from '../../errors'
import type { ResolvedCodebase } from '../codebases/codebase-service'
import type { AiProvider, AiResult } from './provider'

/** Tracks in-flight AI jobs by renderer-chosen id so any of them can be cancelled. */
export interface JobRegistry {
  start(jobId: string): AbortController
  cancel(jobId: string): boolean
  finish(jobId: string): void
  cancelAll(): void
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, AbortController>()
  return {
    start(jobId) {
      if (jobs.has(jobId)) throw new UserError('This AI request is already running')
      const controller = new AbortController()
      jobs.set(jobId, controller)
      return controller
    },
    cancel(jobId) {
      const controller = jobs.get(jobId)
      if (!controller) return false
      controller.abort()
      return true
    },
    finish(jobId) {
      jobs.delete(jobId)
    },
    cancelAll() {
      for (const controller of jobs.values()) controller.abort()
      jobs.clear()
    }
  }
}

/** Runs a provider as a registered job, forwarding its progress to the renderer as ai:event messages. */
export async function executeJob(options: {
  jobs: JobRegistry
  jobId: string
  provider: AiProvider
  instruction: string
  prompt: string
  codebase: ResolvedCodebase | null
  output: 'text' | 'json'
  emit: (event: AiEvent) => void
}): Promise<AiResult> {
  const { jobs, jobId, emit } = options
  const controller = jobs.start(jobId)
  try {
    const result = await options.provider.run({
      instruction: options.instruction,
      prompt: options.prompt,
      codebase: options.codebase,
      output: options.output,
      signal: controller.signal,
      onEvent: (event) => emit({ jobId, ...event })
    })
    emit({ jobId, kind: 'done', usage: result.usage })
    return result
  } finally {
    jobs.finish(jobId)
  }
}
