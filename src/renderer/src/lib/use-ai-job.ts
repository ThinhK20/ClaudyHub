import { useCallback, useRef, useState } from 'react'
import { call, useAppEvent } from './ipc'
import { newJobId } from './utils'

export interface AiJobState {
  running: boolean
  /** Text streamed so far by the agent. */
  streamed: string
  /** Latest progress line, e.g. which file the agent is reading. */
  status: string
}

/**
 * Runs one AI request at a time: hands the caller a fresh job id, collects streamed ai:event output for that id,
 * and can cancel it.
 */
export function useAiJob(): AiJobState & {
  run: <T>(task: (jobId: string) => Promise<T>) => Promise<T>
  cancel: () => void
} {
  const [state, setState] = useState<AiJobState>({ running: false, streamed: '', status: '' })
  const jobRef = useRef<string | null>(null)

  useAppEvent('ai:event', (event) => {
    if (event.jobId !== jobRef.current) return
    if (event.kind === 'delta') setState((current) => ({ ...current, streamed: current.streamed + event.text }))
    if (event.kind === 'status') setState((current) => ({ ...current, status: event.text }))
  })

  const run = useCallback(async <T,>(task: (jobId: string) => Promise<T>): Promise<T> => {
    const jobId = newJobId()
    jobRef.current = jobId
    setState({ running: true, streamed: '', status: '' })
    try {
      return await task(jobId)
    } finally {
      jobRef.current = null
      setState({ running: false, streamed: '', status: '' })
    }
  }, [])

  const cancel = useCallback(() => {
    if (jobRef.current) void call('ai:cancel', { jobId: jobRef.current })
  }, [])

  return { ...state, run, cancel }
}
