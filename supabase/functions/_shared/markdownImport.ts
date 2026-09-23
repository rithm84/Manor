/**
 * Markdown to native note blocks for the `import_markdown_note` tool. The conversion runs on the MCP host,
 * so an agent hands over the Markdown it found on disk and Manor produces the BlockNote document the app
 * edits, with fresh stable ids on every block. Images and file links that point at local paths become
 * attachment references when the caller maps them, and are reported back when it has not yet uploaded them.
 */
import { fromMarkdown } from 'npm:mdast-util-from-markdown@2.0.3'
import { gfm } from 'npm:micromark-extension-gfm@3.0.0'
import { gfmFromMarkdown } from 'npm:mdast-util-gfm@3.1.0'
import { math } from 'npm:micromark-extension-math@3.1.0'
import { mathFromMarkdown } from 'npm:mdast-util-math@3.0.0'
import type { Nodes, PhrasingContent, RootContent } from 'npm:@types/mdast@4.0.4'

import type { JsonObject, JsonValue } from './toolDefinitions.ts'
import type { MarkdownConversion, MarkdownConversionAsset } from './toolExecution.ts'

type Styles = { bold?: true; italic?: true; strike?: true; code?: true }
type Inline = JsonObject
type Block = JsonObject

const ATTACHMENT_URL = /^manor-attachment:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|tiff?)$/i
const FILE_EXTENSIONS = /\.(pdf|zip|docx?|xlsx?|pptx?|csv|txt|json|mp3|m4a|wav|mp4|mov|webm|key|numbers|pages)$/i

class Conversion {
  readonly assets: MarkdownConversionAsset[] = []
  readonly notes = new Set<string>()
  private readonly definitions = new Map<string, { url: string; title: string | null }>()

  constructor(private readonly mapping: ReadonlyMap<string, string>) {}

  convert(markdown: string): MarkdownConversion {
    const { body, frontMatter } = splitFrontMatter(markdown)
    if (frontMatter !== null) this.notes.add('Front matter was removed; its fields are not part of the note.')
    const tree = fromMarkdown(rewriteWikilinks(body), {
      extensions: [gfm(), math()],
      mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
    })
    for (const node of tree.children) if (node.type === 'definition') this.definitions.set(node.identifier, { url: node.url, title: node.title ?? null })
    const blocks = this.blocks(tree.children)
    return { blocks: blocks.length === 0 ? [paragraph([])] : blocks, assets: this.assets, notes: [...this.notes], frontMatter }
  }

  private blocks(nodes: readonly RootContent[]): Block[] {
    const out: Block[] = []
    for (const node of nodes) out.push(...this.block(node))
    return out
  }

  private block(node: RootContent): Block[] {
    switch (node.type) {
      case 'heading':
        return [block('heading', { ...textProps(), level: Math.min(Math.max(node.depth, 1), 6) }, this.inlineOrHoist(node.children, 'heading'))]
      case 'paragraph':
        return this.paragraphBlocks(node.children)
      case 'blockquote': {
        const [first, ...rest] = node.children
        const content = first?.type === 'paragraph' ? this.inline(first.children) : []
        const children = this.blocks(first?.type === 'paragraph' ? rest : node.children)
        return [block('quote', textProps(), content, children)]
      }
      case 'list':
        return node.children.map((item, index) => {
          const [first, ...rest] = item.children
          const content = first?.type === 'paragraph' ? this.inline(first.children) : []
          const children = this.blocks(first?.type === 'paragraph' ? rest : item.children)
          if (item.checked === true || item.checked === false) return block('checkListItem', { ...textProps(), checked: item.checked }, content, children)
          if (node.ordered) {
            const props: JsonObject = textProps()
            if (index === 0 && typeof node.start === 'number' && node.start !== 1) props.start = node.start
            return block('numberedListItem', props, content, children)
          }
          return block('bulletListItem', textProps(), content, children)
        })
      case 'code':
        return [block('codeBlock', { language: node.lang?.trim() || 'text' }, [text(node.value, {})])]
      case 'math':
        return [{ id: crypto.randomUUID(), type: 'mathBlock', props: {}, content: node.value, children: [] }]
      case 'thematicBreak':
        return [block('divider', {}, [])]
      case 'table': {
        const rows = node.children.map((row) => ({ cells: row.children.map((cell) => this.inline(cell.children)) }))
        return [{ id: crypto.randomUUID(), type: 'table', props: { textColor: 'default' }, content: { type: 'tableContent', columnWidths: [], headerRows: 1, rows }, children: [] }]
      }
      case 'html':
        return this.htmlBlocks(node.value)
      case 'footnoteDefinition':
        return [block('paragraph', textProps(), [text(`[^${node.label ?? node.identifier}] `, {}), ...this.inlineOrHoist(flattenParagraphs(node.children), 'footnote')])]
      case 'definition':
        return []
      case 'yaml':
        return []
      default:
        this.notes.add(`Unsupported Markdown element kept as text: ${node.type}.`)
        return [paragraph([text(plainText(node), {})])]
    }
  }

