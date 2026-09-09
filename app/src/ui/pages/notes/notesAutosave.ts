import type { NotePage, NotePageContentUpdate, NotesApi } from '../../../shared/notes'

export interface PendingNoteDraft {
  id: string
  title: string
  contentJson: string
}

export function noteContentUpdate(draft: PendingNoteDraft): NotePageContentUpdate {
  return {
    ...draft,
    title: draft.title.trim() === '' ? 'Untitled' : draft.title.trim()
  }
}

export async function persistPendingNotes(
  api: Pick<NotesApi, 'updatePage'>,
  readPending: () => PendingNoteDraft | null,
  clearIfCurrent: (draft: PendingNoteDraft) => void
): Promise<readonly NotePage[]> {
  const savedPages: NotePage[] = []
  let pending = readPending()
  while (pending !== null) {
    const saved = await api.updatePage(noteContentUpdate(pending))
    savedPages.push(saved)
    clearIfCurrent(pending)
    pending = readPending()
  }
  return savedPages
}

export type NoteSaveQueue = () => Promise<readonly NotePage[]>

export function createNoteSaveQueue(
  api: Pick<NotesApi, 'updatePage'>,
  readPending: () => PendingNoteDraft | null,
  clearIfCurrent: (draft: PendingNoteDraft) => void
): NoteSaveQueue {
  let active: Promise<readonly NotePage[]> | null = null
  const save = (): Promise<readonly NotePage[]> => {
    if (active !== null) return active
    const request = persistPendingNotes(api, readPending, clearIfCurrent)
    let tracked: Promise<readonly NotePage[]>
    tracked = request.then(
      async (savedPages) => {
        if (active === tracked) active = null
        if (readPending() === null) return savedPages
        return [...savedPages, ...await save()]
      },
      (error: unknown) => {
        if (active === tracked) active = null
        throw error
      }
    )
    active = tracked
    return tracked
  }
  return save
}
