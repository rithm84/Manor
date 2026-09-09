export type NotePageStatus = 'active' | 'archived' | 'trash'

export interface NoteFolder {
  id: string
  name: string
  parentFolderId: string | null
  createdAt: string
  updatedAt: string
}

export interface NotePage {
  id: string
  title: string
  folderId: string | null
  parentPageId: string | null
  contentJson: string
  favorite: boolean
  status: NotePageStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  archivedAt: string | null
  deletedAt: string | null
}

export interface NoteAttachment {
  id: string
  noteId: string
  name: string
  mimeType: string
  size: number
  stableUrl: string
  createdAt: string
}

export interface NotesState {
  folders: readonly NoteFolder[]
  pages: readonly NotePage[]
}

export interface NotesSeed extends NotesState {}

export interface NoteFolderDraft {
  name: string
  parentFolderId: string | null
}

export interface NoteFolderRename {
  id: string
  name: string
}

export interface NotePageDraft {
  title: string
  folderId: string | null
  parentPageId: string | null
  contentJson: string
}

export interface NotePageContentUpdate {
  id: string
  title: string
  contentJson: string
}

export interface NotePageMove {
  id: string
  folderId: string | null
  parentPageId: string | null
}

export interface NotePageFavoriteMutation {
  id: string
  favorite: boolean
}

export interface NoteAttachmentUpload {
  noteId: string
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface NotesApi {
  load: () => Promise<NotesState>
  createFolder: (draft: NoteFolderDraft) => Promise<NotesState>
  renameFolder: (mutation: NoteFolderRename) => Promise<NotesState>
  deleteFolder: (folderId: string) => Promise<NotesState>
  createPage: (draft: NotePageDraft) => Promise<NotesState>
  updatePage: (mutation: NotePageContentUpdate) => Promise<NotePage>
  touchPage: (pageId: string) => Promise<NotePage>
  movePage: (mutation: NotePageMove) => Promise<NotesState>
  duplicatePage: (pageId: string) => Promise<NotesState>
  setFavorite: (mutation: NotePageFavoriteMutation) => Promise<NotesState>
  archivePage: (pageId: string) => Promise<NotesState>
  trashPage: (pageId: string) => Promise<NotesState>
  restorePage: (pageId: string) => Promise<NotesState>
  permanentlyDeletePage: (pageId: string) => Promise<NotesState>
  uploadAttachment: (upload: NoteAttachmentUpload) => Promise<NoteAttachment>
  resolveAttachment: (attachmentId: string) => Promise<string>
}

const MAX_TITLE_LENGTH = 300
const MAX_FOLDER_NAME_LENGTH = 120
const MAX_CONTENT_BYTES = 12 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function limitedString(value: unknown, label: string, maximum: number): string {
  const text = stringValue(value, label)
  if (text.length > maximum) {
    throw new RangeError(`${label} must be ${maximum} characters or fewer`)
  }
  return text
}

function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label)
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label)
}

function statusValue(value: unknown): NotePageStatus {
  if (value !== 'active' && value !== 'archived' && value !== 'trash') {
    throw new TypeError('note.status must be active, archived, or trash')
  }
  return value
}

export function parseNoteContentJson(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('note.contentJson must be a string')
  }
  if (new TextEncoder().encode(value).byteLength > MAX_CONTENT_BYTES) {
    throw new RangeError('note.contentJson must be 12 MB or smaller')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new TypeError(`note.contentJson must contain valid JSON: ${String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('note.contentJson must contain a top-level block array')
  }
  return value
}

export function parseNoteFolder(value: unknown): NoteFolder {
  const folder = recordValue(value, 'note folder')
  return {
    id: stringValue(folder.id, 'folder.id'),
    name: limitedString(folder.name, 'folder.name', MAX_FOLDER_NAME_LENGTH),
    parentFolderId: nullableId(folder.parentFolderId, 'folder.parentFolderId'),
    createdAt: timestampValue(folder.createdAt, 'folder.createdAt'),
    updatedAt: timestampValue(folder.updatedAt, 'folder.updatedAt')
  }
}

export function parseNotePage(value: unknown): NotePage {
  const page = recordValue(value, 'note page')
  if (typeof page.favorite !== 'boolean') {
    throw new TypeError('note.favorite must be a boolean')
  }
  return {
    id: stringValue(page.id, 'note.id'),
    title: limitedString(page.title, 'note.title', MAX_TITLE_LENGTH),
    folderId: nullableId(page.folderId, 'note.folderId'),
    parentPageId: nullableId(page.parentPageId, 'note.parentPageId'),
    contentJson: parseNoteContentJson(page.contentJson),
    favorite: page.favorite,
    status: statusValue(page.status),
    createdAt: timestampValue(page.createdAt, 'note.createdAt'),
    updatedAt: timestampValue(page.updatedAt, 'note.updatedAt'),
    lastOpenedAt: timestampValue(page.lastOpenedAt, 'note.lastOpenedAt'),
    archivedAt: nullableTimestamp(page.archivedAt, 'note.archivedAt'),
    deletedAt: nullableTimestamp(page.deletedAt, 'note.deletedAt')
  }
}

export function parseNotesSeed(value: unknown): NotesSeed {
  const seed = recordValue(value, 'notes seed')
  if (!Array.isArray(seed.folders) || !Array.isArray(seed.pages)) {
    throw new TypeError('notes seed folders and pages must be arrays')
  }
  const folders = seed.folders.map(parseNoteFolder)
  const pages = seed.pages.map(parseNotePage)
  assertUnique(folders.map((folder) => folder.id), 'notes seed folder ids')
  assertUnique(pages.map((page) => page.id), 'notes seed page ids')
  return { folders, pages }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must be unique`)
  }
}

