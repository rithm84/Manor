import { useManorService } from '../../services/ManorServices'
import { BlockNoteEditor } from '@blocknote/core'
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu
} from '@blocknote/core/extensions'
import { syntaxHighlighter } from '@blocknote/code-block'
import {
  getMathBlockTypeSelectItems,
  getMathSlashMenuItems
} from '@blocknote/math-block'
import { BlockNoteView } from '@blocknote/ariakit'
import '@blocknote/ariakit/style.css'
import {
  SideMenu,
  SideMenuController,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  blockTypeSelectItems,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote
} from '@blocknote/react'
import {
  Baseline,
  Bookmark,
  Braces,
  Columns2,
  File as FileIcon,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  List,
  ListTree,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
  PanelsTopLeft,
  TextQuote
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import type { NotePage } from '../../../shared/notes'
import { validateFileUploadSize } from '../../../shared/fileUploadPolicy'
import { MoveBlocksDialog } from './MoveBlocksDialog'
import { NoteBlockMenu } from './NoteBlockMenu'
import { useNoteTheme } from './useNoteTheme'
import { noteEditorSchema } from './noteEditorSchema'
import type { NoteEditor, NoteEditorBlock } from './noteEditorSchema'

export interface RichNoteEditorProps {
  page: NotePage
  allPages: readonly NotePage[]
  onChange: (contentJson: string) => void
  onMoveBlocks: (blockIds: readonly string[], targetNoteId: string) => Promise<void>
}

interface PortableText {
  type: 'text'
  text: string
  styles: Record<string, string | boolean>
}

interface PortableMath {
  type: 'math'
  content: string
}

interface PortableOtherInline {
  type: string
  [key: string]: string | Record<string, string | boolean> | readonly PortableInline[]
}

type PortableInline = PortableText | PortableMath | PortableOtherInline

interface PortableBlock {
  id?: string
  type: string
  props?: Record<string, string | number | boolean>
  content?: string | readonly PortableInline[]
  children?: readonly PortableBlock[]
}

function isPortableText(inline: PortableInline): inline is PortableText {
  return inline.type === 'text' && 'text' in inline && typeof inline.text === 'string'
}

function isPortableMath(inline: PortableInline): inline is PortableMath {
  return inline.type === 'math' && 'content' in inline && typeof inline.content === 'string'
}

function normalizeLegacyColumns(blocks: readonly PortableBlock[]): PortableBlock[] {
  return blocks.map((block) => {
    if (block.type === 'columnList' || (block.type === 'twoColumns' && typeof block.props?.leftContent === 'string')) {
      const columns = block.type === 'columnList'
        ? (block.children ?? []).filter((child) => child.type === 'column').map((column) => ({
          ...column, type: 'noteColumn', children: normalizeLegacyColumns(column.children ?? [])
        }))
        : ['leftContent', 'rightContent'].map((key) => ({
          id: `${block.id ?? crypto.randomUUID()}-${key}`,
          type: 'noteColumn',
          children: columnBlocks(block.props?.[key])
        }))
      return {
        id: block.id,
        type: 'twoColumns',
        props: { ratio: Number(block.props?.ratio ?? 50) },
        children: columns
      }
    }
    return { ...block, type: block.type === 'column' ? 'noteColumn' : block.type,
      children: normalizeLegacyColumns(block.children ?? []) }
  })
}

function columnBlocks(value: unknown): PortableBlock[] {
  if (typeof value !== 'string') throw new TypeError('A retained column must contain serialized blocks')
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new TypeError('A retained column must contain a block array')
  return normalizeLegacyColumns(parsed as PortableBlock[])
}

export function blocksFromJson(contentJson: string): NoteEditorBlock[] {
  const parsed: unknown = JSON.parse(contentJson)
  if (!Array.isArray(parsed)) {
    throw new TypeError('Persisted note content must be a block array')
  }
  return normalizeLegacyColumns(parsed as PortableBlock[]) as NoteEditorBlock[]
}

function canonicalDocument(contentJson: string): string {
  return JSON.stringify(JSON.parse(contentJson), (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))
  })
}

