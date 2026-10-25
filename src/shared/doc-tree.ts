import type { DocSection } from './domain'

/**
 * The explorer's document tree, organised like the classic Library: one folder per section (Test cases, Regression
 * checklists, …), then the feature groups inside it, then documents.
 */

/** The fields of a workspace document the tree needs. */
export interface TreeDoc {
  path: string
  title: string
  section: DocSection
  group: string
}

export interface DocTreeFile {
  kind: 'file'
  /** The document path, unique across the tree. */
  id: string
  path: string
  title: string
}

export interface DocTreeFolder {
  kind: 'folder'
  /** `section:group`, e.g. "test-cases:login/sso"; a section's own folder has an empty group ("test-cases:"). */
  id: string
  section: DocSection
  group: string
  /** The last part of the group, or the section for a section folder. */
  name: string
  /** Documents in this folder and below. */
  count: number
  children: DocTreeNode[]
}

export type DocTreeNode = DocTreeFile | DocTreeFolder

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function folderId(section: DocSection, group: string): string {
  return `${section}:${group}`
}

/** Folder ids from the section down to the group: ("test-cases", "a/b") → ["test-cases:", "test-cases:a", "test-cases:a/b"]. */
export function folderTrail(section: DocSection, group: string): string[] {
  const parts = group ? group.split('/') : []
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))].map((prefix) => folderId(section, prefix))
}

function sortNodes(nodes: DocTreeNode[]): DocTreeNode[] {
  return nodes
    .map((node) => (node.kind === 'folder' ? { ...node, children: sortNodes(node.children) } : node))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return collator.compare(a.kind === 'file' ? a.title : a.name, b.kind === 'file' ? b.title : b.name)
    })
}

/** Sections in `order` (empty ones left out), each holding its feature groups and documents in natural order, folders first. */
export function buildDocTree(docs: readonly TreeDoc[], order: readonly DocSection[]): DocTreeNode[] {
  const folders = new Map<string, DocTreeFolder>()

  const folderFor = (section: DocSection, group: string): DocTreeFolder => {
    const id = folderId(section, group)
    const existing = folders.get(id)
    if (existing) return existing
    const slash = group.lastIndexOf('/')
    const folder: DocTreeFolder = { kind: 'folder', id, section, group, name: group ? group.slice(slash + 1) : section, count: 0, children: [] }
    folders.set(id, folder)
    if (group) folderFor(section, slash === -1 ? '' : group.slice(0, slash)).children.push(folder)
    return folder
  }

  for (const doc of docs) {
    if (!order.includes(doc.section)) continue
    folderFor(doc.section, doc.group).children.push({ kind: 'file', id: doc.path, path: doc.path, title: doc.title })
    for (const id of folderTrail(doc.section, doc.group)) {
      const folder = folders.get(id)
      if (folder) folder.count += 1
    }
  }
  const sections = order.flatMap((section) => folders.get(folderId(section, '')) ?? [])
  return sections.map((section) => ({ ...section, children: sortNodes(section.children) }))
}

/** Keeps files whose title or path contains the query, plus the folders leading to them. */
export function filterDocTree(nodes: readonly DocTreeNode[], query: string): DocTreeNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...nodes]
  return nodes.flatMap((node): DocTreeNode[] => {
    if (node.kind === 'file') {
      return node.title.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle) ? [node] : []
    }
    const children = filterDocTree(node.children, needle)
    return children.length ? [{ ...node, children }] : []
  })
}

/** Adds a tab for the document unless it is already open. */
export function openTab(tabs: readonly string[], path: string): string[] {
  return tabs.includes(path) ? [...tabs] : [...tabs, path]
}

/**
 * Closes a tab. When it was the active one, `next` is the tab to show instead (the one to its right, else its left),
 * or null when no tabs remain. Closing an inactive tab keeps the active one (`next` is undefined).
 */
export function closeTab(tabs: readonly string[], path: string, active: string | null): { tabs: string[]; next?: string | null } {
  const index = tabs.indexOf(path)
  if (index === -1) return { tabs: [...tabs] }
  const remaining = tabs.filter((tab) => tab !== path)
  if (path !== active) return { tabs: remaining }
  return { tabs: remaining, next: remaining[Math.min(index, remaining.length - 1)] ?? null }
}

/** Pins or unpins a tab. Pinned tabs sit first: pinning moves the tab to the end of that group, unpinning to the start of the rest. */
export function togglePin(tabs: readonly string[], pinned: readonly string[], path: string): { tabs: string[]; pinned: string[] } {
  const nextPinned = pinned.includes(path) ? pinned.filter((tab) => tab !== path) : [...pinned, path]
  const others = tabs.filter((tab) => tab !== path)
  const at = others.filter((tab) => nextPinned.includes(tab)).length
  return { tabs: [...others.slice(0, at), path, ...others.slice(at)], pinned: nextPinned }
}

export type TabCloseScope = 'others' | 'right' | 'all'

/** The tabs a bulk close removes, relative to the right-clicked tab. Pinned tabs stay open. */
export function tabsToClose(tabs: readonly string[], pinned: ReadonlySet<string>, path: string, scope: TabCloseScope): string[] {
  const index = tabs.indexOf(path)
  const candidates = scope === 'all' ? tabs : scope === 'others' ? tabs.filter((tab) => tab !== path) : index === -1 ? [] : tabs.slice(index + 1)
  return candidates.filter((tab) => !pinned.has(tab))
}

/**
 * Closes several tabs. When the active one is among them, `next` is the right-clicked tab if it stays open, else the
 * last remaining tab, or null when none remain. Otherwise the active tab is kept (`next` is undefined).
 */
export function closeTabs(
  tabs: readonly string[],
  closing: readonly string[],
  active: string | null,
  anchor: string
): { tabs: string[]; next?: string | null } {
  const remaining = tabs.filter((tab) => !closing.includes(tab))
  if (active === null || !closing.includes(active)) return { tabs: remaining }
  return { tabs: remaining, next: remaining.includes(anchor) ? anchor : (remaining.at(-1) ?? null) }
}

/** Adds closed tabs to the reopen history, newest last, keeping at most `limit` entries. */
export function rememberClosed(history: readonly string[], closed: readonly string[], limit: number): string[] {
  return [...history.filter((tab) => !closed.includes(tab)), ...closed].slice(-limit)
}