  /** A paragraph that mixes text and images becomes text and image blocks in reading order. */
  private paragraphBlocks(children: readonly PhrasingContent[]): Block[] {
    const out: Block[] = []
    let run: PhrasingContent[] = []
    const flush = (): void => {
      const inline = trimInline(this.inline(run))
      if (inline.length > 0) out.push(paragraph(inline))
      run = []
    }
    for (const child of children) {
      const image = this.imageNode(child)
      if (image === null) { run.push(child); continue }
      flush()
      out.push(this.mediaBlock('image', image.url, image.alt, image.title))
    }
    flush()
    for (const child of children) {
      if (child.type !== 'link' && child.type !== 'linkReference') continue
      const href = child.type === 'link' ? child.url : this.definitions.get(child.identifier)?.url
      if (href === undefined || !isLocalPath(href) || !FILE_EXTENSIONS.test(href)) continue
      const label = plainText(child)
      const mapped = this.resolve(href)
      if (mapped !== null) out.push(this.mediaBlock('file', href, label, null))
      else this.assets.push({ path: normalizePath(href), kind: 'file', block_id: null, label })
    }
    return out.length === 0 ? [paragraph([])] : out
  }

  private imageNode(node: PhrasingContent): { url: string; alt: string; title: string | null } | null {
    if (node.type === 'image') return { url: node.url, alt: node.alt ?? '', title: node.title ?? null }
    if (node.type === 'imageReference') {
      const definition = this.definitions.get(node.identifier)
      if (definition === undefined) return null
      return { url: definition.url, alt: node.alt ?? '', title: definition.title }
    }
    if (node.type === 'html') {
      const source = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(node.value)
      if (source === null) return null
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(node.value)
      return { url: source[1] ?? '', alt: alt?.[1] ?? '', title: null }
    }
    return null
  }

  private htmlBlocks(html: string): Block[] {
    const images = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    if (images.length > 0) {
      return images.map((match) => {
        const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(match[0])
        return this.mediaBlock('image', match[1] ?? '', alt?.[1] ?? '', null)
      })
    }
    const stripped = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()
    if (stripped === '') return []
    this.notes.add('HTML was kept as plain text.')
    return [paragraph([text(stripped, {})])]
  }

  /**
   * Media that names a remote address or a ready attachment keeps it. A local path becomes the mapped
   * attachment when the caller uploaded it, and otherwise an empty block the caller can fill in.
   */
  private mediaBlock(kind: 'image' | 'file', url: string, alt: string, title: string | null): Block {
    const id = crypto.randomUUID()
    const name = basename(url)
    const props: JsonObject = { backgroundColor: 'default', name, url: '', caption: title ?? '' }
    if (kind === 'image') Object.assign(props, { textAlignment: 'left', showPreview: true, alt })
    if (/^https?:\/\//i.test(url) || ATTACHMENT_URL.test(url)) props.url = url
    else if (/^data:/i.test(url)) this.notes.add('Inline data: images were left empty; save them as files and upload them.')
    else {
      const mapped = this.resolve(url)
      if (mapped !== null) props.url = mapped
      else this.assets.push({ path: normalizePath(url), kind, block_id: id, label: alt || name })
    }
    return { id, type: kind, props, content: [], children: [] }
  }

  private resolve(path: string): string | null {
    const normalized = normalizePath(path)
    const candidates = [path, normalized, basename(normalized)]
    for (const candidate of candidates) {
      const mapped = this.mapping.get(candidate)
      if (mapped !== undefined) return mapped
    }
    return null
  }

  /** Inline content for a block that cannot hold images; any image inside is described in text instead. */
  private inlineOrHoist(children: readonly PhrasingContent[], where: string): Inline[] {
    const inline = this.inline(children)
    if (children.some((child) => this.imageNode(child) !== null)) this.notes.add(`An image inside a ${where} was kept as its alt text.`)
    return inline
  }

  private inline(children: readonly PhrasingContent[], styles: Styles = {}, href: string | null = null): Inline[] {
    const out: Inline[] = []
    for (const child of children) {
      switch (child.type) {
        case 'text': out.push(text(child.value, styles)); break
        case 'break': out.push(text('\n', styles)); break
        case 'inlineCode': out.push(text(child.value, { ...styles, code: true })); break
        case 'strong': out.push(...this.inline(child.children, { ...styles, bold: true }, href)); break
        case 'emphasis': out.push(...this.inline(child.children, { ...styles, italic: true }, href)); break
        case 'delete': out.push(...this.inline(child.children, { ...styles, strike: true }, href)); break
        case 'inlineMath': out.push({ type: 'math', content: child.value }); break
        case 'link': out.push(this.link(child.url, this.inline(child.children, styles, child.url), plainText(child))); break
        case 'linkReference': {
          const definition = this.definitions.get(child.identifier)
          if (definition === undefined) out.push(text(plainText(child), styles))
          else out.push(this.link(definition.url, this.inline(child.children, styles, definition.url), plainText(child)))
          break
        }
        case 'image': case 'imageReference': {
          const image = this.imageNode(child)
          if (image !== null && image.alt !== '') out.push(text(image.alt, styles))
          break
        }
        case 'footnoteReference': out.push(text(`[^${child.label ?? child.identifier}]`, styles)); break
        case 'html': {
          const image = this.imageNode(child)
          if (image !== null) { if (image.alt !== '') out.push(text(image.alt, styles)); break }
          const stripped = child.value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
          if (stripped !== '') out.push(text(stripped, styles))
          break
        }
        default: out.push(text(plainText(child), styles))
      }
    }
    return mergeText(out)
  }

  /** Links keep remote and note addresses; a link to a local file is text here and a file block after the paragraph. */
  private link(url: string, content: Inline[], label: string): Inline {
    if (isLocalPath(url) && FILE_EXTENSIONS.test(url)) return text(label, {})
    if (isLocalPath(url) && !url.startsWith('#')) {
      this.notes.add(`A link to a local page was kept as text: ${url}.`)
      return text(label, {})
    }
    const linkContent = content.filter((item) => item.type === 'text')
    return { type: 'link', href: url, content: linkContent.length > 0 ? linkContent : [text(label, {})] }
  }
}

function splitFrontMatter(markdown: string): { body: string; frontMatter: string | null } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown)
  if (match === null) return { body: markdown, frontMatter: null }
  return { body: markdown.slice(match[0].length), frontMatter: match[1] ?? '' }
}

