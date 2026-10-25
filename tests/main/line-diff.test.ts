import { describe, expect, it } from 'vitest'
import { diffLines } from '../../src/shared/line-diff'

describe('diffLines', () => {
  it('marks unchanged, removed and added lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' }
    ])
  })

  it('treats empty before as all added', () => {
    expect(diffLines('', 'x\ny')).toEqual([
      { kind: 'added', text: 'x' },
      { kind: 'added', text: 'y' }
    ])
  })

  it('normalises CRLF', () => {
    expect(diffLines('a\r\nb', 'a\nb').every((line) => line.kind === 'same')).toBe(true)
  })
})
