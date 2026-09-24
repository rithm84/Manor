import { Archive, ChevronDown, Clock3, Folder, FolderPlus, Library, Pencil, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { NoteFolder } from '../../../shared/notes'
import { useDismissLayer } from '../../components/ui/dismissLayer'
import type { NotesScope } from './notesModel'

export interface NotesScopeCounts {
  all: number
  favorites: number
  archived: number
  trash: number
  folder: (folderId: string) => number
}

interface NotesScopeMenuProps {
  scope: NotesScope
  folders: readonly NoteFolder[]
  counts: NotesScopeCounts
  onSelect: (scope: NotesScope) => void
  onNewFolder: () => void
  onRenameFolder: (folder: NoteFolder) => void
}

interface ScopeEntry { scope: NotesScope; label: string; icon: ReactNode; count: number | null }

function scopeIcon(scope: NotesScope, size: number): ReactNode {
  if (scope === 'all') return <Library size={size} />
  if (scope === 'favorites') return <Star size={size} />
  if (scope === 'recent') return <Clock3 size={size} />
  if (scope === 'archived') return <Archive size={size} />
  if (scope === 'trash') return <Trash2 size={size} />
  return <Folder size={size} />
}

/**
 * The one control that chooses what the note list shows: the fixed views and the folders, with counts,
 * in a menu anchored to the list header. Folders are created and renamed from here as well.
 */
export function NotesScopeMenu({ scope, folders, counts, onSelect, onNewFolder, onRenameFolder }: NotesScopeMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useDismissLayer(open, () => {
    setOpen(false)
    triggerRef.current?.focus()
  })

  useEffect(() => {
    if (!open) return
    const closeOnPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    return (): void => document.removeEventListener('pointerdown', closeOnPointer)
  }, [open])

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
  }, [open])

  const views: ScopeEntry[] = [
    { scope: 'all', label: 'All notes', icon: scopeIcon('all', 15), count: counts.all },
    { scope: 'favorites', label: 'Favorites', icon: scopeIcon('favorites', 15), count: counts.favorites },
    { scope: 'recent', label: 'Recent', icon: scopeIcon('recent', 15), count: null },
    { scope: 'archived', label: 'Archived', icon: scopeIcon('archived', 15), count: counts.archived },
    { scope: 'trash', label: 'Trash', icon: scopeIcon('trash', 15), count: counts.trash }
  ]
  const currentFolder = scope.startsWith('folder:') ? folders.find((folder) => `folder:${folder.id}` === scope) ?? null : null
  const currentLabel = currentFolder?.name ?? views.find((view) => view.scope === scope)?.label ?? 'All notes'

  const choose = (next: NotesScope): void => {
    setOpen(false)
    onSelect(next)
  }

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"], .notes-scope-new') ?? [])]
    const index = items.findIndex((item) => item === document.activeElement)
    if (index === -1) return
    event.preventDefault()
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className="notes-scope">
      <button ref={triggerRef} type="button" className="notes-scope-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`Showing ${currentLabel}. Choose what the list shows`} onClick={() => setOpen((current) => !current)}>
        {scopeIcon(scope, 15)}<strong>{currentLabel}</strong><ChevronDown size={14} className="notes-scope-chevron" />
      </button>
      {open ? (
        <div className="notes-scope-menu" role="menu" aria-label="Show" onKeyDown={moveFocus}>
          {views.map((view) => (
            <button key={view.scope} type="button" role="menuitemradio" aria-checked={scope === view.scope} className={`notes-nav-row${scope === view.scope ? ' is-selected' : ''}`} onClick={() => choose(view.scope)}>
              {view.icon}<span>{view.label}</span>{view.count !== null && view.count > 0 ? <span className="notes-nav-count">{view.count}</span> : null}
            </button>
          ))}
          <div className="notes-folder-heading"><span>Folders</span></div>
          {folders.length === 0 ? <p className="notes-scope-empty">No folders yet.</p> : null}
          {folders.map((folder) => {
            const folderScope = `folder:${folder.id}` as const
            return (
              <div className="notes-folder-row" key={folder.id}>
                <button type="button" role="menuitemradio" aria-checked={scope === folderScope} className={`notes-nav-row${scope === folderScope ? ' is-selected' : ''}`} onClick={() => choose(folderScope)}>
                  <Folder size={15} /><span>{folder.name}</span><span className="notes-nav-count">{counts.folder(folder.id)}</span>
                </button>
                <button type="button" className="notes-folder-edit" aria-label={`Rename ${folder.name}`} onClick={() => { setOpen(false); onRenameFolder(folder) }}><Pencil size={13} /></button>
              </div>
            )
          })}
          <button type="button" className="notes-nav-row notes-scope-new" onClick={() => { setOpen(false); onNewFolder() }}><FolderPlus size={15} /><span>New folder</span></button>
        </div>
      ) : null}
    </div>
  )
}
