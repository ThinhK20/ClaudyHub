import { spawn } from 'node:child_process'
import { UserError } from '../../errors'

const MAX_STDOUT_BYTES = 4 * 1024 * 1024

export interface RunProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  onStdout?: (text: string) => void
  failure: string
}

/** Async child process (never blocks the main process). Resolves with trimmed stdout, capped at 4 MB. */
export function runProcess(command: string, args: readonly string[], options: RunProcessOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new UserError('Cancelled'))
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let reason: 'timeout' | 'cancelled' | 'overflow' | null = null
    const stop = (why: NonNullable<typeof reason>): void => {
      reason = why
      child.kill()
    }
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs)
    const onAbort = (): void => stop('cancelled')
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_STDOUT_BYTES) return stop('overflow')
      stdout.push(chunk)
      options.onStdout?.(chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (reason === 'cancelled') return reject(new UserError('Cancelled'))
      if (reason === 'timeout') return reject(new UserError(`${options.failure}: timed out`))
      if (reason === 'overflow') return reject(new UserError(`${options.failure}: output too large`))
      if (code !== 0) return reject(new UserError(Buffer.concat(stderr).toString('utf8').trim() || options.failure))
      resolve(Buffer.concat(stdout).toString('utf8').trim())
    })
  })
}
