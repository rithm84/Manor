import { describe, expect, it } from 'vitest'

import {
  parseNoteAttachmentUpload,
  parseNoteContentJson,
  parseNotePageMove,
  parseNotesSeed
} from './notes'

describe('notes validation', () => {
  it('accepts native block arrays and rejects invalid or object-shaped documents', () => {
    expect(parseNoteContentJson('[{"type":"paragraph","content":"Hello"}]')).toContain('paragraph')
    expect(() => parseNoteContentJson('{"type":"paragraph"}')).toThrow(/top-level block array/)
    expect(() => parseNoteContentJson('not json')).toThrow(/valid JSON/)
  })

  it('validates seed ids and typed move targets', () => {
    const base = {
      folders: [],
      pages: [
        {
          id: 'note-a',
          title: 'A',
          folderId: null,
          parentPageId: null,
          contentJson: '[]',
          favorite: false,
          status: 'active',
          createdAt: '2026-08-22T00:00:00.000Z',
          updatedAt: '2026-08-22T00:00:00.000Z',
          lastOpenedAt: '2026-08-22T00:00:00.000Z',
          archivedAt: null,
          deletedAt: null
        }
      ]
    }
    expect(parseNotesSeed(base).pages[0]?.id).toBe('note-a')
    expect(() => parseNotesSeed({ ...base, pages: [...base.pages, ...base.pages] })).toThrow(/unique/)
    expect(parseNotePageMove({ id: 'note-a', folderId: null, parentPageId: null })).toEqual({
      id: 'note-a',
      folderId: null,
      parentPageId: null
    })
  })

  it('enforces typed attachment bytes and the local size boundary', () => {
    expect(
      parseNoteAttachmentUpload({
        noteId: 'note-a',
        name: 'figure.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3])
      }).bytes
    ).toBeInstanceOf(Uint8Array)
    expect(() =>
      parseNoteAttachmentUpload({
        noteId: 'note-a',
        name: 'figure.png',
        mimeType: 'image/png',
        bytes: [1, 2, 3]
      })
    ).toThrow(/Uint8Array/)
  })
})
