/** Folder/file tree of workspace documents, built from their relative paths for the explorer layout. */

export interface DocTreeFile {
  kind: 'file'
  name: string
  path: string
  title: string
}

export interface DocTreeFolder {
  kind: 'folder'
  name: string
  path: string
  children: DocTreeNode[]
}

export type DocTreeNode = DocTreeFile | DocTreeFolder

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sortNodes(nodes: DocTreeNode[]): DocTreeNode[] {
  return nodes
    .map((node) => (node.kind === 'folder' ? { ...node, children: sortNodes(node.children) } : node))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return collator.compare(a.kind === 'file' ? a.title : a.name, b.kind === 'file' ? b.title : b.name)
    })
}

/** Folders first, then files by title, each level in natural order. */
export function buildDocTree(docs: readonly { path: string; title: string }[]): DocTreeNode[] {
  const root: DocTreeFolder = { kind: 'folder', name: '', path: '', children: [] }
  const folders = new Map<string, DocTreeFolder>([['', root]])

  const folderFor = (path: string): DocTreeFolder => {
    const existing = folders.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parent = folderFor(slash === -1 ? '' : path.slice(0, slash))
    const folder: DocTreeFolder = { kind: 'folder', name: path.slice(slash + 1), path, children: [] }
    parent.children.push(folder)
    folders.set(path, folder)
    return folder
  }

  for (const doc of docs) {
    const slash = doc.path.lastIndexOf('/')
    const name = doc.path.slice(slash + 1)
    folderFor(slash === -1 ? '' : doc.path.slice(0, slash)).children.push({ kind: 'file', name, path: doc.path, title: doc.title })
  }
  return sortNodes(root.children)
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

/** Folder paths that contain a document, outermost first: "a/b/c.md" → ["a", "a/b"]. */
export function ancestorFolders(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
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
