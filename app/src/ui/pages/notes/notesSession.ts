import type { NotesScope } from './notesModel'

export interface NotesView {
  readonly scope: NotesScope
  readonly noteId: string | null
}

/**
 * Where the reader was in Notes when they left for another page. Held in memory on purpose: coming back
 * during a session reopens the same list and note, while a relaunch starts fresh.
 */
let lastView: NotesView | null = null

export function rememberNotesView(view: NotesView): void {
  lastView = view
}

export function recallNotesView(): NotesView | null {
  return lastView
}

/** Test seam and sign-out hook; a new account must not inherit another's place. */
export function forgetNotesView(): void {
  lastView = null
}
