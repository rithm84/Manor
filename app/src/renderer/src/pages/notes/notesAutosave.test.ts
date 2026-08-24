import { describe, expect, it, vi } from 'vitest'

import type { NotePage } from '../../../../shared/notes'
import {
  createNoteSaveQueue,
  flushPendingNote,
  noteContentUpdate,
  persistPendingNotes
} from './notesAutosave'

const savedPage: NotePage = {
  id: 'note-1',
  title: 'Untitled',
  folderId: null,
  parentPageId: null,
  contentJson: '[{"type":"codeBlock","content":"  x = 1\\n"}]',
  favorite: false,
  status: 'active',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  lastOpenedAt: '2026-08-22T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null
}

describe('notes autosave teardown', () => {
  it('flushes the latest native document synchronously without changing code whitespace', () => {
    const flushPage = vi.fn(() => savedPage)
    const contentJson = '[{"type":"codeBlock","content":"  x = 1\\n"}]'

    flushPendingNote({ flushPage }, { id: 'note-1', title: '   ', contentJson })

    expect(flushPage).toHaveBeenCalledWith({ id: 'note-1', title: 'Untitled', contentJson })
  })

  it('normalizes a title while preserving the native document value', () => {
    const contentJson = '[{"type":"paragraph","content":"Draft"}]'
    expect(noteContentUpdate({ id: 'note-1', title: '  Draft name  ', contentJson })).toEqual({
      id: 'note-1',
      title: 'Draft name',
      contentJson
    })
  })

  it('keeps the in-flight draft available for a synchronous teardown flush', async () => {
    const resolvers: Array<(page: NotePage) => void> = []
    const updatePage = vi.fn(() => new Promise<NotePage>((resolve) => { resolvers.push(resolve) }))
    const flushPage = vi.fn(() => savedPage)
    const draft = { id: 'note-1', title: 'Draft', contentJson: savedPage.contentJson }
    let pending: typeof draft | null = draft
    const save = persistPendingNotes(
      { updatePage },
      () => pending,
      (confirmed) => { if (pending === confirmed) pending = null }
    )

    await Promise.resolve()
    expect(pending).toBe(draft)
    flushPendingNote({ flushPage }, pending as typeof draft)
    pending = null
    expect(flushPage).toHaveBeenCalledWith(noteContentUpdate(draft))

    const resolveUpdate = resolvers[0]
    if (resolveUpdate === undefined) throw new Error('The async update was not started')
    resolveUpdate(savedPage)
    await expect(save).resolves.toEqual([savedPage])
  })

  it('drains a newer draft queued while the previous save is in flight', async () => {
    const resolvers: Array<(page: NotePage) => void> = []
    const updatePage = vi.fn(() => new Promise<NotePage>((resolve) => { resolvers.push(resolve) }))
    const first = { id: 'note-1', title: 'First', contentJson: '[{"type":"paragraph","content":"First"}]' }
    const second = { id: 'note-1', title: 'Second', contentJson: '[{"type":"paragraph","content":"Second"}]' }
    let pending: typeof first | null = first
    const save = persistPendingNotes(
      { updatePage },
      () => pending,
      (confirmed) => { if (pending === confirmed) pending = null }
    )

    await Promise.resolve()
    pending = second
    const firstResolve = resolvers[0]
    if (firstResolve === undefined) throw new Error('The first update was not started')
    firstResolve({ ...savedPage, title: 'First', contentJson: first.contentJson })
    await Promise.resolve()
    const secondResolve = resolvers[1]
    if (secondResolve === undefined) throw new Error('The second update was not started')
    secondResolve({ ...savedPage, title: 'Second', contentJson: second.contentJson })

    await expect(save).resolves.toHaveLength(2)
    expect(pending).toBeNull()
    expect(updatePage).toHaveBeenNthCalledWith(2, noteContentUpdate(second))
  })

  it('restarts after a draft is queued as the active save resolves', async () => {
    const resolvers: Array<(page: NotePage) => void> = []
    const updatePage = vi.fn(() => new Promise<NotePage>((resolve) => { resolvers.push(resolve) }))
    const first = { id: 'note-1', title: 'First', contentJson: '[{"type":"paragraph","content":"First"}]' }
    const second = { id: 'note-1', title: 'Second', contentJson: '[{"type":"paragraph","content":"Second"}]' }
    let pending: typeof first | null = first
    let save: ReturnType<typeof createNoteSaveQueue>
    const clearIfCurrent = (confirmed: typeof first): void => {
      if (pending !== confirmed) return
      pending = null
      if (confirmed !== first) return
      queueMicrotask(() => {
        pending = second
        void save()
      })
    }
    save = createNoteSaveQueue({ updatePage }, () => pending, clearIfCurrent)

    const saving = save()
    await Promise.resolve()
    const firstResolve = resolvers[0]
    if (firstResolve === undefined) throw new Error('The first update was not started')
    firstResolve({ ...savedPage, title: first.title, contentJson: first.contentJson })
    await Promise.resolve()
    await Promise.resolve()
    const secondResolve = resolvers[1]
    if (secondResolve === undefined) throw new Error('The queued update was not restarted')
    secondResolve({ ...savedPage, title: second.title, contentJson: second.contentJson })

    await expect(saving).resolves.toHaveLength(2)
    expect(updatePage).toHaveBeenNthCalledWith(2, noteContentUpdate(second))
    expect(pending).toBeNull()
  })
})
