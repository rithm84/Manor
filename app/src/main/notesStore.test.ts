import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import { NotesStore } from './notesStore'
import type { NotesSeed } from '../shared/notes'

const now = '2026-08-22T20:00:00.000Z'
const seed: NotesSeed = {
  folders: [
    {
      id: 'folder-course',
      name: 'Course',
      parentFolderId: null,
      createdAt: now,
      updatedAt: now
    }
  ],
  pages: [
    {
      id: 'page-root',
      title: 'Root',
      folderId: 'folder-course',
      parentPageId: null,
      contentJson: '[{"id":"block-a","type":"paragraph","content":"Exact  spacing"}]',
      favorite: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      archivedAt: null,
      deletedAt: null
    },
    {
      id: 'page-child',
      title: 'Child',
      folderId: 'folder-course',
      parentPageId: 'page-root',
      contentJson: '[]',
      favorite: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      archivedAt: null,
      deletedAt: null
    }
  ]
}

const stores: NotesStore[] = []

function makeStore(): NotesStore {
  const root = mkdtempSync(join(tmpdir(), 'manor-notes-'))
  const store = new NotesStore(join(root, 'notes.sqlite'), join(root, 'attachments'))
  stores.push(store)
  return store
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
})

describe('NotesStore', () => {
  it('seeds once and preserves exact native block JSON on autosave', () => {
    const store = makeStore()
    expect(store.load(seed).pages).toHaveLength(2)
    const changed = store.updatePage(
      {
        id: 'page-root',
        title: 'Renamed',
        contentJson: '[{"id":"code","type":"codeBlock","content":[{"type":"text","text":"a  b\\n# comment","styles":{}}]}]'
      },
      '2026-08-22T20:01:00.000Z'
    )
    expect(changed.contentJson).toContain('a  b\\n# comment')
    expect(store.load({ folders: [], pages: [] }).pages).toHaveLength(2)
  })

  it('propagates save failures instead of masking them', () => {
    const store = makeStore()
    store.load(seed)
    expect(() =>
      store.updatePage(
        { id: 'missing', title: 'No note', contentJson: '[]' },
        '2026-08-22T20:01:00.000Z'
      )
    ).toThrow(/Cannot save note missing/)
  })

  it('moves, duplicates, archives, trashes, restores, and permanently deletes page trees', () => {
    const store = makeStore()
    store.load(seed)
    expect(store.duplicatePage('page-root', '2026-08-22T20:02:00.000Z').pages).toHaveLength(4)
    expect(store.archivePage('page-root', '2026-08-22T20:03:00.000Z').pages.filter((page) => page.status === 'archived')).toHaveLength(2)
    expect(store.restorePage('page-root', '2026-08-22T20:04:00.000Z').pages.filter((page) => page.status === 'active')).toHaveLength(4)
    expect(store.trashPage('page-root', '2026-08-22T20:05:00.000Z').pages.filter((page) => page.status === 'trash')).toHaveLength(2)
    expect(store.permanentlyDeletePage('page-root').pages).toHaveLength(2)
  })

  it('creates, renames, and removes folders without deleting their notes', () => {
    const store = makeStore()
    store.load(seed)
    const createdState = store.createFolder(
      { name: 'Research', parentFolderId: null },
      '2026-08-22T20:02:00.000Z'
    )
    const created = createdState.folders.find((folder) => folder.name === 'Research')
    expect(created).toBeDefined()
    const renamed = store.renameFolder(
      { id: created!.id, name: 'Reading' },
      '2026-08-22T20:03:00.000Z'
    )
    expect(renamed.folders.find((folder) => folder.id === created!.id)?.name).toBe('Reading')
    expect(store.deleteFolder(created!.id, '2026-08-22T20:04:00.000Z').pages).toHaveLength(2)
  })

  it('stores attachments under a stable id and resolves their bytes', () => {
    const store = makeStore()
    store.load(seed)
    const attachment = store.uploadAttachment(
      {
        noteId: 'page-root',
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
      },
      '2026-08-22T20:06:00.000Z'
    )
    expect(attachment.stableUrl).toBe(`manor-attachment://${attachment.id}`)
    expect(store.resolveAttachment(attachment.id)).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('clones attachment ownership when duplicating a page tree', () => {
    const store = makeStore()
    store.load(seed)
    const sourceAttachment = store.uploadAttachment(
      {
        noteId: 'page-root',
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
      },
      '2026-08-22T20:06:00.000Z'
    )
    store.updatePage(
      {
        id: 'page-root',
        title: 'Root',
        contentJson: JSON.stringify([{
          type: 'image',
          props: { url: sourceAttachment.stableUrl, name: 'diagram.svg' },
          content: [],
          children: []
        }])
      },
      '2026-08-22T20:07:00.000Z'
    )
    const duplicated = store.duplicatePage('page-root', '2026-08-22T20:08:00.000Z')
      .pages.find((page) => page.title === 'Root copy')
    expect(duplicated).toBeDefined()
    const duplicateAttachmentId = duplicated!.contentJson.match(/manor-attachment:\/\/([^"\\]+)/)?.[1]
    expect(duplicateAttachmentId).toBeDefined()
    expect(duplicateAttachmentId).not.toBe(sourceAttachment.id)

    store.trashPage('page-root', '2026-08-22T20:09:00.000Z')
    store.permanentlyDeletePage('page-root')
    expect(() => store.resolveAttachment(sourceAttachment.id)).toThrow(/no persisted attachment/)
    expect(store.resolveAttachment(duplicateAttachmentId!)).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
