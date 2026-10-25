import { describe, expect, it } from 'vitest'
import {
  buildDocTree,
  closeTab,
  closeTabs,
  filterDocTree,
  folderTrail,
  openTab,
  rememberClosed,
  tabsToClose,
  togglePin,
  type DocTreeFolder,
  type DocTreeNode,
  type TreeDoc
} from '../../src/shared/doc-tree'

const docs = [
  { path: 'qa/test-cases/login/b.md', title: 'Beta', section: 'test-cases', group: 'login' },
  { path: 'README.md', title: 'Readme', section: 'guides', group: '' },
  { path: 'qa/test-cases/login/a.md', title: 'Alpha', section: 'test-cases', group: 'login' },
  { path: 'qa/test-cases/login/sso/c.md', title: 'Gamma', section: 'test-cases', group: 'login/sso' },
  { path: 'qa/regression-assets/forms/f.md', title: 'Forms', section: 'assets', group: 'forms' },
  { path: 'qa/test-cases/step 10/x.md', title: 'Ten', section: 'test-cases', group: 'step 10' },
  { path: 'qa/test-cases/step 2/x.md', title: 'Two', section: 'test-cases', group: 'step 2' }
] satisfies TreeDoc[]

function folder(node: DocTreeNode | undefined): DocTreeFolder {
  if (node?.kind !== 'folder') throw new Error('expected folder')
  return node
}

describe('buildDocTree', () => {
  it('groups documents by section in library order, then by feature group, folders first in natural order', () => {
    const tree = buildDocTree(docs, ['test-cases', 'assets', 'guides'])
    expect(tree.map((node) => node.id)).toEqual(['test-cases:', 'assets:', 'guides:'])
    const cases = folder(tree[0])
    expect(cases.count).toBe(5)
    expect(cases.children.map((node) => node.id)).toEqual(['test-cases:login', 'test-cases:step 2', 'test-cases:step 10'])
    const login = folder(cases.children[0])
    expect(login).toMatchObject({ section: 'test-cases', group: 'login', name: 'login', count: 3 })
    expect(login.children.map((node) => (node.kind === 'file' ? node.title : node.id))).toEqual(['test-cases:login/sso', 'Alpha', 'Beta'])
    expect(folder(login.children[0]).name).toBe('sso')
  })

  it('puts documents without a group directly under their section and leaves out empty sections', () => {
    const tree = buildDocTree(docs, ['releases', 'guides'])
    expect(tree.map((node) => node.id)).toEqual(['guides:'])
    expect(folder(tree[0]).children.map((node) => node.id)).toEqual(['README.md'])
  })

  it('returns an empty tree for no documents', () => {
    expect(buildDocTree([], ['test-cases'])).toEqual([])
  })
})

describe('filterDocTree', () => {
  const tree = buildDocTree(docs, ['test-cases', 'assets', 'guides'])

  it('keeps matching files by title or path along with their folders', () => {
    const filtered = filterDocTree(tree, 'alpha')
    expect(JSON.stringify(filtered)).toContain('Alpha')
    expect(JSON.stringify(filtered)).not.toContain('Beta')
    expect(JSON.stringify(filtered)).not.toContain('Readme')
    expect(filterDocTree(tree, 'README').map((node) => node.id)).toEqual(['guides:'])
  })

  it('returns everything for a blank query and nothing when no file matches', () => {
    expect(filterDocTree(tree, '  ')).toEqual(tree)
    expect(filterDocTree(tree, 'zzz')).toEqual([])
  })
})

describe('folderTrail', () => {
  it('lists the folder ids from the section down to the group', () => {
    expect(folderTrail('test-cases', 'login/sso')).toEqual(['test-cases:', 'test-cases:login', 'test-cases:login/sso'])
    expect(folderTrail('guides', '')).toEqual(['guides:'])
  })
})

describe('document tabs', () => {
  it('opens a tab once', () => {
    expect(openTab(['a'], 'b')).toEqual(['a', 'b'])
    expect(openTab(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('moves to the right neighbour when the active tab closes, else the left, else none', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ tabs: ['a', 'c'], next: 'c' })
    expect(closeTab(['a', 'b', 'c'], 'c', 'c')).toEqual({ tabs: ['a', 'b'], next: 'b' })
    expect(closeTab(['a'], 'a', 'a')).toEqual({ tabs: [], next: null })
  })

  it('keeps the active tab when closing another one or an unknown path', () => {
    expect(closeTab(['a', 'b'], 'a', 'b')).toEqual({ tabs: ['b'] })
    expect(closeTab(['a'], 'x', 'a')).toEqual({ tabs: ['a'] })
  })

  it('pins a tab to the end of the pinned group and unpins it to the start of the rest', () => {
    expect(togglePin(['a', 'b', 'c'], [], 'c')).toEqual({ tabs: ['c', 'a', 'b'], pinned: ['c'] })
    expect(togglePin(['c', 'a', 'b'], ['c'], 'b')).toEqual({ tabs: ['c', 'b', 'a'], pinned: ['c', 'b'] })
    expect(togglePin(['c', 'b', 'a'], ['c', 'b'], 'c')).toEqual({ tabs: ['b', 'c', 'a'], pinned: ['b'] })
  })

  it('leaves pinned tabs open when closing others, to the right or all', () => {
    const tabs = ['p', 'a', 'b', 'c']
    const pinned = new Set(['p'])
    expect(tabsToClose(tabs, pinned, 'b', 'others')).toEqual(['a', 'c'])
    expect(tabsToClose(tabs, pinned, 'a', 'right')).toEqual(['b', 'c'])
    expect(tabsToClose(tabs, pinned, 'c', 'right')).toEqual([])
    expect(tabsToClose(tabs, pinned, 'a', 'all')).toEqual(['a', 'b', 'c'])
    expect(tabsToClose(tabs, pinned, 'x', 'right')).toEqual([])
  })

  it('shows the right-clicked tab, else the last remaining one, when bulk closing the active tab', () => {
    expect(closeTabs(['a', 'b', 'c'], ['b', 'c'], 'c', 'a')).toEqual({ tabs: ['a'], next: 'a' })
    expect(closeTabs(['p', 'a', 'b'], ['a', 'b'], 'b', 'a')).toEqual({ tabs: ['p'], next: 'p' })
    expect(closeTabs(['a', 'b'], ['a', 'b'], 'a', 'a')).toEqual({ tabs: [], next: null })
    expect(closeTabs(['a', 'b', 'c'], ['c'], 'a', 'b')).toEqual({ tabs: ['a', 'b'] })
  })

  it('remembers recently closed tabs, newest last and without duplicates', () => {
    expect(rememberClosed(['a', 'b'], ['a', 'c'], 3)).toEqual(['b', 'a', 'c'])
    expect(rememberClosed(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
  })
})
