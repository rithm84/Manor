import { beforeAll, describe, expect, it, vi } from 'vitest'

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
import { ManorRequestError, type ManorGateway, type JsonObject } from '../ManorGateway'
import type { NoteDraftStore } from '../notes/NoteDraftStore'

type Draft = { accountId: string; noteId: string; title: string; contentJson: string; baseRevision: number; mutationId: string; protectedAt: string }
const ACCOUNT = 'account-1'
beforeAll(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) }) // node's navigator has no onLine; the service reads it to choose the online path
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
  stored: { accountId: string; state: { folders: JsonObject[]; pages: JsonObject[] }; revisions: Record<string, number> } = { accountId: ACCOUNT, state: { folders: [], pages: [] }, revisions: {} }
  async attachments(): Promise<[]> { return [] }
  async list(): Promise<Draft[]> { return [...this.drafts.values()] }
  async snapshot(): Promise<typeof this.stored> { return this.stored }
  async saveSnapshot(snapshot: typeof this.stored): Promise<void> { this.stored = snapshot }
}

const NOW = '2026-09-13T20:00:00Z'
const LATER = '2026-09-13T20:05:00Z'
const row = (revision: number, title: string, content = JSON.parse(CONTENT) as JsonObject[]): JsonObject => ({ id: NOTE, title, folder_id: null, parent_page_id: null,
  content_json: content, favorite: false, status: 'active', created_at: NOW, updated_at: NOW, last_opened_at: NOW, archived_at: null, deleted_at: null, revision })

/** Gateway stand-in with real latency and the server's revision check on update_note. */
class RevisionCheckingGateway {
  readonly accountId = ACCOUNT
  revision = 1
  readonly sent: number[] = []
  /** What the server row holds; a test moves it to simulate another writer. */
  stored = row(1, 'Stored')
  /** Superseded versions, keyed by the revision they held, as the server keeps them. */
  readonly versions = new Map<number, JsonObject>()
  readonly reads: JsonObject[][] = []
  readonly client = { from: (table: string) => new TableQuery(table, this) }
  async rows(table: string): Promise<JsonObject[]> { return table === 'note_pages' ? this.reads.shift() ?? [{ ...this.stored, revision: this.revision }] : [] }
  async command(operation: string, input: JsonObject): Promise<{ command_id: string; operation: string; replayed: boolean; record: JsonObject }> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (operation === 'touch_note') { // opening moves last_opened_at and nothing else
      this.stored = { ...this.stored, last_opened_at: LATER }
      return { command_id: 'c', operation, replayed: false, record: { ...this.stored, revision: this.revision } }
    }
    this.sent.push(input.expected_revision as number)
    if (input.expected_revision !== this.revision) throw new ManorRequestError(operation, 'PT409', 'Record changed. Reload and resolve the edit.')
    this.versions.set(this.revision, { ...this.stored, revision: this.revision })
    this.revision += 1
    // A save carries title and content; a property change (favorite, folder) carries only what it changes.
    this.stored = typeof input.title === 'string'
      ? row(this.revision, input.title, input.content_json as JsonObject[])
      : { ...this.stored, ...input, revision: this.revision }
    return { command_id: 'c', operation, replayed: false, record: this.stored }
  }
}

/** Enough of the PostgREST builder for the service's direct reads of the current row and a base version. */
class TableQuery {
  private readonly filters: Record<string, unknown> = {}
  constructor(private readonly table: string, private readonly gateway: RevisionCheckingGateway) {}
  select(): this { return this }
  eq(column: string, value: unknown): this { this.filters[column] = value; return this }
  private find(): JsonObject | null {
    if (this.table === 'note_pages') return { ...this.gateway.stored, revision: this.gateway.revision }
    if (this.table === 'note_versions') return this.gateway.versions.get(this.filters.revision as number) ?? null
    throw new Error(`Unexpected table ${this.table}`)
  }
  async single(): Promise<{ data: JsonObject | null; error: null }> { return { data: this.find(), error: null } }
  async maybeSingle(): Promise<{ data: JsonObject | null; error: null }> { return { data: this.find(), error: null } }
}

/** Web Locks stand-in: requests for one name run in order; different names are independent. */
class NamedLockManager {
  private readonly tails = new Map<string, Promise<void>>()
  request(name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    const run = (this.tails.get(name) ?? Promise.resolve()).then(() => callback({ name, mode: 'exclusive' }))
    this.tails.set(name, run.catch(() => undefined))
    return run
  }
}

function service(gateway: RevisionCheckingGateway, drafts: MemoryDraftStore): NotesService {
  return new NotesService(gateway as unknown as ManorGateway, drafts as unknown as NoteDraftStore, new NamedLockManager())
}

