import { describe, expect, it } from 'vitest'

import { EMPTY_SELECTION, clickSelection, pruneSelection, selectAll } from './notesSelection'

const order = ['a', 'b', 'c', 'd', 'e']

describe('note list selection', () => {
  it('selects a range from the anchor in either direction and keeps the anchor', () => {
    const first = clickSelection(EMPTY_SELECTION, order, 'd', { range: false, toggle: false })
    const down = clickSelection(first, order, 'b', { range: true, toggle: false })
    expect(down.ids).toEqual(['b', 'c', 'd'])
    expect(down.anchor).toBe('d')
    const up = clickSelection(down, order, 'e', { range: true, toggle: false })
    expect(up.ids).toEqual(['d', 'e'])
  })

  it('toggles single rows without resetting the rest and moves the anchor', () => {
    const start = clickSelection(EMPTY_SELECTION, order, 'a', { range: false, toggle: false })
    const added = clickSelection(start, order, 'c', { range: false, toggle: true })
    expect(added.ids).toEqual(['a', 'c'])
    expect(clickSelection(added, order, 'a', { range: false, toggle: true }).ids).toEqual(['c'])
    expect(clickSelection(added, order, 'e', { range: true, toggle: false }).ids).toEqual(['c', 'd', 'e'])
  })

  it('starts a range at the clicked row when nothing is anchored and prunes rows that left the list', () => {
    expect(clickSelection(EMPTY_SELECTION, order, 'c', { range: true, toggle: false }).ids).toEqual(['c'])
    const all = selectAll(order)
    expect(pruneSelection(all, ['b', 'd']).ids).toEqual(['b', 'd'])
    expect(pruneSelection(all, ['b', 'd']).anchor).toBe('b')
  })
})
