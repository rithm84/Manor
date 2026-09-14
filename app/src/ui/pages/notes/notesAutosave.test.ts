import { describe, expect, it, vi } from 'vitest'

import type { NotePage } from '../../../shared/notes'
import {
  createNoteSaveQueue,
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

describe('notes save queue', () => {
  it('normalizes a title while preserving the native document value', () => {
    const contentJson = '[{"type":"paragraph","content":"Draft"}]'
    expect(noteContentUpdate({ id: 'note-1', title: '  Draft name  ', contentJson })).toEqual({
      id: 'note-1',
      title: 'Draft name',
      contentJson
    })
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
      (confirmed) => { if (pending === confirmed) pending = null },
      async () => {}
    )

    await Promise.resolve()
    pending = second
    const firstResolve = resolvers[0]
    if (firstResolve === undefined) throw new Error('The first update was not started')
    firstResolve({ ...savedPage, title: 'First', contentJson: first.contentJson })
    await new Promise((resolve) => setTimeout(resolve, 0))
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
    save = createNoteSaveQueue({ updatePage }, () => pending, clearIfCurrent, async () => {})

    const saving = save()
    await Promise.resolve()
    const firstResolve = resolvers[0]
    if (firstResolve === undefined) throw new Error('The first update was not started')
    firstResolve({ ...savedPage, title: first.title, contentJson: first.contentJson })
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const secondResolve = resolvers[1]
    if (secondResolve === undefined) throw new Error('The queued update was not restarted')
    secondResolve({ ...savedPage, title: second.title, contentJson: second.contentJson })

    await expect(saving).resolves.toHaveLength(2)
    expect(updatePage).toHaveBeenNthCalledWith(2, noteContentUpdate(second))
    expect(pending).toBeNull()
  })
  it('stops the queue on a conflict and retains the protected draft', async () => {
    const pending = { id: 'note-1', title: 'Local draft', contentJson: '[{"type":"paragraph","content":"Local"}]' }
    const conflict = new Error('Record changed')
    const updatePage = vi.fn(async (): Promise<NotePage> => { throw conflict })
    const clear = vi.fn()
    const save = createNoteSaveQueue({ updatePage }, () => pending, clear, async () => {})
    await expect(save()).rejects.toBe(conflict)
    await Promise.resolve()
    await Promise.resolve()
    expect(updatePage).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
  })


  it('waits for the latest device-side protection before each save', async () => {
    const order: string[] = []
    const updatePage = vi.fn(async (update: { title: string }) => { order.push(`save ${update.title}`); return { ...savedPage, title: update.title } })
    const first = { id: 'note-1', title: 'First', contentJson: '[{"type":"paragraph","content":"First"}]' }
    const second = { id: 'note-1', title: 'Second', contentJson: '[{"type":"paragraph","content":"Second"}]' }
    let pending: typeof first | null = first
    const awaitProtection = vi.fn(async () => { order.push(`protected ${pending?.title ?? 'none'}`) })
    const saved = await persistPendingNotes(
      { updatePage },
      () => pending,
      (confirmed) => { pending = confirmed === first ? second : null },
      awaitProtection
    )

    expect(saved).toHaveLength(2)
    expect(order).toEqual(['protected First', 'save First', 'protected Second', 'save Second'])
  })
})
