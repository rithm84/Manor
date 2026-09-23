import { ArchiveRestore, ChevronRight, Copy, ExternalLink, FilePlus2, FileText, Star, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import type { NotePage } from '../../../shared/notes'
import { EmptyState } from '../../components/ui/EmptyState'
import { QuickActionsMenu } from '../../components/ui/QuickActionsMenu'
import type { QuickActionItem, QuickActionPoint } from '../../components/ui'
import { NotesPaneToggle } from './NotesPaneToggle'
import { formatNoteTime } from './notesModel'
import { clickSelection, selectAll, selectOne, selectRange } from './notesSelection'
import type { NoteSelection } from './notesSelection'

export interface NoteListRow {
  page: NotePage
  depth: number
}

export interface NotesListProps {
  rows: readonly NoteListRow[]
  title: string
  loading: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Whether this scope creates notes (Trash and Archived do not). */
  canCreate: boolean
  /** A note is being created; the create controls wait for it rather than starting another. */
  creating?: boolean
  onCreate: () => void
  /** The note open in the editor. */
  openId: string | null
  selection: NoteSelection
  onSelectionChange: (next: NoteSelection) => void
  onOpen: (pageId: string) => void
  onTrash: (pageIds: readonly string[]) => void
  onRestore: (pageIds: readonly string[]) => void
  /** Asks the page to confirm and permanently delete notes already in Trash. */
  onPurge: (pageIds: readonly string[]) => void
  onToggleFavorite: (page: NotePage) => void
  onDuplicate: (pageId: string) => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const toggleModifier = (event: { metaKey: boolean; ctrlKey: boolean }): boolean => (isMac ? event.metaKey : event.ctrlKey)

/**
 * The note list: plain click opens, Shift selects a range, Cmd or Ctrl toggles rows, Cmd or Ctrl+A selects the scope,
 * Escape clears, Delete moves the selection to Trash (or deletes permanently inside Trash), and right-click shows actions.
 */
export function NotesList({ rows, title, loading, collapsed, onToggleCollapsed, canCreate, creating = false, onCreate, openId, selection, onSelectionChange, onOpen, onTrash, onRestore, onPurge, onToggleFavorite, onDuplicate }: NotesListProps): ReactNode {
  const [menu, setMenu] = useState<{ point: QuickActionPoint; page: NotePage } | null>(null)
  const order = rows.map((row) => row.page.id)
  const selected = new Set(selection.ids)
  const inTrash = rows.length > 0 && rows.every((row) => row.page.status === 'trash')

  useEffect(() => { if (menu !== null && !rows.some((row) => row.page.id === menu.page.id)) setMenu(null) }, [menu, rows])

  /** Rows an action applies to: the whole selection when the row is part of it, otherwise just that row. */
  const targets = (page: NotePage): readonly string[] => (selected.has(page.id) && selection.ids.length > 1 ? selection.ids : [page.id])

  const clickRow = (event: ReactMouseEvent<HTMLButtonElement>, page: NotePage): void => {
    const modifiers = { range: event.shiftKey, toggle: toggleModifier(event) }
    if (modifiers.range || modifiers.toggle) { event.preventDefault(); onSelectionChange(clickSelection(selection, order, page.id, modifiers)); return }
    onSelectionChange(selectOne(page.id))
    onOpen(page.id)
  }

  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>, page: NotePage): void => {
    event.preventDefault()
    if (!selected.has(page.id)) onSelectionChange(selectOne(page.id))
    setMenu({ point: { x: event.clientX, y: event.clientY, source: 'pointer' }, page })
  }

  const keyRow = (event: ReactKeyboardEvent<HTMLButtonElement>, page: NotePage, index: number): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1]
      if (next === undefined) return
      document.querySelector<HTMLElement>(`[data-note-index="${event.key === 'ArrowDown' ? index + 1 : index - 1}"]`)?.focus()
      if (event.shiftKey) onSelectionChange(selectRange(selection.anchor === null ? selectOne(page.id) : selection, order, next.page.id))
      return
    }
    if (event.key === 'a' && toggleModifier(event)) { event.preventDefault(); onSelectionChange(selectAll(order)); return }
    if (event.key === 'Escape' && selection.ids.length > 0) { event.preventDefault(); onSelectionChange(openId === null ? { ids: [], anchor: null } : selectOne(openId)); return }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const ids = targets(page)
      if (page.status === 'trash') onPurge(ids)
      else onTrash(ids)
    }
  }

  const menuItems = (page: NotePage): QuickActionItem[] => {
    const ids = targets(page)
    const many = ids.length > 1
    const items: QuickActionItem[] = []
    if (!many) items.push({ id: 'open', label: 'Open', icon: <ExternalLink size={14} />, tone: 'default', onSelect: () => onOpen(page.id) })
    if (page.status === 'active' && !many) {
      items.push({ id: 'favorite', label: page.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Star size={14} />, tone: 'default', onSelect: () => onToggleFavorite(page) })
      items.push({ id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, tone: 'default', onSelect: () => onDuplicate(page.id) })
    }
    if (page.status !== 'trash') items.push({ id: 'trash', label: many ? `Move ${ids.length} notes to Trash` : 'Move to Trash', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => onTrash(ids) })
    if (page.status !== 'active') items.push({ id: 'restore', label: many ? `Restore ${ids.length} notes` : 'Restore', icon: <ArchiveRestore size={14} />, tone: 'default', onSelect: () => onRestore(ids) })
    if (page.status === 'trash') items.push({ id: 'purge', label: many ? `Delete ${ids.length} notes permanently` : 'Delete permanently', icon: <Trash2 size={14} />, tone: 'danger', onSelect: () => onPurge(ids) })
    return items
  }

  return (
    <section id="notes-list" className={`notes-list${collapsed ? ' is-collapsed' : ''}`} aria-label="Note list">
      <div className="notes-list-head">
        <div className="notes-list-heading"><strong>{title}</strong><span>{rows.length}</span></div>
        <div className="notes-pane-actions">
          {!collapsed && canCreate ? <button type="button" className="notes-icon-button" aria-label="New note" aria-busy={creating} disabled={creating} onClick={onCreate}><FilePlus2 size={16} /></button> : null}
          <NotesPaneToggle collapsed={collapsed} panelId="notes-list" label="note list" onToggle={onToggleCollapsed} />
        </div>
      </div>
      {selection.ids.length > 1 ? (
        <div className="notes-batch-bar" role="toolbar" aria-label="Selected notes">
          <span>{selection.ids.length} selected</span>
          {inTrash ? <button type="button" onClick={() => onRestore(selection.ids)}><ArchiveRestore size={13} />Restore</button> : null}
          {inTrash ? <button type="button" className="is-danger" onClick={() => onPurge(selection.ids)}><Trash2 size={13} />Delete permanently</button> : null}
          {!inTrash ? <button type="button" className="is-danger" onClick={() => onTrash(selection.ids)}><Trash2 size={13} />Move to Trash</button> : null}
          <button type="button" className="notes-batch-clear" aria-label="Clear selection" onClick={() => onSelectionChange(openId === null ? { ids: [], anchor: null } : selectOne(openId))}><X size={14} /></button>
        </div>
      ) : null}
      <div className="notes-list-scroll" role="listbox" aria-multiselectable="true" aria-label={title}>
        {loading ? <p className="notes-list-empty">Loading notes…</p> : null}
        {!loading && rows.length === 0 ? (
          <div className="notes-list-empty">
            <EmptyState icon={<FileText size={20} strokeWidth={1.5} />} title={canCreate ? 'Nothing here yet' : 'Nothing here'} message={canCreate ? 'Start a note and it appears in this list.' : 'Notes you move here appear in this list.'}
              action={canCreate ? <button type="button" className="notes-list-empty-action" disabled={creating} onClick={onCreate}><FilePlus2 size={14} />New note</button> : undefined} />
          </div>
        ) : null}
        {rows.map(({ page, depth }, index) => (
          <div key={page.id} className="notes-list-rowwrap">
            <button type="button" role="option" aria-selected={selected.has(page.id)} data-note-index={index} data-note-id={page.id}
              className={`notes-list-row${openId === page.id ? ' is-selected' : ''}${selected.has(page.id) ? ' is-checked' : ''}`}
              style={{ paddingLeft: `${12 + Math.min(depth, 4) * 14}px` }}
              onClick={(event) => clickRow(event, page)} onContextMenu={(event) => openMenu(event, page)} onKeyDown={(event) => keyRow(event, page, index)}>
              <span className="notes-list-title">{depth > 0 ? <ChevronRight size={12} /> : null}{page.title || 'Untitled'}</span>
              <span className="notes-list-meta">{formatNoteTime(page.updatedAt)}{page.favorite ? <Star size={11} fill="currentColor" /> : null}</span>
            </button>
            <button type="button" className={`notes-list-delete${page.status === 'trash' ? ' is-permanent' : ''}`}
              aria-label={page.status === 'trash' ? `Delete ${page.title || 'Untitled'} permanently` : `Move ${page.title || 'Untitled'} to Trash`}
              title={page.status === 'trash' ? 'Delete permanently' : 'Move to Trash'}
              onClick={() => (page.status === 'trash' ? onPurge(targets(page)) : onTrash(targets(page)))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      {menu !== null ? <QuickActionsMenu point={menu.point} label={menu.page.title || 'Untitled'} items={menuItems(menu.page)} onClose={() => setMenu(null)} /> : null}
    </section>
  )
}
