import { z } from 'zod'
import { FileService } from './FileService'
import {
  parseNoteFolder, parseNotePage, parseNotePageContentUpdate, parseNoteAttachmentUpload,
  type NoteAttachment, type NoteAttachmentUpload, type NoteFolderDraft, type NoteFolderRename,
  type NotePage, type NotePageContentUpdate, type NotePageDraft, type NotePageFavoriteMutation,
  type NotePageMove, type NotesApi, type NotesState, type NoteSuggestion, type NoteConflict,
  type NoteSuggestionReview, type NoteVersion
} from '../../shared/notes'
import { ManorGateway, ManorConnectionError, ManorRequestError, type JsonObject, type JsonValue } from '../ManorGateway'
import { NoteDraftStore } from '../notes/NoteDraftStore'

function note(row: JsonObject): NotePage {
  return parseNotePage({ id: row.id, title: row.title, folderId: row.folder_id, parentPageId: row.parent_page_id,
    contentJson: JSON.stringify(row.content_json), favorite: row.favorite, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, lastOpenedAt: row.last_opened_at,
    archivedAt: row.archived_at, deletedAt: row.deleted_at })
}

/** Fill absent imported IDs once, preserving every existing ID and unrelated JSON property. */
function nativeBlocks(contentJson: string): JsonValue[] {
  const blocks = z.array(z.record(z.string(), z.json())).parse(JSON.parse(contentJson))
  return blocks.map((block) => ({ ...block, id: typeof block.id === 'string' && block.id !== '' ? block.id : crypto.randomUUID(),
    ...(Array.isArray(block.children) ? { children: nativeBlocks(JSON.stringify(block.children)) } : {}) }))
}

interface WriterLockManager {
  request: (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => Promise<void>
}

interface WriterLease {
  references: number
  readonly ready: Promise<void>
  readonly finished: Promise<void>
  releaseUnderlying: (() => void) | null
}

/** Reuses this tab's in-flight Web Lock request across React effect remounts. */
export class NoteWriterLocks {
  private readonly accountId: string
  private readonly locks: WriterLockManager
  private readonly leases = new Map<string, WriterLease>()

  constructor(accountId: string, locks: WriterLockManager) {
    this.accountId = accountId
    this.locks = locks
  }

  async acquire(noteId: string): Promise<() => void> {
    const current = this.leases.get(noteId)
    if (current !== undefined) {
      if (current.references === 0) {
        await current.finished
        return this.acquire(noteId)
      }
      current.references += 1
      await current.ready
      return this.releaseOnce(current)
    }

    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let resolveFinished!: () => void
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve })
    const lease: WriterLease = { references: 1, ready, finished, releaseUnderlying: null }
    this.leases.set(noteId, lease)

    let releaseLock!: () => void
    const held = new Promise<void>((resolve) => { releaseLock = resolve })
    void this.locks.request(
      `manor-note-writer:${this.accountId}:${noteId}`,
      { ifAvailable: true },
      async (lock) => {
        if (lock === null) {
          this.leases.delete(noteId)
          rejectReady(new Error('This note is being edited in another Manor tab. Close that editor before editing here.'))
          return
        }
        lease.releaseUnderlying = releaseLock
        resolveReady()
        await held
      }
    ).catch((error: unknown) => {
      this.leases.delete(noteId)
      rejectReady(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => {
      if (this.leases.get(noteId) === lease) this.leases.delete(noteId)
      resolveFinished()
    })

    await ready
    return this.releaseOnce(lease)
  }

  owns(noteId: string): boolean {
    const lease = this.leases.get(noteId)
    return lease !== undefined && lease.releaseUnderlying !== null && lease.references > 0
  }

  private releaseOnce(lease: WriterLease): () => void {
    let released = false
    return (): void => {
      if (released) return
      released = true
      lease.references -= 1
      if (lease.references !== 0) return
      lease.releaseUnderlying?.()
    }
  }
}

export class NotesService implements NotesApi {
  private readonly gateway: ManorGateway
  private readonly drafts: NoteDraftStore
  private readonly revisions = new Map<string, number>()
  private readonly writerLocks: NoteWriterLocks
  private readonly conflicts = new Set<string>()
  private readonly confirmed = new Map<string, { page: NotePage; title: string; contentJson: string }>()
  private readonly attachmentUrls = new Map<string, string>()

  constructor(gateway: ManorGateway, drafts: NoteDraftStore) {
    this.gateway = gateway
    this.drafts = drafts
    this.writerLocks = new NoteWriterLocks(gateway.accountId, navigator.locks)
  }

  async acquireWriter(noteId: string): Promise<() => void> {
    const release = await this.writerLocks.acquire(noteId)
    return release
  }

