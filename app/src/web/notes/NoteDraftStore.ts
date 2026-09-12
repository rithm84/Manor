import { parseNoteContentJson } from '../../shared/notes'
import type { NotesState } from '../../shared/notes'

export interface NotesSnapshot { accountId: string; state: NotesState; revisions: Record<string, number> }

export interface ProtectedNoteDraft {
  accountId: string
  noteId: string
  title: string
  contentJson: string
  baseRevision: number
  mutationId: string
  protectedAt: string
}

export interface PendingNoteAttachment {
  accountId: string
  noteId: string
  attachmentId: string
  name: string
  mimeType: string
  bytes: Blob
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Notes draft transaction was aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Notes draft transaction failed'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Notes draft request failed'))
  })
}

/** Account-scoped draft protection. A successful write means the IndexedDB transaction committed. */
export class NoteDraftStore {
  private readonly database: IDBDatabase

  private constructor(database: IDBDatabase) {
    this.database = database
  }

  static async open(factory: IDBFactory): Promise<NoteDraftStore> {
    const request = factory.open('manor-notes-drafts', 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts', { keyPath: ['accountId', 'noteId'] }).createIndex('accountId', 'accountId')
      if (!database.objectStoreNames.contains('attachments')) database.createObjectStore('attachments', { keyPath: ['accountId', 'attachmentId'] }).createIndex('accountId', 'accountId')
      if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'accountId' })
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Cannot open Notes draft protection'))
      request.onblocked = () => reject(new Error('Close other Manor tabs to upgrade Notes draft protection'))
    })
    database.onversionchange = () => database.close()
    return new NoteDraftStore(database)
  }

  async protect(draft: ProtectedNoteDraft): Promise<void> {
    parseNoteContentJson(draft.contentJson)
    if (!draft.accountId || !draft.noteId || !draft.mutationId || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0) {
      throw new TypeError('A protected Notes draft needs account, note, mutation, and a nonnegative base revision')
    }
    const transaction = this.database.transaction('drafts', 'readwrite', { durability: 'strict' })
    const completion = transactionComplete(transaction)
    transaction.objectStore('drafts').put(draft)
    await completion
  }

  async read(accountId: string, noteId: string): Promise<ProtectedNoteDraft | null> {
    const transaction = this.database.transaction('drafts', 'readonly')
    const result = await requestResult<ProtectedNoteDraft | undefined>(transaction.objectStore('drafts').get([accountId, noteId]))
    return result ?? null
  }

  async list(accountId: string): Promise<readonly ProtectedNoteDraft[]> {
    const transaction = this.database.transaction('drafts', 'readonly')
    return requestResult<ProtectedNoteDraft[]>(transaction.objectStore('drafts').index('accountId').getAll(accountId))
  }

  /** Never clear typing that arrived while a cloud request was in flight. */
  async acknowledge(accountId: string, noteId: string, mutationId: string): Promise<void> {
    const transaction = this.database.transaction('drafts', 'readwrite', { durability: 'strict' })
    const completion = transactionComplete(transaction)
    const store = transaction.objectStore('drafts')
    const request: IDBRequest<ProtectedNoteDraft | undefined> = store.get([accountId, noteId])
    request.onsuccess = () => {
      if (request.result?.mutationId === mutationId) store.delete([accountId, noteId])
    }
    await completion
  }

  async commitRevision(sent: ProtectedNoteDraft, revision: number): Promise<void> {
    const transaction = this.database.transaction('drafts', 'readwrite', { durability: 'strict' })
    const completion = transactionComplete(transaction)
    const store = transaction.objectStore('drafts')
    const request: IDBRequest<ProtectedNoteDraft | undefined> = store.get([sent.accountId, sent.noteId])
    request.onsuccess = () => {
      const current = request.result
      if (current?.mutationId === sent.mutationId) store.delete([sent.accountId, sent.noteId])
      else if (current !== undefined && current.baseRevision === sent.baseRevision) store.put({ ...current, baseRevision: revision })
    }
    await completion
  }

  async saveSnapshot(snapshot: NotesSnapshot): Promise<void> {
    const transaction = this.database.transaction('snapshots', 'readwrite')
    const completion = transactionComplete(transaction)
    transaction.objectStore('snapshots').put(snapshot)
    await completion
  }

  async snapshot(accountId: string): Promise<NotesSnapshot | null> {
    const transaction = this.database.transaction('snapshots', 'readonly')
    return await requestResult<NotesSnapshot | undefined>(transaction.objectStore('snapshots').get(accountId)) ?? null
  }

  async protectAttachment(attachment: PendingNoteAttachment): Promise<void> {
    if (!attachment.accountId || !attachment.noteId || !attachment.attachmentId || attachment.bytes.size === 0) {
      throw new TypeError('A pending Notes attachment needs account, note, attachment identity, and file bytes')
    }
    const transaction = this.database.transaction('attachments', 'readwrite', { durability: 'strict' })
    const completion = transactionComplete(transaction)
    transaction.objectStore('attachments').put(attachment)
    await completion
  }

  async attachments(accountId: string): Promise<readonly PendingNoteAttachment[]> {
    const transaction = this.database.transaction('attachments', 'readonly')
    return requestResult<PendingNoteAttachment[]>(transaction.objectStore('attachments').index('accountId').getAll(accountId))
  }

  async acknowledgeAttachment(accountId: string, attachmentId: string): Promise<void> {
    const transaction = this.database.transaction('attachments', 'readwrite', { durability: 'strict' })
    const completion = transactionComplete(transaction)
    transaction.objectStore('attachments').delete([accountId, attachmentId])
    await completion
  }

  async assertCanSignOut(accountId: string): Promise<void> {
    const [drafts, attachments] = await Promise.all([this.list(accountId), this.attachments(accountId)])
    if (drafts.length > 0 || attachments.length > 0) {
      throw new Error('Your Notes have changes saved on this device. Connect and finish syncing before signing out.')
    }
  }

  close(): void {
    this.database.close()
  }
}
