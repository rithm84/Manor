import { describe, expect, it } from 'vitest'

import type { NotePage } from '../../../shared/notes'
import { importedNoteTitle, pagesForScope, searchableNoteText, treeRows } from './notesModel'

function page(id: string, parentPageId: string | null, title: string, content: string): NotePage {
  return {
    id,
    title,
    folderId: 'folder',
    parentPageId,
    contentJson: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: content }] }]),
    favorite: id === 'parent',
    status: 'active',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    lastOpenedAt: '2026-08-22T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null
  }
}

describe('notes workspace model', () => {
  const parent = page('parent', null, 'Algorithms', 'Dijkstra shortest path')
  const child = page('child', 'parent', 'Proof', 'priority queue')

  it('searches user-authored block content rather than JSON property names', () => {
    expect(searchableNoteText(parent)).toContain('dijkstra shortest path')
    expect(pagesForScope([parent, child], 'all', 'priority')).toEqual([child])
  })

  it('keeps nested page order in the primary note list', () => {
    expect(treeRows([parent, child])).toEqual([
      { page: parent, depth: 0 },
      { page: child, depth: 1 }
    ])
  })

  it('filters favorites without losing page content', () => {
    expect(pagesForScope([parent, child], 'favorites', '')).toEqual([parent])
  })

  it('titles imported files from their names, trimming Notion export ids', () => {
    expect(importedNoteTitle('Weekly review.md')).toBe('Weekly review')
    expect(importedNoteTitle('CS 180 Notes 8f3a2b1c9d4e5f60718293a4b5c6d7e8.md')).toBe('CS 180 Notes')
    expect(importedNoteTitle('README.markdown')).toBe('README')
    expect(importedNoteTitle('.md')).toBe('Imported note')
  })
})
