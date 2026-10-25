import { stat } from 'node:fs/promises'
import path from 'node:path'
import { UserError } from '../errors'

/** True when target is root itself or lies underneath it (case-insensitive on Windows via path.relative). */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Resolves a root-relative path and refuses anything that escapes the root. */
export function resolveInside(root: string, relativePath: string): string {
  const full = path.resolve(root, relativePath)
  if (!isInside(root, full)) throw new UserError('Path is outside the allowed folder')
  return full
}

/** Normalizes a folder chosen by the user and confirms it is an existing directory. */
export async function assertDirectory(folder: string): Promise<string> {
  const resolved = path.resolve(folder.trim())
  const info = await stat(resolved).catch(() => null)
  if (!info?.isDirectory()) throw new UserError(`Folder not found: ${resolved}`)
  return resolved
}

/** POSIX-style repository-relative path, as stored in the index and shown in the UI. */
export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}
