/** A list of strings kept in web storage. Storage is a convenience: failures fall back to an empty list or are ignored. */
export function readList(storage: Storage, key: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function writeList(storage: Storage, key: string, list: readonly string[]): void {
  try {
    storage.setItem(key, JSON.stringify(list))
  } catch {
    // Storage is a convenience; the state still applies for this session.
  }
}
