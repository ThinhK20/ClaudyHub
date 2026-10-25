import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 10_000

export interface GitInfo {
  isGitRepo: boolean
  branch: string | null
  head: string | null
}

export type GitReader = (folder: string) => Promise<GitInfo>

async function git(folder: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', folder, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true })
  return stdout.trim()
}

/** Reads branch and short HEAD; a folder that is not a git work tree (or no git on PATH) is reported as such. */
export const readGitInfo: GitReader = async (folder) => {
  try {
    const inside = await git(folder, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return { isGitRepo: false, branch: null, head: null }
  } catch {
    return { isGitRepo: false, branch: null, head: null }
  }
  const [branch, head] = await Promise.all([
    git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
    git(folder, ['rev-parse', '--short', 'HEAD']).catch(() => null)
  ])
  return { isGitRepo: true, branch, head }
}
