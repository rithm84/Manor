import { FilePlus2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tooltip } from '../../components/ui'
import type { LocalFolder } from './notesModel'

export interface DocListProps {
  folder: LocalFolder
  selectedDocId: string | null
  onSelectDoc: (docId: string) => void
  onAddNote: () => void
}

/** Middle pane: the selected folder's docs as compact title + edited-when rows. */
export function DocList({ folder, selectedDocId, onSelectDoc, onAddNote }: DocListProps): ReactNode {
  return (
    <div className="ndocs">
      <div className="ndocs-head">
        <span className="ndocs-head-label">
          {folder.name}
          <span className="ndocs-count">{folder.docs.length}</span>
        </span>
        <Tooltip label="New note" side="bottom">
          <button
            type="button"
            className="ntree-icon-btn"
            aria-label={`New note in ${folder.name}`}
            onClick={onAddNote}
          >
            <FilePlus2 size={15} />
          </button>
        </Tooltip>
      </div>
      <div className="ndocs-scroll">
        {folder.docs.length === 0 ? (
          <div className="ndocs-empty">Nothing in this folder yet.</div>
        ) : (
          folder.docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={`ndocs-row${doc.id === selectedDocId ? ' is-selected' : ''}`}
              onClick={() => onSelectDoc(doc.id)}
            >
              <span className="ndocs-row-title">{doc.title}</span>
              <span className="ndocs-row-when">{doc.updatedLabel}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