function splitInlineMath(content: readonly PortableInline[]): PortableInline[] {
  return content.flatMap((inline) => {
    if (!isPortableText(inline)) return [inline]
    const parts: PortableInline[] = []
    const pattern = /(?<!\\)\$([^$\n]+)(?<!\\)\$/g
    let cursor = 0
    for (const match of inline.text.matchAll(pattern)) {
      const index = match.index
      const source = match[1]
      if (index === undefined || source === undefined) continue
      if (index > cursor) parts.push({ ...inline, text: inline.text.slice(cursor, index) })
      parts.push({ type: 'math', content: source })
      cursor = index + match[0].length
    }
    if (cursor === 0) return [inline]
    if (cursor < inline.text.length) parts.push({ ...inline, text: inline.text.slice(cursor) })
    return parts
  })
}

function withImportedInlineMath(blocks: readonly PortableBlock[]): PortableBlock[] {
  return blocks.map((block) => ({
    ...block,
    content: Array.isArray(block.content) ? splitInlineMath(block.content) : block.content,
    children: withImportedInlineMath(block.children ?? [])
  }))
}

function parseMarkdownSections(editor: NoteEditor, markdown: string): PortableBlock[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks: PortableBlock[] = []
  const buffer: string[] = []
  const flushMarkdown = (): void => {
    const section = buffer.join('\n').trim()
    buffer.length = 0
    if (section !== '') blocks.push(...(editor.tryParseMarkdownToBlocks(section) as PortableBlock[]))
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== '$$') {
      buffer.push(lines[index] ?? '')
      continue
    }
    const closing = lines.findIndex((line, candidate) => candidate > index && line.trim() === '$$')
    if (closing === -1) {
      buffer.push(lines[index] ?? '')
      continue
    }
    flushMarkdown()
    blocks.push({ type: 'mathBlock', content: lines.slice(index + 1, closing).join('\n'), children: [] })
    index = closing
  }
  flushMarkdown()
  return withImportedInlineMath(blocks)
}

function portablePlainText(content: PortableBlock['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((inline) => isPortableText(inline) ? inline.text : isPortableMath(inline) ? inline.content : '').join('')
}

function markdownSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

function headingMarkdown(blocks: readonly PortableBlock[]): string {
  const headings = blocks.flatMap((block) => {
    const level = Number(block.props?.level ?? 1)
    const title = block.type === 'heading' ? portablePlainText(block.content).trim() : ''
    const own = title === '' ? [] : [`${'  '.repeat(Math.max(level - 1, 0))}- [${title}](#${markdownSlug(title)})`]
    return [...own, ...headingMarkdown(block.children ?? []).split('\n').filter(Boolean)]
  })
  return headings.join('\n')
}

function prepareMarkdownExport(blocks: readonly PortableBlock[]): {
  blocks: PortableBlock[]
  replacements: ReadonlyMap<string, string>
} {
  const replacements = new Map<string, string>()
  const contents = headingMarkdown(blocks)
  let sequence = 0
  const token = (markdown: string): string => {
    const value = `MANORNOTEBLOCK${sequence}END`
    sequence += 1
    replacements.set(value, markdown)
    return value
  }
  const inline = (content: readonly PortableInline[]): PortableInline[] => content.map((item) => isPortableMath(item)
    ? { type: 'text', text: token(`$${item.content}$`), styles: {} }
    : item)
  const visit = (items: readonly PortableBlock[]): PortableBlock[] => items.flatMap<PortableBlock>((block) => {
    if (block.type === 'twoColumns' && typeof block.props?.leftContent !== 'string') {
      return (block.children ?? []).flatMap((column, index) => [
        ...(index === 0 ? [] : [{ type: 'divider', children: [] }]),
        ...visit(column.children ?? [])
      ])
    }
    if (block.type === 'documentTabs') return visit(block.children ?? [])
    if (block.type === 'documentTab') return [
      { type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: String(block.props?.title ?? 'Tab'), styles: {} }], children: [] },
      ...visit(block.children ?? [])
    ]
    if (block.type === 'noteColumn') return visit(block.children ?? [])
    if (block.type === 'twoColumns') {
      return [
        ...visit(columnBlocks(block.props?.leftContent)),
        { type: 'divider', children: [] },
        ...visit(columnBlocks(block.props?.rightContent))
      ]
    }
    if (block.type === 'columnList') {
      return block.children?.flatMap((column, index) => [
        ...(index === 0 ? [] : [{ type: 'divider', children: [] }]),
        ...visit(column.children ?? [])
      ]) ?? []
    }
    if (block.type === 'column') return visit(block.children ?? [])
    if (block.type === 'mathBlock') {
      return [{ type: 'paragraph', content: [{ type: 'text', text: token(`$$\n${portablePlainText(block.content)}\n$$`), styles: {} }], children: [] }]
    }
    if (block.type === 'tableOfContents') {
      return [{ type: 'paragraph', content: [{ type: 'text', text: token(contents || 'Table of contents'), styles: {} }], children: [] }]
    }
    if (block.type === 'webBookmark' || block.type === 'webEmbed') {
      const url = String(block.props?.url ?? '')
      const title = String(block.props?.title ?? '') || url
      const label = block.type === 'webEmbed' ? `Embedded page: ${title}` : title
      return [{ type: 'paragraph', content: [{ type: 'text', text: token(`[${label}](${url})`), styles: {} }], children: [] }]
    }
    return [{
      ...block,
      content: Array.isArray(block.content) ? inline(block.content) : block.content,
      children: visit(block.children ?? [])
    }]
  })
  return { blocks: visit(blocks), replacements }
}

