import {
  ChevronRight,
  Copy,
  GripVertical,
  Image as ImageIcon,
  MoreHorizontal,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { NoteBlock } from '../../data/mock'
import { CodeBlock } from './CodeBlock'
import type { LocalDoc } from './notesModel'

export interface EditorPaneProps {
  doc: LocalDoc
  folderName: string
  /** Null for docs whose body is not part of the mock story. */
  blocks: readonly NoteBlock[] | null
  onDuplicate: () => void
  onDelete: () => void
}

interface DocMenuProps {
  docTitle: string
  onDuplicate: () => void
  onDelete: () => void
}

function DocMenu({ docTitle, onDuplicate, onDelete }: DocMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="neditor-actions" ref={rootRef}>
      <button
        type="button"
        className="ntree-icon-btn"
        aria-label={`Options for ${docTitle}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="neditor-menu" role="menu" aria-label={`Options for ${docTitle}`}>
          <button
            type="button"
            role="menuitem"
            className="nmenu-item"
            onClick={() => {
              setOpen(false)
              onDuplicate()
            }}
          >
            <Copy size={14} />
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            className="nmenu-item nmenu-item--danger"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Block({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="nblock">
      <span className="nblock-handle" aria-hidden="true">
        <GripVertical size={14} />
      </span>
      {children}
    </div>
  )
}

function renderBlock(block: NoteBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return (
        <Block key={index}>
          <h2 className="nblock-heading">{block.text}</h2>
        </Block>
      )
    case 'paragraph':
      return (
        <Block key={index}>
          <p className="nblock-paragraph">{block.text}</p>
        </Block>
      )
    case 'code':
      return (
        <Block key={index}>
          <CodeBlock language={block.language} code={block.code} />
        </Block>
      )
    case 'image':
      return (
        <Block key={index}>
          <div className="nimage">
            <ImageIcon size={20} />
            <span className="nimage-caption">{block.caption}</span>
          </div>
        </Block>
      )
  }
}

/** Right pane: quiet doc header, block editor, Alfred footer chip. */
export function EditorPane({
  doc,
  folderName,
  blocks,
  onDuplicate,
  onDelete
}: EditorPaneProps): ReactNode {
  return (
    <div className="neditor">
      <div className="neditor-topbar">
        <span className="neditor-crumb">
          <span>{folderName}</span>
          <ChevronRight size={12} className="neditor-crumb-sep" />
          <span className="neditor-crumb-doc">{doc.title}</span>
        </span>
        <DocMenu docTitle={doc.title} onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>
      <div className="neditor-scroll">
        <div className="neditor-inner">
          <h1 className="neditor-doc-title">{doc.title}</h1>
          {blocks !== null ? (
            blocks.map(renderBlock)
          ) : (
            <Block>
              <p className="nblock-paragraph nblock-placeholder">Start writing.</p>
            </Block>
          )}
        </div>
      </div>
      <div className="neditor-foot">
        <div className="neditor-inner">
          <span className="neditor-alfred">
            <Sparkles size={12} />
            Alfred reads these notes
          </span>
        </div>
      </div>
    </div>
  )
}
