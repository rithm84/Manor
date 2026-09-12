import { SideMenuExtension } from '@blocknote/core/extensions'
import { BlockColorsItem, DragHandleMenu, RemoveBlockItem, TableColumnHeaderItem, TableRowHeaderItem,
  useComponentsContext, useExtensionState } from '@blocknote/react'
import { Copy, Link2, Move, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NoteEditor, NoteEditorBlock } from './noteEditorSchema'

function copiedBlocks(blocks: readonly NoteEditorBlock[]): NoteEditorBlock[] {
  return blocks.map((block) => ({ ...block, id: crypto.randomUUID(), children: copiedBlocks(block.children) }))
}

export function NoteBlockMenu({ editor, noteId, onError, onMove }: { editor: NoteEditor; noteId: string; onError: (message: string) => void; onMove: (blockIds: readonly string[]) => void }): ReactNode {
  const components = useComponentsContext()
  const target = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block })
  if (components === undefined || target === undefined) return null
  const selected = editor.getSelection()?.blocks
  const block = editor.getBlock(target.id)
  if (block === undefined) return null
  const blocks = selected?.some((item) => item.id === block.id) ? selected : [block]
  const Item = components.Generic.Menu.Item
  return <DragHandleMenu>
    <Item className="bn-menu-item" icon={<Copy size={14} />} onClick={() => {
      editor.insertBlocks(copiedBlocks(blocks), blocks[blocks.length - 1].id, 'after')
      editor.focus()
    }}><span data-testid="duplicate-note-block">Duplicate</span></Item>
    <Item className="bn-menu-item" icon={<Link2 size={14} />} onClick={() => {
      const url = new URL(window.location.href)
      url.searchParams.set('note', noteId)
      url.hash = `block=${encodeURIComponent(block.id)}`
      void navigator.clipboard.writeText(url.toString()).catch((failure: unknown) => onError(failure instanceof Error ? failure.message : String(failure)))
    }}><span data-testid="copy-note-block-link">Copy link to block</span></Item>
    <Item className="bn-menu-item" icon={<Move size={14} />} onClick={() => onMove(blocks.map((item) => item.id))}><span data-testid="move-note-block">Move to note</span></Item>
    <BlockColorsItem>Color</BlockColorsItem>
    <TableRowHeaderItem>Header row</TableRowHeaderItem>
    <TableColumnHeaderItem>Header column</TableColumnHeaderItem>
    <RemoveBlockItem><Trash2 size={14} />Delete</RemoveBlockItem>
  </DragHandleMenu>
}
