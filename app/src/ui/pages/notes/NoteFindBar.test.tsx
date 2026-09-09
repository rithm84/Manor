// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { findMatches } from './NoteFindBar'

function editorWith(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe('findMatches', () => {
  it('finds every case-insensitive occurrence across blocks', () => {
    const root = editorWith('<p>Dijkstra relaxes edges.</p><p>Then dijkstra repeats, and DIJKSTRA halts.</p>')
    const ranges = findMatches(root, 'dijkstra')
    expect(ranges).toHaveLength(3)
    expect(ranges.map((range) => range.toString())).toEqual(['Dijkstra', 'dijkstra', 'DIJKSTRA'])
  })

  it('finds repeated occurrences inside one text node', () => {
    const root = editorWith('<p>aba aba aba</p>')
    expect(findMatches(root, 'aba')).toHaveLength(3)
  })

  it('returns nothing for text that is not there', () => {
    const root = editorWith('<p>Sliding window notes</p>')
    expect(findMatches(root, 'heap')).toHaveLength(0)
  })
})
