import { beforeEach, describe, expect, it } from 'vitest'
import { forgetNotesView, recallNotesView, rememberNotesView } from './notesSession'

describe('notes session memory', () => {
  beforeEach(() => forgetNotesView())

  it('starts empty so a fresh session opens the first note', () => {
    expect(recallNotesView()).toBeNull()
  })

  it('returns the last remembered list and note, not the first one remembered', () => {
    rememberNotesView({ scope: 'all', noteId: 'first' })
    rememberNotesView({ scope: 'folder:work', noteId: 'second' })
    expect(recallNotesView()).toEqual({ scope: 'folder:work', noteId: 'second' })
  })

  it('remembers an empty editor as a place too', () => {
    rememberNotesView({ scope: 'trash', noteId: null })
    expect(recallNotesView()).toEqual({ scope: 'trash', noteId: null })
  })

  it('forgets on sign out', () => {
    rememberNotesView({ scope: 'all', noteId: 'first' })
    forgetNotesView()
    expect(recallNotesView()).toBeNull()
  })
})
