/**
 * One row the local mirror re-read or removed after a pull. The `manor:committed` event carries these for
 * `remote_change`, so a page can tell a change it already holds (its own save, an opening recorded elsewhere)
 * from one that needs a reload.
 */
export interface WorkspaceRowChange {
  readonly table: string
  /** The row id, or null when the table has no id column or the mirror re-read the whole table. */
  readonly id: string | null
  readonly revision: number | null
  readonly action: 'remove' | 'reread'
}

export interface CommittedDetail {
  readonly operation: string
  readonly commandId?: string
  /** Present for `remote_change` pulls that could name what moved; absent means "assume anything did". */
  readonly changes?: readonly WorkspaceRowChange[]
}

export function committedDetail(event: Event): CommittedDetail | null {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (typeof detail !== 'object' || detail === null || !('operation' in detail) || typeof detail.operation !== 'string') return null
  return detail as CommittedDetail
}

/**
 * Whether a pull touched anything the Notes workspace has not already applied. A note whose revision the
 * device knows (or has passed) is its own save or an opening; a folder change, a removal, a whole-table
 * re-read, or a revision ahead of the device means a reload.
 */
export function notesNeedReload(changes: readonly WorkspaceRowChange[] | undefined, knownRevision: (noteId: string) => number | null): boolean {
  if (changes === undefined) return true
  return changes.some((change) => {
    if (change.table === 'note_folders') return true
    if (change.table !== 'note_pages') return false
    if (change.action === 'remove' || change.id === null || change.revision === null) return true
    const known = knownRevision(change.id)
    return known === null || change.revision > known
  })
}
