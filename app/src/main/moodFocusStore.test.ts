import { afterEach, describe, expect, it } from 'vitest'

import type { MoodFocusSeed } from '../shared/moodFocus'
import { MoodFocusStore } from './moodFocusStore'

const CREATED_AT = '2026-08-19T21:00:00.000Z'
const SEED: MoodFocusSeed = {
  today: '2026-08-20',
  entries: [
    {
      date: '2026-08-19',
      mood: 'Neutral',
      focus: 'Medium',
      note: 'Steady day.',
      noteSource: 'alfred',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    }
  ]
}

let store: MoodFocusStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

describe('MoodFocusStore', () => {
  it('persists mood and focus independently into one daily record', () => {
    store = new MoodFocusStore(':memory:')
    store.load(SEED)

    const moodOnly = store.setMood(
      { date: SEED.today, mood: 'Good' },
      '2026-08-20T20:00:00.000Z'
    )
    expect(moodOnly.entries.at(-1)).toMatchObject({ mood: 'Good', focus: null })

    const complete = store.setFocus(
      { date: SEED.today, focus: 'High' },
      '2026-08-20T20:01:00.000Z'
    )
    expect(complete.entries).toHaveLength(2)
    expect(complete.entries.at(-1)).toMatchObject({ mood: 'Good', focus: 'High' })
  })

  it('persists Alfred debrief provenance', () => {
    store = new MoodFocusStore(':memory:')
    store.load(SEED)

    const state = store.setNote(
      { date: '2026-08-19', note: 'Alfred summary.', source: 'alfred' },
      '2026-08-20T12:00:00.000Z'
    )

    expect(state.entries[0]).toMatchObject({
      note: 'Alfred summary.',
      noteSource: 'alfred'
    })
  })

  it('rejects notes without a signal and edits older than yesterday', () => {
    store = new MoodFocusStore(':memory:')
    store.load(SEED)

    expect(() =>
      store?.setNote(
        { date: SEED.today, note: 'Context first', source: 'alfred' },
        '2026-08-20T12:00:00.000Z'
      )
    ).toThrow(/log mood or focus first/)
    expect(() =>
      store?.setMood(
        { date: '2026-08-18', mood: 'Great' },
        '2026-08-20T12:00:00.000Z'
      )
    ).toThrow(/only be changed/)
  })

  it('does not overwrite persisted entries when a later load supplies a different seed', () => {
    store = new MoodFocusStore(':memory:')
    store.load(SEED)
    store.setMood({ date: SEED.today, mood: 'Good' }, '2026-08-20T12:00:00.000Z')

    const reloaded = store.load({ ...SEED, entries: [] })
    expect(reloaded.entries).toHaveLength(2)
    expect(reloaded.entries.at(-1)?.mood).toBe('Good')
  })

  it('advances the editable day window without reseeding persisted history', () => {
    store = new MoodFocusStore(':memory:')
    store.load(SEED)

    const advanced = store.load({ today: '2026-08-21', entries: [] })
    expect(advanced.today).toBe('2026-08-21')
    expect(advanced.entries).toHaveLength(1)
    expect(() =>
      store?.setMood(
        { date: '2026-08-19', mood: 'Good' },
        '2026-08-21T12:00:00.000Z'
      )
    ).toThrow(/only be changed/)
  })
})
