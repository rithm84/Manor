import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  parseNoteAttachment,
  parseNoteAttachmentUpload,
  parseNoteFolder,
  parseNoteFolderDraft,
  parseNoteFolderRename,
  parseNoteId,
  parseNotePage,
  parseNotePageContentUpdate,
  parseNotePageDraft,
  parseNotePageFavoriteMutation,
  parseNotePageMove,
  parseNotesSeed
} from '../shared/notes'
import type {
  NoteAttachment,
  NoteAttachmentUpload,
  NoteFolder,
  NoteFolderDraft,
  NoteFolderRename,
  NotePage,
  NotePageContentUpdate,
  NotePageDraft,
  NotePageFavoriteMutation,
  NotePageMove,
  NotesSeed,
  NotesState
} from '../shared/notes'

interface FolderRow {
  id: string
  name: string
  parent_folder_id: string | null
  created_at: string
  updated_at: string
}

interface PageRow {
  id: string
  title: string
  folder_id: string | null
  parent_page_id: string | null
  content_json: string
  favorite: number
  status: string
  created_at: string
  updated_at: string
  last_opened_at: string
  archived_at: string | null
  deleted_at: string | null
}

interface AttachmentRow {
  id: string
  note_id: string
  name: string
  mime_type: string
  size: number
  relative_path: string
  created_at: string
}

export class NotesStore {
  private readonly database: DatabaseSync
  private readonly attachmentRoot: string

