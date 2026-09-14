import { describe, expect, it } from 'vitest'

import { selectMirrorRows } from './mirrorRows'

describe('selectMirrorRows', () => {
  it('sorts by the same key columns the server query orders on', () => {
    const rows = [
      { account_id: 'a2', calendar_id: 'c1', id: 'e1' },
      { account_id: 'a1', calendar_id: 'c2', id: 'e1' },
      { account_id: 'a1', calendar_id: 'c1', id: 'e2' },
      { account_id: 'a1', calendar_id: 'c1', id: 'e1' }
    ]
    expect(selectMirrorRows('calendar_events', rows, []).map((row) => [row.account_id, row.calendar_id, row.id]))
      .toEqual([['a1', 'c1', 'e1'], ['a1', 'c1', 'e2'], ['a1', 'c2', 'e1'], ['a2', 'c1', 'e1']])
  })

  it('applies equality filters the way the server does', () => {
    const listings = [
      { id: '1', active: true, term: 'Summer 2027' },
      { id: '2', active: false, term: 'Summer 2027' },
      { id: '3', active: true, term: 'Fall 2026' }
    ]
    expect(selectMirrorRows('job_listings', listings, [{ column: 'active', value: true }]).map((row) => row.id)).toEqual(['1', '3'])
    expect(selectMirrorRows('job_listings', listings, [{ column: 'active', value: true }, { column: 'term', value: 'Fall 2026' }]).map((row) => row.id)).toEqual(['3'])
  })

  it('sorts missing values last, the way Postgres orders nulls', () => {
    const contexts = [{ name: null, id: 'b' }, { name: 'Study', id: 'a' }]
    expect(selectMirrorRows('contexts', contexts, []).map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('leaves the rows it was given alone', () => {
    const rows = [{ id: 'b' }, { id: 'a' }]
    selectMirrorRows('tasks', rows, [])
    expect(rows.map((row) => row.id)).toEqual(['b', 'a'])
  })
})
