import { createReactBlockSpec } from '@blocknote/react'
import { Columns2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { NoteEditor } from './noteEditorSchema'

/** Layouts contain ordinary BlockNote child blocks: no nested editor or serialized content. */
export const twoColumnsBlock = createReactBlockSpec({
  type: 'twoColumns',
  propSchema: { ratio: { default: 50 } },
  content: 'none'
}, {
  render: ({ block, editor }): ReactNode => (
    <div className="note-layout-controls" contentEditable={false}>
      <Columns2 size={14} aria-hidden="true" />
      <label>Column width<input type="range" aria-label="First column width" min={25} max={75} step={5}
        value={block.props.ratio} onChange={(event) => editor.updateBlock(block.id, { props: { ratio: Number(event.target.value) } })} /></label>
      <style>{`.bn-block[data-id="${CSS.escape(block.id)}"] > .bn-block-group { --note-column-ratio: ${Math.min(75, Math.max(25, block.props.ratio))}%; }`}</style>
    </div>
  ),
  toExternalHTML: (): ReactNode => <section data-manor-columns="true" />
})()

export const noteColumnBlock = createReactBlockSpec({
  type: 'noteColumn', propSchema: {}, content: 'none'
}, {
  render: (): ReactNode => <span className="note-column-anchor" contentEditable={false} />,
  toExternalHTML: (): ReactNode => <section data-manor-column="true" />
})()

export const documentTabBlock = createReactBlockSpec({
  type: 'documentTab', propSchema: { title: { default: 'Tab' } }, content: 'none'
}, {
  render: ({ block, editor }): ReactNode => (
    <label className="note-tab-title" contentEditable={false}>Tab name
      <input aria-label="Tab name" value={block.props.title} maxLength={100}
        onChange={(event) => editor.updateBlock(block.id, { props: { title: event.target.value } })} />
    </label>
  ),
  toExternalHTML: ({ block }): ReactNode => <h3>{block.props.title}</h3>
})()

interface TabChild { id: string; props: { title?: string } }

function TabStrip({ id, children, onAdd }: { id: string; children: readonly TabChild[]; onAdd: () => void }): ReactNode {
  const [selectedId, setSelectedId] = useState(children[0]?.id ?? '')
  useEffect(() => {
    const reveal = (event: Event): void => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return
      const target = document.querySelector(`.bn-block[data-id="${CSS.escape(event.detail)}"]`)
      if (target === null) return
      const containing = children.find((child) => document.querySelector(`.bn-block-outer[data-id="${CSS.escape(child.id)}"]`)?.contains(target))
      if (containing !== undefined) setSelectedId(containing.id)
    }
    window.addEventListener('manor:reveal-block', reveal)
    return () => window.removeEventListener('manor:reveal-block', reveal)
  }, [children])
  const activeId = children.some((child) => child.id === selectedId) ? selectedId : children[0]?.id ?? ''
  return (
    <div className="note-document-tabs" contentEditable={false}>
      <div role="tablist" aria-label="Document tabs">
        {children.map((child, index) => (
          <button type="button" role="tab" key={child.id} id={`tab-${child.id}`}
            aria-selected={activeId === child.id} tabIndex={activeId === child.id ? 0 : -1}
            onClick={() => setSelectedId(child.id)} onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % children.length
                : event.key === 'ArrowLeft' ? (index + children.length - 1) % children.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? children.length - 1 : null
              if (next === null) return
              event.preventDefault()
              const nextId = children[next].id
              setSelectedId(nextId)
              document.getElementById(`tab-${nextId}`)?.focus()
            }}>{child.props.title || `Tab ${index + 1}`}</button>
        ))}
        <button type="button" aria-label="Add document tab" onClick={onAdd}><Plus size={15} /></button>
      </div>
      <style>{`.bn-block[data-id="${CSS.escape(id)}"] > .bn-block-group > .bn-block-outer:not([data-id="${CSS.escape(activeId)}"]) { display: none; }`}</style>
    </div>
  )
}

export const documentTabsBlock = createReactBlockSpec({
  type: 'documentTabs', propSchema: {}, content: 'none'
}, {
  render: ({ block, editor }): ReactNode => <TabStrip id={block.id} children={block.children} onAdd={() => {
    ;(editor as unknown as NoteEditor).updateBlock(block.id, { children: [...block.children, {
      type: 'documentTab', props: { title: `Tab ${block.children.length + 1}` },
      children: [{ type: 'paragraph', content: [] }]
    }] })
  }} />,
  toExternalHTML: (): ReactNode => <section data-manor-tabs="true" />
})()
