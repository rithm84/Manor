import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/ariakit'
import { createReactBlockSpec, useCreateBlockNote } from '@blocknote/react'
import { ExternalLink, Globe2, Link2, ListTree } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react'

interface DocumentBlock {
  id: string
  type: string
  props: Record<string, string | number | boolean>
  content?: readonly DocumentInlineContent[]
  children?: readonly DocumentBlock[]
}

interface DocumentInlineContent {
  type?: string
  text?: string
  content?: string
}

interface HeadingEntry {
  id: string
  level: number
  title: string
}

interface DocumentEditor {
  document: readonly DocumentBlock[]
  focus: () => void
  onChange: (callback: () => void) => () => void
  setTextCursorPosition: (blockId: string, placement: 'start') => void
  updateBlock: (blockId: string, update: { props: Record<string, string | number> }) => void
}

function inlineText(content: readonly DocumentInlineContent[] | undefined): string {
  if (content === undefined) return ''
  return content.map((item) => item.text ?? item.content ?? '').join('').trim()
}

function documentHeadings(blocks: readonly DocumentBlock[]): HeadingEntry[] {
  return blocks.flatMap((block) => {
    const own = block.type === 'heading'
      ? [{ id: block.id, level: Number(block.props.level), title: inlineText(block.content) }]
      : []
    return [...own.filter((heading) => heading.title !== ''), ...documentHeadings(block.children ?? [])]
  })
}

function TableOfContentsView({ editor }: { editor: DocumentEditor }): ReactNode {
  const [revision, setRevision] = useState(0)
  useEffect(() => editor.onChange(() => setRevision((current) => current + 1)), [editor])
  const headings = useMemo(() => documentHeadings(editor.document), [editor, revision])

  return (
    <nav className="note-toc" aria-label="Table of contents" contentEditable={false}>
      <div className="note-toc-title"><ListTree size={15} aria-hidden="true" />Contents</div>
      {headings.length === 0 ? <p>Add headings to build the outline.</p> : (
        <ol>
          {headings.map((heading) => (
            <li key={heading.id} style={{ paddingLeft: `${Math.max(heading.level - 1, 0) * 14}px` }}>
              <button type="button" onClick={() => {
                editor.setTextCursorPosition(heading.id, 'start')
                editor.focus()
              }}>{heading.title}</button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  )
}

export const tableOfContentsBlock = createReactBlockSpec(
  {
    type: 'tableOfContents',
    propSchema: {},
    content: 'none'
  },
  {
    render: ({ editor }): ReactNode => <TableOfContentsView editor={editor as unknown as DocumentEditor} />,
    toExternalHTML: (): ReactNode => <nav data-manor-table-of-contents="true">Table of contents</nav>
  }
)()

const emptyColumnContent = JSON.stringify([{ type: 'paragraph', content: [], children: [] }])
const { checkListItem: _checkListItem, ...columnBlockSpecs } = defaultBlockSpecs
const columnEditorSchema = BlockNoteSchema.create({ blockSpecs: columnBlockSpecs })
type ColumnEditorBlock = typeof columnEditorSchema.Block

function parseColumnContent(value: string): ColumnEditorBlock[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ColumnEditorBlock[]
  } catch {
    return JSON.parse(emptyColumnContent) as ColumnEditorBlock[]
  }
  return JSON.parse(emptyColumnContent) as ColumnEditorBlock[]
}

function ColumnEditor({
  blockId,
  column,
  contentJson,
  onChange
}: {
  blockId: string
  column: 'leftContent' | 'rightContent'
  contentJson: string
  onChange: (content: string) => void
}): ReactNode {
  const savedContentRef = useRef(contentJson)
  const initialContent = useMemo(() => parseColumnContent(contentJson), [blockId, column])
  const nestedEditor = useCreateBlockNote({ schema: columnEditorSchema, initialContent }, [blockId, column])

  useEffect(() => {
    if (savedContentRef.current === contentJson) return
    nestedEditor.replaceBlocks(nestedEditor.document, parseColumnContent(contentJson))
    savedContentRef.current = contentJson
  }, [contentJson, nestedEditor])

  return (
    <section className="note-two-column-editor" aria-label={column === 'leftContent' ? 'Left document column' : 'Right document column'} contentEditable={false}>
      <BlockNoteView
        editor={nestedEditor}
        theme="light"
        className="note-two-column-editor-view"
        formattingToolbar={false}
        slashMenu={false}
        emojiPicker={false}
        onChange={(changedEditor) => {
          const nextContent = JSON.stringify(changedEditor.document)
          if (nextContent === savedContentRef.current) return
          savedContentRef.current = nextContent
          onChange(nextContent)
        }}
      />
    </section>
  )
}

function TwoColumnsView({ block, editor }: {
  block: { id: string; props: { ratio: number; leftContent: string; rightContent: string } }
  editor: DocumentEditor
}): ReactNode {
  const containerRef = useRef<HTMLElement | null>(null)
  const draggingRef = useRef(false)
  const ratio = Math.min(75, Math.max(25, block.props.ratio))

  const updateFromClientX = (clientX: number): void => {
    const container = containerRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    if (rect.width === 0) return
    const next = Math.round(Math.min(75, Math.max(25, ((clientX - rect.left) / rect.width) * 100)))
    editor.updateBlock(block.id, { props: { ratio: next } })
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    updateFromClientX(event.clientX)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!draggingRef.current) return
    updateFromClientX(event.clientX)
  }

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const increment = event.shiftKey ? 10 : 5
    const next = event.key === 'ArrowLeft'
      ? ratio - increment
      : event.key === 'ArrowRight'
        ? ratio + increment
        : event.key === 'Home'
          ? 25
          : event.key === 'End'
            ? 75
            : null
    if (next === null) return
    event.preventDefault()
    editor.updateBlock(block.id, { props: { ratio: Math.min(75, Math.max(25, next)) } })
  }

  return (
    <section
      ref={containerRef}
      className="note-two-columns"
      contentEditable={false}
      style={{ '--note-column-left': `${ratio}%` } as CSSProperties}
    >
      <ColumnEditor
        blockId={block.id}
        column="leftContent"
        contentJson={block.props.leftContent}
        onChange={(leftContent) => editor.updateBlock(block.id, { props: { leftContent } })}
      />
      <button
        type="button"
        className="note-columns-resizer"
        role="separator"
        aria-label="Resize document columns"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={ratio}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <ColumnEditor
        blockId={block.id}
        column="rightContent"
        contentJson={block.props.rightContent}
        onChange={(rightContent) => editor.updateBlock(block.id, { props: { rightContent } })}
      />
    </section>
  )
}

export const twoColumnsBlock = createReactBlockSpec(
  {
    type: 'twoColumns',
    propSchema: {
      ratio: { default: 50 },
      leftContent: { default: emptyColumnContent },
      rightContent: { default: emptyColumnContent }
    },
    content: 'none'
  },
  {
    render: ({ block, editor }): ReactNode => <TwoColumnsView block={block} editor={editor as unknown as DocumentEditor} />,
    toExternalHTML: (): ReactNode => <section data-manor-columns="true" />
  }
)()

function parseWebUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null
  } catch {
    return null
  }
}

