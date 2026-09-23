import { describe, expect, it } from 'vitest'
import { committedDetail, notesNeedReload, type WorkspaceRowChange } from './workspaceChanges'

const known = new Map<string, number>([['a', 5], ['b', 2]])
const knownRevision = (id: string): number | null => known.get(id) ?? null

function note(id: string | null, revision: number | null, action: WorkspaceRowChange['action'] = 'reread'): WorkspaceRowChange {
  return { table: 'note_pages', id, revision, action }
}

describe('notesNeedReload', () => {
  it('reloads when the pull could not say what moved', () => {
    expect(notesNeedReload(undefined, knownRevision)).toBe(true)
  })

  it('ignores a pull that touched nothing in Notes', () => {
    expect(notesNeedReload([], knownRevision)).toBe(false)
    expect(notesNeedReload([{ table: 'habits', id: 'h', revision: 9, action: 'reread' }], knownRevision)).toBe(false)
  })

  it('treats a revision the device already holds as its own echo', () => {
    expect(notesNeedReload([note('a', 5)], knownRevision)).toBe(false)
    expect(notesNeedReload([note('a', 4)], knownRevision)).toBe(false)
  })

  it('reloads for a revision ahead of the device or a note it has never seen', () => {
    expect(notesNeedReload([note('a', 6)], knownRevision)).toBe(true)
    expect(notesNeedReload([note('new', 1)], knownRevision)).toBe(true)
  })

  it('reloads for removals, whole-table re-reads, and rows without a revision', () => {
    expect(notesNeedReload([note('a', 5, 'remove')], knownRevision)).toBe(true)
    expect(notesNeedReload([note(null, null)], knownRevision)).toBe(true)
    expect(notesNeedReload([note('a', null)], knownRevision)).toBe(true)
  })

  it('always reloads for folder changes', () => {
    expect(notesNeedReload([{ table: 'note_folders', id: 'f', revision: 1, action: 'reread' }], knownRevision)).toBe(true)
  })
})

describe('committedDetail', () => {
  it('reads the operation and changes from the committed event', () => {
    const changes = [note('a', 5)]
    const event = new CustomEvent('manor:committed', { detail: { operation: 'remote_change', changes } })
    expect(committedDetail(event)).toEqual({ operation: 'remote_change', changes })
  })

  it('rejects events without an operation', () => {
    expect(committedDetail(new Event('manor:committed'))).toBeNull()
    expect(committedDetail(new CustomEvent('manor:committed', { detail: { changes: [] } }))).toBeNull()
  })
})
