import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()

export const nowIso = (): string => new Date().toISOString()

/** Parses JSON stored by this app, falling back when the value is missing or corrupt. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Reads a nullable TEXT column from a node:sqlite row. */
export function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