  async protectDraft(draft: NotePageContentUpdate): Promise<void> {
    if (!this.writerLocks.owns(draft.id)) throw new Error('This tab does not own the Notes editor. Reopen the note before editing.')
    await navigator.locks.request(`manor-account:${this.gateway.accountId}`, async () => {
      const current = await this.drafts.read(this.gateway.accountId, draft.id)
      if (current?.contentJson === draft.contentJson && current.title === draft.title) return
      const revision = current?.baseRevision ?? this.revisions.get(draft.id)
      if (revision === undefined) throw new Error('Load the note before editing it')
      await this.drafts.protect({ accountId: this.gateway.accountId, noteId: draft.id, title: draft.title,
        contentJson: draft.contentJson, baseRevision: revision, mutationId: crypto.randomUUID(), protectedAt: new Date().toISOString() })
    })
  }

  async pendingDrafts(): Promise<readonly NotePageContentUpdate[]> {
    return (await this.drafts.list(this.gateway.accountId)).map((draft) => ({ id: draft.noteId, title: draft.title, contentJson: draft.contentJson }))
  }

  async syncDrafts(): Promise<readonly NotePage[]> {
    const saved: NotePage[] = []
    for (const draft of await this.pendingDrafts()) {
      const release = this.writerLocks.owns(draft.id) ? null : await this.acquireWriter(draft.id)
      try { saved.push(await this.updatePage(draft)) }
      finally { release?.() }
    }
    return saved
  }

  private async cachedState(): Promise<NotesState> {
    const snapshot = await this.drafts.snapshot(this.gateway.accountId)
    if (snapshot === null) throw new Error('Connect once to load your Notes on this device')
    Object.entries(snapshot.revisions).forEach(([id, revision]) => this.revisions.set(id, revision))
    return snapshot.state
  }

  async load(): Promise<NotesState> {
    let state: NotesState
    if (!navigator.onLine) state = await this.cachedState()
    else {
      try {
        const [folders, pages] = await Promise.all([this.gateway.rows('note_folders'), this.gateway.rows('note_pages')])
        pages.forEach((row) => this.revisions.set(z.string().parse(row.id), z.number().int().parse(row.revision)))
        state = {
          folders: folders.map((row) => parseNoteFolder({ id: row.id, name: row.name, parentFolderId: row.parent_folder_id, createdAt: row.created_at, updatedAt: row.updated_at })),
          pages: pages.map(note)
        }
        await this.drafts.saveSnapshot({ accountId: this.gateway.accountId, state, revisions: Object.fromEntries(this.revisions) })
      } catch (error) {
        if (!(error instanceof ManorConnectionError)) throw error
        state = await this.cachedState()
      }
    }
    const pending = await this.pendingDrafts()
    return { ...state, pages: state.pages.map((page) => {
      const draft = pending.find((candidate) => candidate.id === page.id)
      return draft === undefined ? page : { ...page, title: draft.title, contentJson: draft.contentJson }
    }) }
  }

  private async command(operation: string, id: string, input: JsonObject): Promise<NotePage> {
    const pending = await this.drafts.read(this.gateway.accountId, id)
    if (pending !== null) throw new Error('Finish syncing your local changes before changing this note')
    const revision = this.revisions.get(id)
    if (revision === undefined) throw new Error('Load the note before changing it')
    const result = await this.gateway.command(operation, { ...input, id, expected_revision: revision }, crypto.randomUUID())
    if (!result.record) throw new Error(`${operation} did not return the saved note`)
    this.revisions.set(id, z.number().int().parse(result.record.revision))
    const saved = note(result.record)
    await this.remember(saved)
    return saved
  }

  private async remember(page: NotePage): Promise<void> {
    const snapshot = await this.drafts.snapshot(this.gateway.accountId)
    if (snapshot === null) throw new Error('The local Notes snapshot is unavailable; reload Notes before continuing')
    await this.drafts.saveSnapshot({ accountId: this.gateway.accountId,
      state: { ...snapshot.state, pages: snapshot.state.pages.map((current) => current.id === page.id ? page : current) },
      revisions: Object.fromEntries(this.revisions) })
  }

