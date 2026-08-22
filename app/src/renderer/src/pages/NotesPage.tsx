import { useState } from 'react'
import type { ReactNode } from 'react'

import { noteFolders, openDoc } from '../data/mock'
import { PageShell } from './PageShell'
import { DocList } from './notes/DocList'
import { EditorPane } from './notes/EditorPane'
import { FolderTree } from './notes/FolderTree'
import type { LocalDoc, LocalFolder } from './notes/notesModel'
import { toLocalFolder } from './notes/notesModel'
import './notes/notes.css'

const initialFolders: readonly LocalFolder[] = noteFolders.map(toLocalFolder)
const initialExpanded: ReadonlySet<string> = new Set(
  noteFolders.filter((folder) => folder.expanded).map((folder) => folder.id)
)

/** Notes: folder tree, doc list, and the block editor, three quiet panes. */
export function NotesPage(): ReactNode {
  const [folders, setFolders] = useState<readonly LocalFolder[]>(initialFolders)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(initialExpanded)
  const [selectedFolderId, setSelectedFolderId] = useState<string>('folder-calc3')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(openDoc.id)

  const selectedFolder =
    folders.find((folder) => folder.id === selectedFolderId) ?? folders[0] ?? null
  const selectedDoc: LocalDoc | null =
    selectedFolder !== null
      ? (selectedFolder.docs.find((doc) => doc.id === selectedDocId) ?? null)
      : null

  const toggleFolder = (folderId: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const selectFolder = (folderId: string): void => {
    setSelectedFolderId(folderId)
    const folder = folders.find((candidate) => candidate.id === folderId)
    setSelectedDocId(folder !== undefined && folder.docs.length > 0 ? folder.docs[0].id : null)
  }

  const selectDoc = (folderId: string, docId: string): void => {
    setSelectedFolderId(folderId)
    setSelectedDocId(docId)
  }

  const addFolder = (): void => {
    const folder: LocalFolder = {
      id: `folder-local-${Date.now()}`,
      name: 'New folder',
      docs: []
    }
    setFolders((current) => [...current, folder])
    setExpandedIds((current) => new Set(current).add(folder.id))
    setSelectedFolderId(folder.id)
    setSelectedDocId(null)
  }

  const addNote = (): void => {
    if (selectedFolder === null) {
      return
    }
    const doc: LocalDoc = {
      id: `doc-local-${Date.now()}`,
      title: 'Untitled',
      updatedLabel: 'Just now'
    }
    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, docs: [doc, ...folder.docs] } : folder
      )
    )
    setExpandedIds((current) => new Set(current).add(selectedFolder.id))
    setSelectedDocId(doc.id)
  }

  const duplicateDoc = (): void => {
    if (selectedFolder === null || selectedDoc === null) {
      return
    }
    const copy: LocalDoc = {
      id: `doc-local-${Date.now()}`,
      title: `${selectedDoc.title} copy`,
      updatedLabel: 'Just now'
    }
    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, docs: [copy, ...folder.docs] } : folder
      )
    )
    setSelectedDocId(copy.id)
  }

  const deleteDoc = (): void => {
    if (selectedFolder === null || selectedDoc === null) {
      return
    }
    const remaining = selectedFolder.docs.filter((doc) => doc.id !== selectedDoc.id)
    setFolders((current) =>
      current.map((folder) =>
        folder.id === selectedFolder.id ? { ...folder, docs: remaining } : folder
      )
    )
    setSelectedDocId(remaining.length > 0 ? remaining[0].id : null)
  }

  return (
    <PageShell title="Notes" fullBleed={true}>
      <div className="notes">
        <FolderTree
          folders={folders}
          expandedIds={expandedIds}
          selectedFolderId={selectedFolder !== null ? selectedFolder.id : ''}
          selectedDocId={selectedDocId}
          onToggleFolder={toggleFolder}
          onSelectFolder={selectFolder}
          onSelectDoc={selectDoc}
          onAddFolder={addFolder}
          onAddNote={addNote}
        />
        {selectedFolder !== null ? (
          <DocList
            folder={selectedFolder}
            selectedDocId={selectedDocId}
            onSelectDoc={(docId) => setSelectedDocId(docId)}
            onAddNote={addNote}
          />
        ) : null}
        {selectedFolder !== null && selectedDoc !== null ? (
          <EditorPane
            doc={selectedDoc}
            folderName={selectedFolder.name}
            blocks={selectedDoc.id === openDoc.id ? openDoc.blocks : null}
            onDuplicate={duplicateDoc}
            onDelete={deleteDoc}
          />
        ) : (
          <div className="neditor">
            <div className="neditor-scroll">
              <p className="nblock-paragraph nblock-placeholder">
                Pick a note, or start a new one.
              </p>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  )
}