export function parseNoteFolderDraft(value: unknown): NoteFolderDraft {
  const draft = recordValue(value, 'note folder draft')
  return {
    name: limitedString(draft.name, 'folder.name', MAX_FOLDER_NAME_LENGTH),
    parentFolderId: nullableId(draft.parentFolderId, 'folder.parentFolderId')
  }
}

export function parseNoteFolderRename(value: unknown): NoteFolderRename {
  const mutation = recordValue(value, 'note folder rename')
  return {
    id: stringValue(mutation.id, 'folder.id'),
    name: limitedString(mutation.name, 'folder.name', MAX_FOLDER_NAME_LENGTH)
  }
}

export function parseNotePageDraft(value: unknown): NotePageDraft {
  const draft = recordValue(value, 'note page draft')
  return {
    title: limitedString(draft.title, 'note.title', MAX_TITLE_LENGTH),
    folderId: nullableId(draft.folderId, 'note.folderId'),
    parentPageId: nullableId(draft.parentPageId, 'note.parentPageId'),
    contentJson: parseNoteContentJson(draft.contentJson)
  }
}

export function parseNotePageContentUpdate(value: unknown): NotePageContentUpdate {
  const mutation = recordValue(value, 'note page content update')
  return {
    id: stringValue(mutation.id, 'note.id'),
    title: limitedString(mutation.title, 'note.title', MAX_TITLE_LENGTH),
    contentJson: parseNoteContentJson(mutation.contentJson)
  }
}

export function parseNotePageMove(value: unknown): NotePageMove {
  const mutation = recordValue(value, 'note page move')
  return {
    id: stringValue(mutation.id, 'note.id'),
    folderId: nullableId(mutation.folderId, 'note.folderId'),
    parentPageId: nullableId(mutation.parentPageId, 'note.parentPageId')
  }
}

export function parseNotePageFavoriteMutation(value: unknown): NotePageFavoriteMutation {
  const mutation = recordValue(value, 'note favorite mutation')
  if (typeof mutation.favorite !== 'boolean') {
    throw new TypeError('note.favorite must be a boolean')
  }
  return { id: stringValue(mutation.id, 'note.id'), favorite: mutation.favorite }
}

export function parseNoteId(value: unknown, label: string): string {
  return stringValue(value, label)
}

export function parseNoteAttachment(value: unknown): NoteAttachment {
  const attachment = recordValue(value, 'note attachment')
  if (typeof attachment.size !== 'number' || !Number.isSafeInteger(attachment.size) || attachment.size < 0) {
    throw new TypeError('attachment.size must be a non-negative integer')
  }
  return {
    id: stringValue(attachment.id, 'attachment.id'),
    noteId: stringValue(attachment.noteId, 'attachment.noteId'),
    name: limitedString(attachment.name, 'attachment.name', 255),
    mimeType: limitedString(attachment.mimeType, 'attachment.mimeType', 200),
    size: attachment.size,
    stableUrl: stringValue(attachment.stableUrl, 'attachment.stableUrl'),
    createdAt: timestampValue(attachment.createdAt, 'attachment.createdAt')
  }
}

export function parseNoteAttachmentUpload(value: unknown): NoteAttachmentUpload {
  const upload = recordValue(value, 'note attachment upload')
  if (!(upload.bytes instanceof Uint8Array)) {
    throw new TypeError('attachment.bytes must be a Uint8Array')
  }
  if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new RangeError('attachment.bytes must contain between 1 byte and 25 MB')
  }
  return {
    noteId: stringValue(upload.noteId, 'attachment.noteId'),
    name: limitedString(upload.name, 'attachment.name', 255),
    mimeType: limitedString(upload.mimeType, 'attachment.mimeType', 200),
    bytes: upload.bytes
  }
}
