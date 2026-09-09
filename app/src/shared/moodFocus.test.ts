import { describe, expect, it } from 'vitest'

import {
  parseMoodFocusEntry,
  parseMoodFocusNoteMutation,
  parseMoodFocusSeed,
  parseMoodMutation
} from './moodFocus'

const ENTRY = {
  date: '2026-08-19',
  mood: 'Good',
  focus: 'High',
  note: 'Deep work before lunch.',
  noteSource: 'manual',
  createdAt: '2026-08-19T21:00:00.000Z',
  updatedAt: '2026-08-19T21:00:00.000Z'
}

describe('mood and focus validation', () => {
  it('accepts independently logged mood and focus entries', () => {
    expect(parseMoodFocusEntry({ ...ENTRY, focus: null })).toMatchObject({ mood: 'Good', focus: null })
    expect(parseMoodFocusEntry({ ...ENTRY, mood: null })).toMatchObject({ mood: null, focus: 'High' })
  })

  it('rejects empty entries and mismatched note provenance', () => {
    expect(() => parseMoodFocusEntry({ ...ENTRY, mood: null, focus: null })).toThrow(/mood or focus/)
    expect(() => parseMoodFocusEntry({ ...ENTRY, noteSource: null })).toThrow(/both be set/)
    expect(() => parseMoodFocusNoteMutation({ date: ENTRY.date, note: 'Context', source: null })).toThrow(/both be set/)
    expect(() => parseMoodFocusNoteMutation({ date: ENTRY.date, note: 'Context', source: 'manual' })).toThrow(/must come from Codex/)
    expect(parseMoodFocusNoteMutation({ date: ENTRY.date, note: 'Context', source: 'codex' })).toMatchObject({ source: 'codex' })
  })

  it('rejects invalid scales and duplicate seed dates', () => {
    expect(() => parseMoodMutation({ date: ENTRY.date, mood: 'Fine' })).toThrow(/mood must be one of/)
    expect(() => parseMoodFocusSeed({ today: '2026-08-20', entries: [ENTRY, ENTRY] })).toThrow(/unique dates/)
  })
})