describe('NotesService.updatePage', () => {
  it('runs overlapping saves for one note in order so the second replays the re-based draft', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)

    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'First', contentJson: CONTENT, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    const first = notes.updatePage({ id: NOTE, title: 'First', contentJson: CONTENT })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Second', contentJson: CONTENT, baseRevision: 1, mutationId: 'm2', protectedAt: 'now' })
    const second = notes.updatePage({ id: NOTE, title: 'Second', contentJson: CONTENT })
    await Promise.all([first, second])

    expect(gateway.sent).toEqual([1, 2])
    expect(gateway.revision).toBe(3)
    expect(drafts.drafts.size).toBe(0)
  })

  it('re-bases and resends when the revision moved but the content is what this device already saw', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    await notes.load() // this device saw revision 1 with the stored content
    gateway.versions.set(1, row(1, 'Stored')); gateway.revision = 2 // a favorite toggle elsewhere moved the revision without touching the text

    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Edited', contentJson: CONTENT, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    const saved = await notes.updatePage({ id: NOTE, title: 'Edited', contentJson: CONTENT })

    expect(gateway.sent).toEqual([1, 2])
    expect(saved.title).toBe('Edited')
    expect(drafts.drafts.size).toBe(0)
  })

  it('merges foreign edits to other blocks into the draft, resends it, and hands the editor the foreign ops', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    await notes.load()
    const foreign = { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: 'added elsewhere', styles: {} }], children: [] }
    gateway.versions.set(1, row(1, 'Stored')); gateway.revision = 2
    gateway.stored = row(2, 'Stored', [...(JSON.parse(CONTENT) as JsonObject[]), foreign])
    const mine = JSON.stringify([{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'edited here', styles: {} }] }])

    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Stored', contentJson: mine, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    const saved = await notes.updatePage({ id: NOTE, title: 'Stored', contentJson: mine })

    expect(gateway.sent).toEqual([1, 2])
    expect((JSON.parse(saved.contentJson) as JsonObject[]).map((block) => block.id)).toEqual(['b1', 'b2'])
    expect(notes.takeMergedBlockOps(NOTE)).toEqual([{ kind: 'insert', block: foreign, afterId: 'b1' }])
    expect(notes.takeMergedBlockOps(NOTE)).toEqual([])
    expect(drafts.drafts.size).toBe(0)
  })

  it('reports a conflict only when the server holds content this device has not seen', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    await notes.load()
    gateway.versions.set(1, row(1, 'Stored')); gateway.revision = 2
    gateway.stored = row(2, 'Written elsewhere', [{ id: 'b9', type: 'paragraph', content: [] }])

    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Edited', contentJson: CONTENT, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    await expect(notes.updatePage({ id: NOTE, title: 'Edited', contentJson: CONTENT })).rejects.toThrow('changed elsewhere')
    await expect(notes.updatePage({ id: NOTE, title: 'Edited', contentJson: CONTENT })).rejects.toThrow('changed elsewhere')
    expect(gateway.sent).toEqual([1])
    expect(drafts.drafts.get(NOTE)?.baseRevision).toBe(1)
  })
})

describe('NotesService.setFavorite', () => {
  it('lands the protected draft first instead of refusing while an edit is unsynced', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    await notes.load()
    await notes.acquireWriter(NOTE)
    await notes.protectDraft({ id: NOTE, title: 'Typed just now', contentJson: CONTENT })

    const state = await notes.setFavorite({ id: NOTE, favorite: true })

    expect(gateway.sent).toEqual([1, 2]) // the draft at revision 1, then the favorite on top of it
    expect(gateway.stored.title).toBe('Typed just now')
    expect(gateway.stored.favorite).toBe(true)
    expect(state.pages[0]?.favorite).toBe(true)
    expect(drafts.drafts.size).toBe(0)
  })
})

describe('NotesService.load', () => {
  it('keeps the newer revision and page when a read that started before a save returns stale rows', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    gateway.reads.push([row(1, 'Stored')])
    await notes.load()
    await drafts.protect({ accountId: ACCOUNT, noteId: NOTE, title: 'Edited', contentJson: CONTENT, baseRevision: 1, mutationId: 'm1', protectedAt: 'now' })
    await notes.updatePage({ id: NOTE, title: 'Edited', contentJson: CONTENT }) // server is now at revision 2

    gateway.reads.push([row(1, 'Stored')]) // a read issued before that save resolves late
    const state = await notes.load()

    expect(state.pages[0]?.title).toBe('Edited')
    await notes.acquireWriter(NOTE)
    await notes.protectDraft({ id: NOTE, title: 'Edited again', contentJson: CONTENT })
    expect(drafts.drafts.get(NOTE)?.baseRevision).toBe(2)
  })
})

describe('NotesService.touchPage', () => {
  it('keeps the later last-opened time when a read after opening still holds the earlier one at the same revision', async () => {
    const gateway = new RevisionCheckingGateway()
    const drafts = new MemoryDraftStore()
    const notes = service(gateway, drafts)
    gateway.reads.push([row(1, 'Stored')])
    await notes.load()

    const opened = await notes.touchPage(NOTE)
    expect(Date.parse(opened.lastOpenedAt)).toBe(Date.parse(LATER))

    gateway.reads.push([row(1, 'Stored')]) // a copy that never saw the opening, at the same revision
    const state = await notes.load()

    expect(Date.parse(state.pages[0]?.lastOpenedAt ?? '')).toBe(Date.parse(LATER))
  })
})