  async updatePage(input: NotePageContentUpdate): Promise<NotePage> {
    const update = parseNotePageContentUpdate(input)
    if (this.conflicts.has(update.id)) throw new Error('This note changed elsewhere. Compare versions before saving your draft.')
    const pending = await this.drafts.read(this.gateway.accountId, update.id)
    if (pending === null) {
      const saved = this.confirmed.get(update.id)
      if (saved?.title === update.title && saved.contentJson === update.contentJson) return saved.page
      throw new Error('The Notes draft was not protected before saving')
    }
    await this.syncAttachments(update.id)
    let result: Awaited<ReturnType<ManorGateway['command']>>
    try {
      result = await this.gateway.command('update_note', { id: update.id, title: pending.title.trim() || 'Untitled',
        content_json: nativeBlocks(pending.contentJson), expected_revision: pending.baseRevision }, pending.mutationId)
    } catch (error) {
      if (error instanceof ManorRequestError && (error.code === 'PT409' || error.code === '40001')) this.conflicts.add(update.id)
      throw error
    }
    if (!result.record) throw new Error('Saving the note did not return the committed document')
    const revision = z.number().int().parse(result.record.revision)
    this.revisions.set(update.id, revision)
    const saved = note(result.record)
    await this.remember(saved)
    await this.drafts.commitRevision(pending, revision)
    this.confirmed.set(update.id, { page: saved, title: pending.title.trim() || 'Untitled', contentJson: pending.contentJson })
    return saved
  }

  async createPage(draft: NotePageDraft): Promise<NotesState> {
    await this.gateway.command('create_note', { id: crypto.randomUUID(), title: draft.title, content_json: nativeBlocks(draft.contentJson),
      folder_id: draft.folderId, parent_page_id: draft.parentPageId, expected_revision: 0 }, crypto.randomUUID())
    return this.load()
  }
  async createFolder(draft: NoteFolderDraft): Promise<NotesState> {
    await this.gateway.command('create_note_folder', { id: crypto.randomUUID(), name: draft.name, parent_folder_id: draft.parentFolderId, expected_revision: 0 }, crypto.randomUUID())
    return this.load()
  }
  async renameFolder(change: NoteFolderRename): Promise<NotesState> {
    await this.gateway.command('update_note_folder', { id: change.id, name: change.name, expected_revision: this.gateway.revision('note_folders', change.id) }, crypto.randomUUID())
    return this.load()
  }
  async deleteFolder(id: string): Promise<NotesState> {
    await this.gateway.command('remove_note_folder', { id, expected_revision: this.gateway.revision('note_folders', id) }, crypto.randomUUID())
    return this.load()
  }
  async touchPage(id: string): Promise<NotePage> {
    if (!navigator.onLine) {
      const state = await this.load()
      const page = state.pages.find((candidate) => candidate.id === id)
      if (page === undefined) throw new Error('This note is not available on this device')
      return page
    }
    const result = await this.gateway.command('touch_note', { id, expected_revision: this.revisions.get(id) ?? 0 }, crypto.randomUUID())
    if (!result.record) throw new Error('Opening the note did not return its document')
    const saved = note(result.record)
    const pending = await this.drafts.read(this.gateway.accountId, id)
    return pending === null ? saved : { ...saved, title: pending.title, contentJson: pending.contentJson }
  }
  async movePage(change: NotePageMove): Promise<NotesState> { await this.command('move_note', change.id, { folder_id: change.folderId, parent_page_id: change.parentPageId }); return this.load() }
  async setFavorite(change: NotePageFavoriteMutation): Promise<NotesState> { await this.command('update_note', change.id, { favorite: change.favorite }); return this.load() }
  async archivePage(id: string): Promise<NotesState> { await this.command('archive_note', id, {}); return this.load() }
  async trashPage(id: string): Promise<NotesState> { await this.command('trash_note', id, {}); return this.load() }
  async restorePage(id: string): Promise<NotesState> { await this.command('restore_note', id, {}); return this.load() }
  async duplicatePage(id: string): Promise<NotesState> {
    const state = await this.load()
    const source = state.pages.find((page) => page.id === id)
    if (source === undefined) throw new Error('The note to duplicate is unavailable')
    return this.createPage({ title: `${source.title} (copy)`, folderId: source.folderId, parentPageId: source.parentPageId, contentJson: source.contentJson })
  }

