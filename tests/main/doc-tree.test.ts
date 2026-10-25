import { describe, expect, it } from 'vitest'
import { ancestorFolders, buildDocTree, closeTab, filterDocTree, openTab } from '../../src/shared/doc-tree'

const docs = [
  { path: 'qa/test-cases/login/b.md', title: 'Beta' },
  { path: 'README.md', title: 'Readme' },
  { path: 'qa/test-cases/login/a.md', title: 'Alpha' },
  { path: 'qa/guide.md', title: 'Guide' },
  { path: 'qa/test-cases/step 10/x.md', title: 'Ten' },
  { path: 'qa/test-cases/step 2/x.md', title: 'Two' }
]

describe('buildDocTree', () => {
  it('nests documents under their folders, folders first and in natural order', () => {
    const tree = buildDocTree(docs)
    expect(tree.map((node) => node.name)).toEqual(['qa', 'README.md'])
    const qa = tree[0]
    if (qa?.kind !== 'folder') throw new Error('expected folder')
    expect(qa.children.map((node) => node.name)).toEqual(['test-cases', 'guide.md'])
    const cases = qa.children[0]
    if (cases?.kind !== 'folder') throw new Error('expected folder')
    expect(cases.children.map((node) => node.path)).toEqual(['qa/test-cases/login', 'qa/test-cases/step 2', 'qa/test-cases/step 10'])
    const login = cases.children[0]
    if (login?.kind !== 'folder') throw new Error('expected folder')
    expect(login.children.map((node) => (node.kind === 'file' ? node.title : node.name))).toEqual(['Alpha', 'Beta'])
  })

  it('returns an empty tree for no documents', () => {
    expect(buildDocTree([])).toEqual([])
  })
})

describe('filterDocTree', () => {
  it('keeps matching files by title or path along with their folders', () => {
    const tree = filterDocTree(buildDocTree(docs), 'alpha')
    expect(JSON.stringify(tree)).toContain('Alpha')
    expect(JSON.stringify(tree)).not.toContain('Beta')
    expect(JSON.stringify(tree)).not.toContain('Readme')
    expect(filterDocTree(buildDocTree(docs), 'README').map((node) => node.name)).toEqual(['README.md'])
  })

  it('returns everything for a blank query and nothing when no file matches', () => {
    const tree = buildDocTree(docs)
    expect(filterDocTree(tree, '  ')).toEqual(tree)
    expect(filterDocTree(tree, 'zzz')).toEqual([])
  })
})

describe('ancestorFolders', () => {
  it('lists the folders containing a path, outermost first', () => {
    expect(ancestorFolders('a/b/c.md')).toEqual(['a', 'a/b'])
    expect(ancestorFolders('c.md')).toEqual([])
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
})