  constructor(databasePath: string, attachmentRoot: string) {
    this.database = new DatabaseSync(databasePath)
    this.attachmentRoot = attachmentRoot
    mkdirSync(this.attachmentRoot, { recursive: true })
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS notes_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_folder_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (parent_folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS note_pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        folder_id TEXT,
        parent_page_id TEXT,
        content_json TEXT NOT NULL,
        favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'trash')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        archived_at TEXT,
        deleted_at TEXT,
        FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE SET NULL,
        FOREIGN KEY (parent_page_id) REFERENCES note_pages(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS note_attachments (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES note_pages(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS note_pages_status_updated
        ON note_pages(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS note_pages_folder
        ON note_pages(folder_id, parent_page_id);
      CREATE INDEX IF NOT EXISTS note_attachments_note
        ON note_attachments(note_id);
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: NotesSeed): NotesState {
    const seed = parseNotesSeed(seedValue)
    this.transaction(() => {
      const initialized = this.database
        .prepare("SELECT value FROM notes_metadata WHERE key = 'initialized'")
        .get()
      if (initialized === undefined) {
        this.seed(seed)
      }
    })
    return this.readState()
  }

  createFolder(draftValue: NoteFolderDraft, nowIso: string): NotesState {
    const draft = parseNoteFolderDraft(draftValue)
    this.assertFolderExists(draft.parentFolderId)
    const folder = parseNoteFolder({
      id: `note-folder-${randomUUID()}`,
      ...draft,
      createdAt: nowIso,
      updatedAt: nowIso
    })
    this.insertFolder(folder)
    return this.readState()
  }

  renameFolder(mutationValue: NoteFolderRename, nowIso: string): NotesState {
    const mutation = parseNoteFolderRename(mutationValue)
    const result = this.database
      .prepare('UPDATE note_folders SET name = ?, updated_at = ? WHERE id = ?')
      .run(mutation.name, nowIso, mutation.id)
    if (result.changes !== 1) {
      throw new Error(`Cannot rename folder ${mutation.id}: no persisted folder has that id`)
    }
    return this.readState()
  }

  deleteFolder(folderIdValue: string, nowIso: string): NotesState {
    const folderId = parseNoteId(folderIdValue, 'folder id')
    const parent = this.database
      .prepare('SELECT parent_folder_id FROM note_folders WHERE id = ?')
      .get(folderId) as { parent_folder_id: string | null } | undefined
    if (parent === undefined) {
      throw new Error(`Cannot delete folder ${folderId}: no persisted folder has that id`)
    }
    this.transaction(() => {
      this.database
        .prepare('UPDATE note_folders SET parent_folder_id = ?, updated_at = ? WHERE parent_folder_id = ?')
        .run(parent.parent_folder_id, nowIso, folderId)
      this.database
        .prepare('UPDATE note_pages SET folder_id = ?, updated_at = ? WHERE folder_id = ?')
        .run(parent.parent_folder_id, nowIso, folderId)
      this.database.prepare('DELETE FROM note_folders WHERE id = ?').run(folderId)
    })
    return this.readState()
  }

  createPage(draftValue: NotePageDraft, nowIso: string): NotesState {
    const draft = parseNotePageDraft(draftValue)
    this.assertFolderExists(draft.folderId)
    this.assertPageExists(draft.parentPageId)
    const page = parseNotePage({
      id: `note-${randomUUID()}`,
      ...draft,
      favorite: false,
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastOpenedAt: nowIso,
      archivedAt: null,
      deletedAt: null
    })
    this.insertPage(page)
    return this.readState()
  }

  updatePage(mutationValue: NotePageContentUpdate, nowIso: string): NotePage {
    const mutation = parseNotePageContentUpdate(mutationValue)
    const result = this.database
      .prepare('UPDATE note_pages SET title = ?, content_json = ?, updated_at = ? WHERE id = ?')
      .run(mutation.title, mutation.contentJson, nowIso, mutation.id)
    if (result.changes !== 1) {
      throw new Error(`Cannot save note ${mutation.id}: no persisted note has that id`)
    }
    return this.readPage(mutation.id)
  }

  touchPage(pageIdValue: string, nowIso: string): NotePage {
    const pageId = parseNoteId(pageIdValue, 'note id')
    const result = this.database
      .prepare('UPDATE note_pages SET last_opened_at = ? WHERE id = ?')
      .run(nowIso, pageId)
    if (result.changes !== 1) {
      throw new Error(`Cannot open note ${pageId}: no persisted note has that id`)
    }
    return this.readPage(pageId)
  }

  movePage(mutationValue: NotePageMove, nowIso: string): NotesState {
    const mutation = parseNotePageMove(mutationValue)
    this.assertPageExists(mutation.id)
    this.assertFolderExists(mutation.folderId)
    this.assertPageExists(mutation.parentPageId)
    if (mutation.parentPageId === mutation.id || this.descendantIds(mutation.id).has(mutation.parentPageId ?? '')) {
      throw new Error(`Cannot move note ${mutation.id} into itself or one of its descendants`)
    }
    const result = this.database
      .prepare('UPDATE note_pages SET folder_id = ?, parent_page_id = ?, updated_at = ? WHERE id = ?')
      .run(mutation.folderId, mutation.parentPageId, nowIso, mutation.id)
    if (result.changes !== 1) {
      throw new Error(`Cannot move note ${mutation.id}: no persisted note has that id`)
    }
    return this.readState()
  }

  duplicatePage(pageIdValue: string, nowIso: string): NotesState {
    const pageId = parseNoteId(pageIdValue, 'note id')
    const source = this.readPage(pageId)
    const createdFiles: string[] = []
    try {
      this.transaction(() => {
        this.duplicateTree(source, source.parentPageId, nowIso, true, createdFiles)
      })
    } catch (error) {
      createdFiles.forEach((relativePath) => unlinkSync(join(this.attachmentRoot, relativePath)))
      throw error
    }
    return this.readState()
  }

  setFavorite(mutationValue: NotePageFavoriteMutation, nowIso: string): NotesState {
    const mutation = parseNotePageFavoriteMutation(mutationValue)
    const result = this.database
      .prepare('UPDATE note_pages SET favorite = ?, updated_at = ? WHERE id = ?')
      .run(mutation.favorite ? 1 : 0, nowIso, mutation.id)
    if (result.changes !== 1) {
      throw new Error(`Cannot favorite note ${mutation.id}: no persisted note has that id`)
    }
    return this.readState()
  }

  archivePage(pageIdValue: string, nowIso: string): NotesState {
    return this.setTreeStatus(pageIdValue, 'archived', nowIso)
  }

  trashPage(pageIdValue: string, nowIso: string): NotesState {
    return this.setTreeStatus(pageIdValue, 'trash', nowIso)
  }

  restorePage(pageIdValue: string, nowIso: string): NotesState {
    return this.setTreeStatus(pageIdValue, 'active', nowIso)
  }

  permanentlyDeletePage(pageIdValue: string): NotesState {
    const pageId = parseNoteId(pageIdValue, 'note id')
    const page = this.readPage(pageId)
    if (page.status !== 'trash') {
      throw new Error(`Cannot permanently delete note ${pageId}: move it to Trash first`)
    }
    const treeIds = [pageId, ...this.descendantIds(pageId)]
    const attachmentPaths = treeIds.flatMap((id) => this.readAttachmentRows(id).map((row) => row.relative_path))
    const result = this.database.prepare('DELETE FROM note_pages WHERE id = ?').run(pageId)
    if (result.changes !== 1) {
      throw new Error(`Cannot permanently delete note ${pageId}: no persisted note has that id`)
    }
    attachmentPaths.forEach((relativePath) => unlinkSync(join(this.attachmentRoot, relativePath)))
    return this.readState()
  }

  uploadAttachment(uploadValue: NoteAttachmentUpload, nowIso: string): NoteAttachment {
    const upload = parseNoteAttachmentUpload(uploadValue)
    this.assertPageExists(upload.noteId)
    const id = `note-attachment-${randomUUID()}`
    const suffix = safeExtension(upload.name)
    const relativePath = `${id}${suffix}`
    writeFileSync(join(this.attachmentRoot, relativePath), upload.bytes, { flag: 'wx' })
    const attachment = parseNoteAttachment({
      id,
      noteId: upload.noteId,
      name: upload.name,
      mimeType: upload.mimeType,
      size: upload.bytes.byteLength,
      stableUrl: `manor-attachment://${id}`,
      createdAt: nowIso
    })
    this.database
      .prepare(`
        INSERT INTO note_attachments (id, note_id, name, mime_type, size, relative_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, upload.noteId, upload.name, upload.mimeType, upload.bytes.byteLength, relativePath, nowIso)
    return attachment
  }

  resolveAttachment(attachmentIdValue: string): string {
    const attachmentId = parseNoteId(attachmentIdValue, 'attachment id')
    const row = this.database
      .prepare('SELECT id, note_id, name, mime_type, size, relative_path, created_at FROM note_attachments WHERE id = ?')
      .get(attachmentId) as AttachmentRow | undefined
    if (row === undefined) {
      throw new Error(`Cannot resolve attachment ${attachmentId}: no persisted attachment has that id`)
    }
    const bytes = readFileSync(join(this.attachmentRoot, row.relative_path))
    if (bytes.byteLength !== row.size) {
      throw new Error(`Cannot resolve attachment ${attachmentId}: persisted file size does not match metadata`)
    }
    return `data:${row.mime_type};base64,${bytes.toString('base64')}`
  }

  /** Whether the store has ever been seeded or hydrated. */
  initialized(): boolean {
    return (
      this.database
        .prepare("SELECT value FROM notes_metadata WHERE key = 'initialized'")
        .get() !== undefined
    )
  }

  /** Current persisted folders and pages, for the sync engine's push.
      Attachments are local-only and excluded from sync. */
  snapshot(): NotesState {
    return this.readState()
  }

  /** Replace folders and pages with cloud state (sync pull). Pages are
      upserted rather than delete-and-reinserted so ON DELETE CASCADE does not
      wipe the local-only note_attachments rows of pages that survive. */
  replaceAll(stateValue: NotesState): NotesState {
    const state = parseNotesSeed(stateValue)
    this.transaction(() => {
      // Incoming rows can reference parents in any order; check FKs at commit.
      this.database.exec('PRAGMA defer_foreign_keys = ON')
      this.deleteRowsNotIn('note_pages', state.pages.map((page) => page.id))
      this.deleteRowsNotIn('note_folders', state.folders.map((folder) => folder.id))
      const upsertFolder = this.database.prepare(`
        INSERT INTO note_folders (id, name, parent_folder_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          parent_folder_id = excluded.parent_folder_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      state.folders.forEach((folder) =>
        upsertFolder.run(folder.id, folder.name, folder.parentFolderId, folder.createdAt, folder.updatedAt)
      )
      const upsertPage = this.database.prepare(`
        INSERT INTO note_pages (
          id, title, folder_id, parent_page_id, content_json, favorite, status,
          created_at, updated_at, last_opened_at, archived_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          folder_id = excluded.folder_id,
          parent_page_id = excluded.parent_page_id,
          content_json = excluded.content_json,
          favorite = excluded.favorite,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_opened_at = excluded.last_opened_at,
          archived_at = excluded.archived_at,
          deleted_at = excluded.deleted_at
      `)
      state.pages.forEach((page) =>
        upsertPage.run(
          page.id,
          page.title,
          page.folderId,
          page.parentPageId,
          page.contentJson,
          page.favorite ? 1 : 0,
          page.status,
          page.createdAt,
          page.updatedAt,
          page.lastOpenedAt,
          page.archivedAt,
          page.deletedAt
        )
      )
      this.database
        .prepare("INSERT OR REPLACE INTO notes_metadata (key, value) VALUES ('initialized', ?)")
        .run(new Date().toISOString())
    })
    return this.readState()
  }

  private deleteRowsNotIn(table: 'note_pages' | 'note_folders', ids: readonly string[]): void {
    if (ids.length === 0) {
      this.database.exec(`DELETE FROM ${table}`)
      return
    }
    const placeholders = ids.map(() => '?').join(', ')
    this.database
      .prepare(`DELETE FROM ${table} WHERE id NOT IN (${placeholders})`)
      .run(...ids)
  }

  private seed(seed: NotesSeed): void {
    seed.folders.forEach((folder) => this.insertFolder(folder))
    seed.pages.forEach((page) => this.insertPage(page))
    this.database
      .prepare("INSERT INTO notes_metadata (key, value) VALUES ('initialized', ?)")
      .run(new Date().toISOString())
  }

  private insertFolder(folder: NoteFolder): void {
    this.database
      .prepare(`
        INSERT INTO note_folders (id, name, parent_folder_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(folder.id, folder.name, folder.parentFolderId, folder.createdAt, folder.updatedAt)
  }

  private insertPage(page: NotePage): void {
    this.database
      .prepare(`
        INSERT INTO note_pages (
          id, title, folder_id, parent_page_id, content_json, favorite, status,
          created_at, updated_at, last_opened_at, archived_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        page.id,
        page.title,
        page.folderId,
        page.parentPageId,
        page.contentJson,
        page.favorite ? 1 : 0,
        page.status,
        page.createdAt,
        page.updatedAt,
        page.lastOpenedAt,
        page.archivedAt,
        page.deletedAt
      )
  }

  private duplicateTree(
    source: NotePage,
    parentPageId: string | null,
    nowIso: string,
    root: boolean,
    createdFiles: string[]
  ): string {
    const newId = `note-${randomUUID()}`
    const attachments = this.readAttachmentRows(source.id)
    let contentJson = source.contentJson
    const clonedAttachments = attachments.map((attachment) => {
      const attachmentId = `note-attachment-${randomUUID()}`
      const relativePath = `${attachmentId}${safeExtension(attachment.name)}`
      copyFileSync(
        join(this.attachmentRoot, attachment.relative_path),
        join(this.attachmentRoot, relativePath)
      )
      createdFiles.push(relativePath)
      contentJson = contentJson.replaceAll(
        `manor-attachment://${attachment.id}`,
        `manor-attachment://${attachmentId}`
      )
      return {
        ...attachment,
        id: attachmentId,
        note_id: newId,
        relative_path: relativePath,
        created_at: nowIso
      }
    })
    const copy = parseNotePage({
      ...source,
      id: newId,
      title: root ? `${source.title} copy` : source.title,
      parentPageId,
      contentJson,
      favorite: false,
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastOpenedAt: nowIso,
      archivedAt: null,
      deletedAt: null
    })
    this.insertPage(copy)
    clonedAttachments.forEach((attachment) => this.insertAttachmentRow(attachment))
    this.readChildren(source.id).forEach((child) =>
      this.duplicateTree(child, newId, nowIso, false, createdFiles)
    )
    return newId
  }

  private readAttachmentRows(noteId: string): AttachmentRow[] {
    return this.database
      .prepare('SELECT id, note_id, name, mime_type, size, relative_path, created_at FROM note_attachments WHERE note_id = ? ORDER BY created_at, id')
      .all(noteId) as unknown as AttachmentRow[]
  }

  private insertAttachmentRow(row: AttachmentRow): void {
    this.database
      .prepare(`
        INSERT INTO note_attachments (id, note_id, name, mime_type, size, relative_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(row.id, row.note_id, row.name, row.mime_type, row.size, row.relative_path, row.created_at)
  }

  private setTreeStatus(pageIdValue: string, status: NotePage['status'], nowIso: string): NotesState {
    const pageId = parseNoteId(pageIdValue, 'note id')
    this.assertPageExists(pageId)
    const archivedAt = status === 'archived' ? nowIso : null
    const deletedAt = status === 'trash' ? nowIso : null
    this.database
      .prepare(`
        WITH RECURSIVE tree(id) AS (
          SELECT id FROM note_pages WHERE id = ?
          UNION ALL
          SELECT page.id FROM note_pages page JOIN tree ON page.parent_page_id = tree.id
        )
        UPDATE note_pages
        SET status = ?, archived_at = ?, deleted_at = ?, updated_at = ?
        WHERE id IN (SELECT id FROM tree)
      `)
      .run(pageId, status, archivedAt, deletedAt, nowIso)
    return this.readState()
  }

  private descendantIds(pageId: string): Set<string> {
    const rows = this.database
      .prepare(`
        WITH RECURSIVE tree(id) AS (
          SELECT id FROM note_pages WHERE parent_page_id = ?
          UNION ALL
          SELECT page.id FROM note_pages page JOIN tree ON page.parent_page_id = tree.id
        )
        SELECT id FROM tree
      `)
      .all(pageId) as unknown as { id: string }[]
    return new Set(rows.map((row) => row.id))
  }

  private readChildren(parentPageId: string): NotePage[] {
    const rows = this.database
      .prepare('SELECT * FROM note_pages WHERE parent_page_id = ? ORDER BY created_at, id')
      .all(parentPageId) as unknown as PageRow[]
    return rows.map(pageFromRow)
  }

  private assertFolderExists(folderId: string | null): void {
    if (folderId === null) {
      return
    }
    const row = this.database.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId)
    if (row === undefined) {
      throw new Error(`No persisted note folder has id ${folderId}`)
    }
  }

  private assertPageExists(pageId: string | null): void {
    if (pageId === null) {
      return
    }
    const row = this.database.prepare('SELECT id FROM note_pages WHERE id = ?').get(pageId)
    if (row === undefined) {
      throw new Error(`No persisted note has id ${pageId}`)
    }
  }

  private readPage(pageId: string): NotePage {
    const row = this.database.prepare('SELECT * FROM note_pages WHERE id = ?').get(pageId) as PageRow | undefined
    if (row === undefined) {
      throw new Error(`No persisted note has id ${pageId}`)
    }
    return pageFromRow(row)
  }

  private readState(): NotesState {
    const folders = this.database
      .prepare('SELECT * FROM note_folders ORDER BY name COLLATE NOCASE, id')
      .all() as unknown as FolderRow[]
    const pages = this.database
      .prepare('SELECT * FROM note_pages ORDER BY updated_at DESC, id')
      .all() as unknown as PageRow[]
    return { folders: folders.map(folderFromRow), pages: pages.map(pageFromRow) }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      operation()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

function folderFromRow(row: FolderRow): NoteFolder {
  return parseNoteFolder({
    id: row.id,
    name: row.name,
    parentFolderId: row.parent_folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function pageFromRow(row: PageRow): NotePage {
  return parseNotePage({
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    parentPageId: row.parent_page_id,
    contentJson: row.content_json,
    favorite: row.favorite === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at
  })
}

function safeExtension(name: string): string {
  const extension = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}