/** Obsidian embeds and wikilinks become ordinary Markdown images and text before parsing. */
function rewriteWikilinks(markdown: string): string {
  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, target: string, alias: string | undefined) => `![${alias ?? ''}](${encodeURI(target.trim())})`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, target: string, alias: string | undefined) => (alias ?? target).trim())
}

function isLocalPath(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url)
}

function normalizePath(path: string): string {
  let decoded = path
  try { decoded = decodeURIComponent(path) } catch { /* keep the raw path when it is not percent-encoded */ }
  return decoded.replace(/^\.\//, '').replace(/\\/g, '/')
}

function basename(path: string): string {
  const normalized = normalizePath(path).split(/[?#]/)[0] ?? ''
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function textProps(): JsonObject {
  return { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }
}

function block(type: string, props: JsonObject, content: Inline[], children: Block[] = []): Block {
  return { id: crypto.randomUUID(), type, props, content, children }
}

function paragraph(content: Inline[]): Block {
  return block('paragraph', textProps(), content)
}

function text(value: string, styles: Styles): Inline {
  const applied: JsonObject = {}
  for (const [name, on] of Object.entries(styles)) if (on === true) applied[name] = true
  return { type: 'text', text: value, styles: applied }
}

function mergeText(items: readonly Inline[]): Inline[] {
  const out: Inline[] = []
  for (const item of items) {
    const previous = out[out.length - 1]
    if (previous !== undefined && previous.type === 'text' && item.type === 'text' && JSON.stringify(previous.styles) === JSON.stringify(item.styles)) {
      out[out.length - 1] = { ...previous, text: `${String(previous.text)}${String(item.text)}` }
    } else out.push(item)
  }
  return out
}

function trimInline(items: readonly Inline[]): Inline[] {
  const out = [...items]
  const edge = (index: number, trim: (value: string) => string): void => {
    const item = out[index]
    if (item === undefined || item.type !== 'text') return
    const trimmed = trim(String(item.text))
    if (trimmed === '') out.splice(index, 1)
    else out[index] = { ...item, text: trimmed }
  }
  edge(0, (value) => value.replace(/^\s+/, ''))
  edge(out.length - 1, (value) => value.replace(/\s+$/, ''))
  return out
}

function flattenParagraphs(nodes: readonly RootContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = []
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      if (out.length > 0) out.push({ type: 'text', value: ' ' })
      out.push(...node.children)
    }
  }
  return out
}

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node) return node.children.map((child: Nodes) => plainText(child)).join('')
  return ''
}

/**
 * Converts Markdown to note blocks. `assets` maps a path as written in the Markdown (or its decoded form
 * or bare file name) to a ready `manor-attachment://` URL.
 */
export function markdownToNoteBlocks(markdown: string, assets: Readonly<Record<string, JsonValue>>): MarkdownConversion {
  const mapping = new Map<string, string>()
  for (const [path, url] of Object.entries(assets)) {
    if (typeof url !== 'string' || !ATTACHMENT_URL.test(url)) throw new TypeError(`Asset ${path} must map to a manor-attachment:// URL of a ready file`)
    mapping.set(path, url)
    mapping.set(normalizePath(path), url)
  }
  return new Conversion(mapping).convert(markdown)
}