function iconForSlashItem(title: string): ReactElement {
  const normalized = title.toLowerCase()
  if (normalized.includes('heading 1')) return <Heading1 size={17} />
  if (normalized.includes('heading 2')) return <Heading2 size={17} />
  if (normalized.includes('heading 3')) return <Heading3 size={17} />
  if (normalized.includes('bullet')) return <List size={17} />
  if (normalized.includes('number')) return <ListOrdered size={17} />
  if (normalized.includes('toggle')) return <TextQuote size={17} />
  if (normalized.includes('quote')) return <Quote size={17} />
  if (normalized.includes('divider')) return <Minus size={17} />
  if (normalized.includes('code')) return <Braces size={17} />
  if (normalized.includes('table')) return <Table size={17} />
  if (normalized.includes('image')) return <Image size={17} />
  if (normalized.includes('file')) return <FileIcon size={17} />
  if (normalized.includes('paragraph') || normalized.includes('text')) return <Pilcrow size={17} />
  return <Baseline size={17} />
}

function slashItems(editor: NoteEditor, query: string): ReturnType<typeof getDefaultReactSlashMenuItems> {
  const defaults = getDefaultReactSlashMenuItems(editor)
    .filter((item) => !item.title.toLowerCase().includes('emoji'))
    .map((item) => ({
      ...item,
      icon: iconForSlashItem(item.title),
      // The custom image block owns its upload and link controls.
      onItemClick: item.title === editor.dictionary.slash_menu.image.title
        ? () => { insertOrUpdateBlockForSlashMenu(editor, { type: 'image' }) }
        : item.onItemClick
    }))
  const callout = {
    title: 'Callout',
    subtext: 'Highlight a note or warning',
    aliases: ['aside', 'info', 'note'],
    group: 'Basic blocks',
    icon: <Info size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' })
  }
  const tableOfContents = {
    title: 'Table of contents',
    subtext: 'Live outline of headings',
    aliases: ['toc', 'outline', 'contents'],
    group: 'Advanced',
    icon: <ListTree size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'tableOfContents' })
  }
  const bookmark = {
    title: 'Web bookmark',
    subtext: 'Compact link card',
    aliases: ['bookmark', 'link', 'website'],
    group: 'Media',
    icon: <Bookmark size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'webBookmark' })
  }
  const embed = {
    title: 'Web embed',
    subtext: 'Embed a web page',
    aliases: ['embed', 'iframe', 'website'],
    group: 'Media',
    icon: <PanelsTopLeft size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'webEmbed' })
  }
  const columns = {
    title: 'Two columns',
    subtext: 'Place blocks side by side',
    aliases: ['columns', 'layout', 'side by side'],
    group: 'Advanced',
    icon: <Columns2 size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
      type: 'twoColumns',
      props: { ratio: 50 },
      children: [
        { type: 'noteColumn', children: [{ type: 'paragraph', content: [] }] },
        { type: 'noteColumn', children: [{ type: 'paragraph', content: [] }] }
      ]
    })
  }
  const tabs = {
    title: 'Tabs', subtext: 'Keep related sections together', aliases: ['tabs', 'sections'], group: 'Advanced',
    icon: <PanelsTopLeft size={17} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, {
      type: 'documentTabs', children: [
        { type: 'documentTab', props: { title: 'Tab 1' }, children: [{ type: 'paragraph', content: [] }] },
        { type: 'documentTab', props: { title: 'Tab 2' }, children: [{ type: 'paragraph', content: [] }] }
      ]
    })
  }
  // BlockNote keys menu sections by group name, so items of one group must
  // sit contiguously: splice each custom item after its group's last
  // default instead of appending (appending duplicates the section keys).
  const merged = [...defaults]
  for (const item of [callout, tableOfContents, columns, tabs, bookmark, embed]) {
    let insertAt = merged.length
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (merged[index].group === item.group) {
        insertAt = index + 1
        break
      }
    }
    merged.splice(insertAt, 0, item)
  }
  return filterSuggestionItems([...merged, ...getMathSlashMenuItems(editor)], query)
}

