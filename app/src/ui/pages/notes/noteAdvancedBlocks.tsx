import { createReactBlockSpec } from '@blocknote/react'
import { ExternalLink, Globe2, Link2, ListTree } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

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
  content?: string | readonly DocumentInlineContent[]
  props?: { title?: string }
}

interface HeadingEntry {
  id: string
  level: number
  title: string
}

interface DocumentEditor {
  isEditable: boolean
  document: readonly DocumentBlock[]
  focus: () => void
  onChange: (callback: () => void) => () => void
  setTextCursorPosition: (blockId: string, placement: 'start') => void
  updateBlock: (blockId: string, update: { props: Record<string, string | number> }) => void
}

function inlineText(content: readonly DocumentInlineContent[] | undefined): string {
  if (content === undefined) return ''
  return content.map((item) => item.text ?? item.props?.title
    ?? (typeof item.content === 'string' ? item.content : inlineText(item.content))).join('').trim()
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
                window.dispatchEvent(new CustomEvent('manor:reveal-block', { detail: heading.id }))
                window.requestAnimationFrame(() => {
                  editor.setTextCursorPosition(heading.id, 'start')
                  editor.focus()
                })
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
    if (!editor.isEditable) return <p>Empty bookmark</p>
    return <UrlCapture label="Bookmark URL" onSubmit={(url) => editor.updateBlock(block.id, { props: { url, title: new URL(url).hostname } })} />
  }
  return (
    <article className="note-web-bookmark" contentEditable={false}>
      <Globe2 size={18} aria-hidden="true" />
      <div>
        <input
          readOnly={!editor.isEditable}
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
    if (!editor.isEditable) return <p>Empty embed</p>
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