  async listVersions(noteId: string): Promise<readonly NoteVersion[]> {
    return (await this.gateway.rowsWhere('note_versions', [{ column: 'note_id', value: noteId }])).map((row) => ({
      id: String(z.number().int().parse(row.revision)), noteId, revision: z.number().int().parse(row.revision),
      title: z.string().parse(row.title), contentJson: JSON.stringify(row.content_json), createdAt: z.string().parse(row.created_at)
    })).sort((left, right) => right.revision - left.revision)
  }
  async restoreVersion(request: { noteId: string; versionId: string }): Promise<NotePage> {
    return this.command('restore_note_version', request.noteId, { version_revision: Number(request.versionId) })
  }
  async listSuggestions(noteId: string): Promise<readonly NoteSuggestion[]> {
    return (await this.gateway.rowsWhere('note_suggestions', [{ column: 'note_id', value: noteId }])).map((row) => ({
      id: z.string().parse(row.id), noteId, blockId: z.string().parse(row.block_id), summary: z.string().parse(row.description),
      beforeContentJson: JSON.stringify(row.before_content_json), afterContentJson: JSON.stringify(row.after_content_json),
      status: z.enum(['pending', 'accepted', 'rejected']).parse(row.status), createdAt: z.string().parse(row.created_at)
    }))
  }
  async reviewSuggestions(request: NoteSuggestionReview): Promise<NotePage> {
    return this.command('resolve_note_suggestions', request.noteId, { suggestion_ids: [...request.suggestionIds], decision: request.decision })
  }

  async readConflict(noteId: string): Promise<NoteConflict> {
    const local = await this.drafts.read(this.gateway.accountId, noteId)
    if (local === null) throw new Error('There is no local draft to compare')
    const response = await this.gateway.client.from('note_pages').select('*').eq('user_id', this.gateway.accountId).eq('id', noteId).single()
    if (response.error) throw new Error(`Loading the current note: ${response.error.message}`)
    const row = z.record(z.string(), z.json()).parse(response.data)
    return { current: note(row), local: { id: noteId, title: local.title, contentJson: local.contentJson }, revision: z.number().int().parse(row.revision) }
  }

  async resolveConflict(conflict: NoteConflict): Promise<NotePage> {
    await navigator.locks.request(`manor-account:${this.gateway.accountId}`, async () => {
      const current = await this.drafts.read(this.gateway.accountId, conflict.local.id)
      if (current === null || current.title !== conflict.local.title || current.contentJson !== conflict.local.contentJson) {
        throw new Error('Your local draft changed. Reopen the comparison before resolving it.')
      }
      await this.drafts.protect({ ...current, baseRevision: conflict.revision, mutationId: crypto.randomUUID() })
    })
    this.conflicts.delete(conflict.local.id)
    return this.updatePage(conflict.local)
  }

  async moveBlocks(request: { sourceNoteId: string; targetNoteId: string; blockIds: readonly string[] }): Promise<NotesState> {
    const pending = await this.pendingDrafts()
    if (pending.some((draft) => draft.id === request.sourceNoteId || draft.id === request.targetNoteId)) {
      throw new Error('Sync the source and destination notes before moving blocks')
    }
    const sourceRevision = this.revisions.get(request.sourceNoteId)
    const targetRevision = this.revisions.get(request.targetNoteId)
    if (sourceRevision === undefined || targetRevision === undefined) throw new Error('Load both notes before moving blocks')
    await this.gateway.command('move_note_blocks', { id: request.sourceNoteId, expected_revision: sourceRevision,
      target_note_id: request.targetNoteId, target_expected_revision: targetRevision, block_ids: [...request.blockIds] }, crypto.randomUUID())
    return this.load()
  }

  async uploadAttachment(input: NoteAttachmentUpload): Promise<NoteAttachment> {
    const upload = parseNoteAttachmentUpload(input)
    const id = crypto.randomUUID()
    await navigator.locks.request(`manor-account:${this.gateway.accountId}`, () => this.drafts.protectAttachment({
      accountId: this.gateway.accountId, noteId: upload.noteId, attachmentId: id,
      name: upload.name, mimeType: upload.mimeType, bytes: upload.bytes
    }))
    return { id, noteId: upload.noteId, name: upload.name, mimeType: upload.mimeType, size: upload.bytes.size,
      stableUrl: `manor-attachment://${id}`, createdAt: new Date().toISOString() }
  }

  private async syncAttachments(noteId: string): Promise<void> {
    for (const attachment of (await this.drafts.attachments(this.gateway.accountId)).filter((item) => item.noteId === noteId)) {
      await new FileService(this.gateway).upload({ id: attachment.attachmentId, purpose: 'note', label: null, parentId: noteId,
        name: attachment.name, mimeType: attachment.mimeType, bytes: attachment.bytes })
      await this.drafts.acknowledgeAttachment(this.gateway.accountId, attachment.attachmentId)
    }
  }

  async resolveAttachment(id: string): Promise<string> {
    const pending = (await this.drafts.attachments(this.gateway.accountId)).find((item) => item.attachmentId === id)
    if (pending !== undefined) {
      const existing = this.attachmentUrls.get(id)
      if (existing !== undefined) return existing
      const url = URL.createObjectURL(pending.bytes)
      this.attachmentUrls.set(id, url)
      return url
    }
    return new FileService(this.gateway).signedUrl(id)
  }
}