function attachmentId(stableUrl: string): string | null {
  const prefix = 'manor-attachment://'
  return stableUrl.startsWith(prefix) ? stableUrl.slice(prefix.length) : null
}

/** The heavy BlockNote editor is lazy-loaded by NotesPage. */
function RichNoteEditorComponent({ page, allPages, onChange, onMoveBlocks }: RichNoteEditorProps): ReactNode {
  const [movingBlocks, setMovingBlocks] = useState<readonly string[] | null>(null)
  const [menuError, setMenuError] = useState<string | null>(null)
  const browserHighlightsRef = useRef(new Map<HTMLElement, { outline: string; offset: string; timer: number }>())
  const theme = useNoteTheme()
  const notesApi = useManorService('notes')
  const visibleContentRef = useRef(page.contentJson)
  const applyingExternalRef = useRef(false)
  const editor = useCreateBlockNote(
    {
      schema: noteEditorSchema,
      initialContent: blocksFromJson(page.contentJson),
      extensions: [syntaxHighlighter],
      tables: {
        splitCells: true,
        cellBackgroundColor: true,
        cellTextColor: true,
        headers: true
      },
      uploadFile: async (file: File) => {
        validateFileUploadSize(file.size)
        const attachment = await notesApi.uploadAttachment({
          noteId: page.id,
          name: file.name,
          mimeType: file.type === '' ? 'application/octet-stream' : file.type,
          bytes: file
        })
        return attachment.stableUrl
      },
      resolveFileUrl: async (url: string) => {
        const id = attachmentId(url)
        return id === null ? url : notesApi.resolveAttachment(id)
      }
    },
    [page.id]
  )

  useEffect(() => {
    const highlights = browserHighlightsRef.current
    return () => {
      for (const [element, highlight] of highlights) {
        window.clearTimeout(highlight.timer)
        element.style.outline = highlight.outline
        element.style.outlineOffset = highlight.offset
      }
      highlights.clear()
    }
  }, [])


  useEffect(() => {
    if (canonicalDocument(page.contentJson) === canonicalDocument(visibleContentRef.current)) return
    visibleContentRef.current = page.contentJson
    applyingExternalRef.current = true
    try { editor.replaceBlocks(editor.document, blocksFromJson(page.contentJson)) }
    finally { applyingExternalRef.current = false }
    visibleContentRef.current = JSON.stringify(editor.document)
  }, [editor, page.contentJson])

  useEffect(() => {
    const reveal = (): void => {
      if (!window.location.hash.startsWith('#block=')) return
      const id = decodeURIComponent(window.location.hash.slice('#block='.length))
      if (editor.getBlock(id) === undefined) return
      window.dispatchEvent(new CustomEvent('manor:reveal-block', { detail: id }))
      window.requestAnimationFrame(() => {
        editor.setTextCursorPosition(id, 'start')
        document.querySelector(`.bn-block[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
      })
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [editor])

  const mentionItems = useMemo(
    () =>
      allPages
        .filter((candidate) => candidate.status === 'active' && candidate.id !== page.id)
        .map((candidate) => ({
          title: candidate.title,
          subtext: 'Page',
          aliases: [candidate.title],
          group: 'Pages',
          icon: <FileIcon size={16} />,
          onItemClick: () =>
            editor.insertInlineContent([
              {
                type: 'pageMention',
                props: { pageId: candidate.id, title: candidate.title }
              },
              ' '
            ])
        })),
    [allPages, editor, page.id]
  )

  return (
    <>
    {menuError !== null ? <p className="note-media-error" role="alert">{menuError}</p> : null}
    <BlockNoteView
      editor={editor}
      theme={theme}
      className="note-block-editor"
      sideMenu={false}
      formattingToolbar={false}
      slashMenu={false}
      emojiPicker={false}
      portalElements={{ default: document.body }}
      onChange={(changedEditor) => {
        if (applyingExternalRef.current) return
        const content = JSON.stringify(changedEditor.document)
        if (content === visibleContentRef.current) return
        visibleContentRef.current = content
        onChange(content)
      }}
    >
      <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={() => <NoteBlockMenu editor={editor} noteId={page.id} onError={setMenuError} onMove={setMovingBlocks} />} />} />
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => slashItems(editor, query)}
      />
      <FormattingToolbarController
        portalElement={document.body}
        formattingToolbar={(props) => (
          <FormattingToolbar
            {...props}
            blockTypeSelectItems={[
              ...blockTypeSelectItems(editor.dictionary),
              ...getMathBlockTypeSelectItems(editor)
            ]}
          />
        )}
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={async (query) => filterSuggestionItems(mentionItems, query)}
      />
    </BlockNoteView>
    {movingBlocks !== null ? <MoveBlocksDialog blockIds={movingBlocks} pages={allPages.filter((candidate) => candidate.status === 'active' && candidate.id !== page.id)} onClose={() => setMovingBlocks(null)} onMove={onMoveBlocks} /> : null}
    </>
  )
}

function sameMentionCatalog(previous: RichNoteEditorProps, next: RichNoteEditorProps): boolean {
  if (previous.page.id !== next.page.id || previous.onChange !== next.onChange || previous.onMoveBlocks !== next.onMoveBlocks) return false
  if (previous.page.contentJson !== next.page.contentJson) return false
  const previousPages = previous.allPages.filter((page) => page.status === 'active' && page.id !== previous.page.id)
  const nextPages = next.allPages.filter((page) => page.status === 'active' && page.id !== next.page.id)
  return previousPages.length === nextPages.length
    && previousPages.every((page, index) => {
      const nextPage = nextPages[index]
      return nextPage !== undefined && page.id === nextPage.id && page.title === nextPage.title
    })
}

export const RichNoteEditor = memo(RichNoteEditorComponent, sameMentionCatalog)

export function markdownToContentJson(markdown: string): string {
  const editor = BlockNoteEditor.create({ schema: noteEditorSchema })
  return JSON.stringify(parseMarkdownSections(editor, markdown))
}

export function contentJsonToMarkdown(contentJson: string): string {
  const prepared = prepareMarkdownExport(JSON.parse(contentJson) as PortableBlock[])
  const editor = BlockNoteEditor.create({
    schema: noteEditorSchema,
    initialContent: prepared.blocks as NoteEditorBlock[]
  })
  let markdown = editor.blocksToMarkdownLossy(editor.document)
  for (const [token, replacement] of prepared.replacements) markdown = markdown.replaceAll(token, () => replacement)
  return markdown
}