function UrlCapture({ label, onSubmit }: { label: string; onSubmit: (url: string) => void }): ReactNode {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = parseWebUrl(value.trim())
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onSubmit(parsed.toString())
  }
  return (
    <form className="note-url-capture" onSubmit={submit} contentEditable={false}>
      <Link2 size={16} aria-hidden="true" />
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste an https:// link" aria-label={label} aria-invalid={invalid} />
      <button type="submit" disabled={value.trim() === ''}>Add</button>
      {invalid ? <span role="alert">Enter a complete web address.</span> : null}
    </form>
  )
}

function BookmarkView({ block, editor }: {
  block: { id: string; props: { url: string; title: string } }
  editor: DocumentEditor
}): ReactNode {
  const parsed = parseWebUrl(block.props.url)
  if (parsed === null) {
    return <UrlCapture label="Bookmark URL" onSubmit={(url) => editor.updateBlock(block.id, { props: { url, title: new URL(url).hostname } })} />
  }
  return (
    <article className="note-web-bookmark" contentEditable={false}>
      <Globe2 size={18} aria-hidden="true" />
      <div>
        <input
          value={block.props.title}
          aria-label="Bookmark title"
          onChange={(event) => editor.updateBlock(block.id, { props: { title: event.target.value } })}
        />
        <span>{parsed.hostname}</span>
      </div>
      <a href={parsed.toString()} target="_blank" rel="noreferrer" aria-label={`Open ${block.props.title || parsed.hostname} externally`}><ExternalLink size={16} /></a>
    </article>
  )
}

function EmbedView({ block, editor }: {
  block: { id: string; props: { url: string; title: string } }
  editor: DocumentEditor
}): ReactNode {
  const parsed = parseWebUrl(block.props.url)
  if (parsed === null) {
    return <UrlCapture label="Embed URL" onSubmit={(url) => editor.updateBlock(block.id, { props: { url, title: new URL(url).hostname } })} />
  }
  return (
    <figure className="note-web-embed" contentEditable={false}>
      <div className="note-web-embed-head">
        <Globe2 size={15} aria-hidden="true" />
        <span>{block.props.title || parsed.hostname}</span>
        <a href={parsed.toString()} target="_blank" rel="noreferrer" aria-label="Open embed externally"><ExternalLink size={15} /></a>
      </div>
      <iframe
        src={parsed.toString()}
        title={block.props.title || parsed.hostname}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-scripts"
      />
    </figure>
  )
}

export const webBookmarkBlock = createReactBlockSpec(
  {
    type: 'webBookmark',
    propSchema: {
      url: { default: '' },
      title: { default: '' }
    },
    content: 'none'
  },
  {
    render: ({ block, editor }): ReactNode => <BookmarkView block={block} editor={editor as unknown as DocumentEditor} />,
    toExternalHTML: ({ block }): ReactNode => {
      const parsed = parseWebUrl(block.props.url)
      return parsed === null ? <span /> : <a href={parsed.toString()}>{block.props.title || parsed.hostname}</a>
    }
  }
)()

export const webEmbedBlock = createReactBlockSpec(
  {
    type: 'webEmbed',
    propSchema: {
      url: { default: '' },
      title: { default: '' }
    },
    content: 'none'
  },
  {
    render: ({ block, editor }): ReactNode => <EmbedView block={block} editor={editor as unknown as DocumentEditor} />,
    toExternalHTML: ({ block }): ReactNode => {
      const parsed = parseWebUrl(block.props.url)
      return parsed === null ? <span /> : <a href={parsed.toString()}>{block.props.title || parsed.hostname}</a>
    }
  }
)()
