import { describe, expect, it, vi } from 'vitest'

import { NoteWriterLocks } from './NotesService'

class AvailableLockManager {
  readonly releases: Array<Promise<void>> = []

  async request(_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    const held = callback({ name: 'note', mode: 'exclusive' })
    this.releases.push(held)
    await held
  }
}

class UnavailableLockManager {
  async request(_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    await callback(null)
  }
}

describe('NoteWriterLocks', () => {
  it('shares an in-flight lock across effect remounts and releases after the final owner', async () => {
    const manager = new AvailableLockManager()
    const request = vi.spyOn(manager, 'request')
    const locks = new NoteWriterLocks('account-1', manager)

    const firstAcquire = locks.acquire('note-1')
    const secondAcquire = locks.acquire('note-1')
    const [releaseFirst, releaseSecond] = await Promise.all([firstAcquire, secondAcquire])

    expect(request).toHaveBeenCalledTimes(1)
    expect(locks.owns('note-1')).toBe(true)
    releaseFirst()
    expect(locks.owns('note-1')).toBe(true)
    releaseSecond()
    await expect(manager.releases[0]).resolves.toBeUndefined()
    expect(locks.owns('note-1')).toBe(false)
  })

  it('reports a genuinely unavailable cross-tab lock', async () => {
    const locks = new NoteWriterLocks('account-1', new UnavailableLockManager())

    await expect(locks.acquire('note-1')).rejects.toThrow('another Manor tab')
    expect(locks.owns('note-1')).toBe(false)
  })
})

import { NotesService } from './NotesService'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import type { NoteDraftStore } from '../notes/NoteDraftStore'

type Draft = { accountId: string; noteId: string; title: string; contentJson: string; baseRevision: number; mutationId: string; protectedAt: string }
const ACCOUNT = 'account-1'
const NOTE = 'note-1'
const CONTENT = '[{"id":"b1","type":"paragraph","content":[]}]'

/** In-memory stand-in with the real store's re-base rule: typing that arrived during a save keeps its draft and adopts the committed revision. */
class MemoryDraftStore {
  readonly drafts = new Map<string, Draft>()
  async read(_account: string, noteId: string): Promise<Draft | null> { return this.drafts.get(noteId) ?? null }
  async protect(draft: Draft): Promise<void> { this.drafts.set(draft.noteId, draft) }
  async commitRevision(sent: Draft, revision: number): Promise<void> {
    const current = this.drafts.get(sent.noteId)
    if (current?.mutationId === sent.mutationId) this.drafts.delete(sent.noteId)
    else if (current !== undefined && current.baseRevision === sent.baseRevision) this.drafts.set(sent.noteId, { ...current, baseRevision: revision })
  }
  async attachments(): Promise<[]> { return [] }
  async snapshot(): Promise<{ accountId: string; state: { pages: JsonObject[] }; revisions: Record<string, number> }> { return { accountId: ACCOUNT, state: { pages: [] }, revisions: {} } }
  async saveSnapshot(): Promise<void> {}
}

/** Gateway stand-in with real latency and the server's revision check on update_note. */
class RevisionCheckingGateway {
  readonly accountId = ACCOUNT
  revision = 1
  readonly sent: number[] = []
  async command(operation: string, input: JsonObject): Promise<{ command_id: string; operation: string; replayed: boolean; record: JsonObject }> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    this.sent.push(input.expected_revision as number)
    if (input.expected_revision !== this.revision) throw new Error('PT409: Record changed. Reload and resolve the edit.')
    this.revision += 1
    const now = '2026-09-13T20:00:00Z'
    return { command_id: 'c', operation, replayed: false, record: { id: NOTE, title: input.title, folder_id: null, parent_page_id: null, content_json: input.content_json,
      favorite: false, status: 'active', created_at: now, updated_at: now, last_opened_at: now, archived_at: null, deleted_at: null, revision: this.revision } }
  }
}

describe('NotesService.updatePage', () => {
  it('runs overlapping saves for one note in order so the second replays the re-based draft', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const service = new NotesService(gateway as unknown as ManorGateway, drafts as unknown as NoteDraftStore)

    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'First', contentJson: CONTENT, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    const first = service.updatePage({ id: NOTE, title: 'First', contentJson: CONTENT })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Second', contentJson: CONTENT, baseRevision: 1, mutationId: 'm2', protectedAt: 'now' })
    const second = service.updatePage({ id: NOTE, title: 'Second', contentJson: CONTENT })
    await Promise.all([first, second])

    expect(gateway.sent).toEqual([1, 2])
    expect(gateway.revision).toBe(3)
    expect(drafts.drafts.size).toBe(0)
  })
})
