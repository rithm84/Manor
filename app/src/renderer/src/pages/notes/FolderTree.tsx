import { ChevronRight, FilePlus2, FileText, FolderPlus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tooltip } from '../../components/ui'
import type { LocalFolder } from './notesModel'

export interface FolderTreeProps {
  folders: readonly LocalFolder[]
  expandedIds: ReadonlySet<string>
  selectedFolderId: string
  selectedDocId: string | null
  onToggleFolder: (folderId: string) => void
  onSelectFolder: (folderId: string) => void
  onSelectDoc: (folderId: string, docId: string) => void
  onAddFolder: () => void
  onAddNote: () => void
}

/** Left pane: notebook folders with nested doc titles, Notion-sidebar bones. */
export function FolderTree({
  folders,
  expandedIds,
  selectedFolderId,
  selectedDocId,
  onToggleFolder,
  onSelectFolder,
  onSelectDoc,
  onAddFolder,
  onAddNote
}: FolderTreeProps): ReactNode {
  return (
    <div className="ntree">
      <div className="ntree-head">
        <span className="ntree-head-label">Notes</span>
        <span className="ntree-head-actions">
          <Tooltip label="New folder" side="bottom">
            <button type="button" className="ntree-icon-btn" aria-label="New folder" onClick={onAddFolder}>
              <FolderPlus size={15} />
            </button>
          </Tooltip>
          <Tooltip label="New note" side="bottom">
            <button type="button" className="ntree-icon-btn" aria-label="New note" onClick={onAddNote}>
              <FilePlus2 size={15} />
            </button>
          </Tooltip>
        </span>
      </div>
      <div className="ntree-scroll">
        {folders.map((folder) => {
          const expanded = expandedIds.has(folder.id)
          return (
            <div key={folder.id}>
              <button
                type="button"
                className={`ntree-folder${folder.id === selectedFolderId ? ' is-selected' : ''}`}
                onClick={() => {
                  onSelectFolder(folder.id)
                  if (!expanded) {
                    onToggleFolder(folder.id)
                  }
                }}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleFolder(folder.id)
                  }}
                  style={{ display: 'inline-flex' }}
                >
                  <ChevronRight size={13} className={`ntree-caret${expanded ? ' is-open' : ''}`} />
                </span>
                <span className="ntree-folder-name">{folder.name}</span>
                <span className="ntree-folder-count">{folder.docs.length}</span>
              </button>
              {expanded
                ? folder.docs.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      className={`ntree-doc${doc.id === selectedDocId ? ' is-selected' : ''}`}
                      onClick={() => onSelectDoc(folder.id, doc.id)}
                    >
                      <FileText size={13} />
                      <span className="ntree-doc-title">{doc.title}</span>
                    </button>
                  ))
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
