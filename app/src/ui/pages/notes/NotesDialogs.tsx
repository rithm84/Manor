import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { NoteFolder, NotePage } from '../../../shared/notes'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'

/** Permanent deletion asks once; the count and the loss are stated plainly. */
export function PurgeDialog({ pageIds, onClose, onConfirm }: {
  pageIds: readonly string[] | null
  onClose: () => void
  onConfirm: (pageIds: readonly string[]) => Promise<void>
}): ReactNode {
  const count = pageIds?.length ?? 0
  return (
    <Modal open={pageIds !== null} onClose={onClose} width={440} ariaLabel="Delete permanently">
      <div className="notes-dialog">
        <div className="notes-dialog-head"><h2>{count === 1 ? 'Delete this note permanently?' : `Delete ${count} notes permanently?`}</h2><button type="button" onClick={onClose}><X size={17} /></button></div>
        <p>{count === 1 ? 'The note, its subpages, versions, and attachments are removed now. There is no way to get them back.' : 'These notes, their subpages, versions, and attachments are removed now. There is no way to get them back.'}</p>
        <div className="notes-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="is-danger" data-autofocus onClick={() => { if (pageIds !== null) void onConfirm(pageIds) }}>Delete permanently</button>
        </div>
      </div>
    </Modal>
  )
}

export function FolderDialog({ value, onClose, onSubmit, onDelete }: {
  value: { kind: 'folder'; folder: NoteFolder | null } | null
  onClose: () => void
  onSubmit: (name: string, folder: NoteFolder | null) => Promise<void>
  onDelete: (folder: NoteFolder) => Promise<void>
}): ReactNode {
  const [name, setName] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    setName(value?.folder?.name ?? '')
    setConfirmingDelete(false)
  }, [value])
  const folderItem = value?.folder ?? null
  return (
    <Modal open={value !== null} onClose={onClose} width={420} ariaLabel={value?.folder === null ? 'Create folder' : 'Rename folder'}>
      {confirmingDelete && folderItem !== null ? (
        <div className="notes-dialog">
          <div className="notes-dialog-head"><h2>Delete this folder?</h2><button type="button" onClick={onClose}><X size={17} /></button></div>
          <p>Its notes and folders will move up one level.</p>
          <div className="notes-dialog-actions">
            <button type="button" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            <button type="button" className="is-danger" onClick={() => void onDelete(folderItem)}>Delete</button>
          </div>
        </div>
      ) : (
        <form className="notes-dialog" onSubmit={(event) => { event.preventDefault(); if (value !== null && name.trim() !== '') void onSubmit(name.trim(), value.folder) }}>
          <div className="notes-dialog-head"><h2>{value?.folder === null ? 'New folder' : 'Rename folder'}</h2><button type="button" onClick={onClose}><X size={17} /></button></div>
          <label>Folder name<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <div className="notes-dialog-actions">
            {folderItem !== null ? <button type="button" className="is-danger-quiet" onClick={() => setConfirmingDelete(true)}>Delete folder</button> : null}
            <span />
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="is-primary" disabled={name.trim() === ''}>Save</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export function MoveDialog({ value, folders, pages, onClose, onSubmit }: {
  value: NotePage | null
  folders: readonly NoteFolder[]
  pages: readonly NotePage[]
  onClose: () => void
  onSubmit: (page: NotePage, folderId: string | null, parentPageId: string | null) => Promise<void>
}): ReactNode {
  const rootFolderValue = '__notes_root__'
  const noParentValue = '__notes_no_parent__'
  const [folderId, setFolderId] = useState<string>(rootFolderValue)
  const [parentPageId, setParentPageId] = useState<string>(noParentValue)
  useEffect(() => {
    setFolderId(value?.folderId ?? rootFolderValue)
    setParentPageId(value?.parentPageId ?? noParentValue)
  }, [noParentValue, rootFolderValue, value])
  const selectedFolderId = folderId === rootFolderValue ? null : folderId
  const possibleParents = pages.filter((page) => page.status === 'active' && page.id !== value?.id && page.folderId === selectedFolderId)
  const folderOptions = [{ value: rootFolderValue, label: 'Notes' }, ...folders.map((folderItem) => ({ value: folderItem.id, label: folderItem.name }))]
  const parentOptions = [{ value: noParentValue, label: 'No parent page' }, ...possibleParents.map((page) => ({ value: page.id, label: page.title || 'Untitled' }))]
  return (
    <Modal open={value !== null} onClose={onClose} width={460} ariaLabel="Move note">
      <form className="notes-dialog" onSubmit={(event) => { event.preventDefault(); if (value !== null) void onSubmit(value, selectedFolderId, parentPageId === noParentValue ? null : parentPageId) }}>
        <div className="notes-dialog-head"><h2>Move note</h2><button type="button" onClick={onClose}><X size={17} /></button></div>
        <label>Folder<Select value={folderId} options={folderOptions} onChange={(nextFolderId) => { setFolderId(nextFolderId); setParentPageId(noParentValue) }} placeholder="Notes" ariaLabel="Folder" /></label>
        <label>Parent page<Select value={parentPageId} options={parentOptions} onChange={setParentPageId} placeholder="No parent page" ariaLabel="Parent page" /></label>
        <div className="notes-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="is-primary">Move</button></div>
      </form>
    </Modal>
  )
}
