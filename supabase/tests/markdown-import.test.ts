import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'

import { markdownToNoteBlocks } from '../functions/_shared/markdownImport.ts'
import type { JsonObject, JsonValue } from '../functions/_shared/toolDefinitions.ts'

const FILE_A = 'manor-attachment://11111111-1111-4111-8111-111111111111'
const FILE_B = 'manor-attachment://22222222-2222-4222-8222-222222222222'

function types(blocks: readonly JsonObject[]): string[] {
  return blocks.map((block) => String(block.type))
}

function content(block: JsonObject): JsonObject[] {
  return block.content as JsonObject[]
}

function props(block: JsonObject): JsonObject {
  return block.props as JsonObject
}

function allIds(blocks: readonly JsonValue[], out: string[] = []): string[] {
  for (const block of blocks) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
    out.push(String(block.id))
    if (Array.isArray(block.children)) allIds(block.children, out)
  }
  return out
}

Deno.test('maps the common document structure to native blocks with unique ids', () => {
  const result = markdownToNoteBlocks([
    '# Title',
    '',
    'Plain **bold** and *italic* with `code` and ~~gone~~ and a [link](https://example.com/a).',
    '',
    '- one',
    '- two',
    '  - nested',
    '',
    '1. first',
    '2. second',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '> quoted',
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '---',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    'Inline $x^2$ math.'
  ].join('\n'), {})

  assertEquals(types(result.blocks), ['heading', 'paragraph', 'bulletListItem', 'bulletListItem', 'numberedListItem', 'numberedListItem', 'checkListItem', 'checkListItem', 'quote', 'codeBlock', 'divider', 'table', 'mathBlock', 'paragraph'])
  assertEquals(props(result.blocks[0]!).level, 1)
  assertEquals(content(result.blocks[1]!), [
    { type: 'text', text: 'Plain ', styles: {} },
    { type: 'text', text: 'bold', styles: { bold: true } },
    { type: 'text', text: ' and ', styles: {} },
    { type: 'text', text: 'italic', styles: { italic: true } },
    { type: 'text', text: ' with ', styles: {} },
    { type: 'text', text: 'code', styles: { code: true } },
    { type: 'text', text: ' and ', styles: {} },
    { type: 'text', text: 'gone', styles: { strike: true } },
    { type: 'text', text: ' and a ', styles: {} },
    { type: 'link', href: 'https://example.com/a', content: [{ type: 'text', text: 'link', styles: {} }] },
    { type: 'text', text: '.', styles: {} }
  ])
  assertEquals(types(result.blocks[3]!.children as JsonObject[]), ['bulletListItem'])
  assertEquals(props(result.blocks[6]!).checked, false)
  assertEquals(props(result.blocks[7]!).checked, true)
  assertEquals(props(result.blocks[9]!).language, 'ts')
  assertEquals(content(result.blocks[9]!)[0]!.text, 'const x = 1')
  const table = result.blocks[11]!.content as JsonObject
  assertEquals(table.type, 'tableContent')
  assertEquals((table.rows as JsonObject[]).length, 2)
  assertEquals(result.blocks[12]!.content, 'E = mc^2')
  assertEquals(content(result.blocks[13]!)[1], { type: 'math', content: 'x^2' })
  const ids = allIds(result.blocks)
  assertEquals(new Set(ids).size, ids.length)
  assert(ids.every((id) => /^[0-9a-f-]{36}$/.test(id)))
  assertEquals(result.assets, [])
})

Deno.test('turns local images into attachment blocks when mapped and reports the rest', () => {
  const result = markdownToNoteBlocks([
    'Before ![Diagram](assets/Diagram%201.png) after',
    '',
    '![[Pasted image.png|pasted]]',
    '',
    '<img src="./shot.png" alt="Shot">',
    '',
    '![remote](https://cdn.example.com/x.png)'
  ].join('\n'), { 'assets/Diagram 1.png': FILE_A, 'shot.png': FILE_B })

  assertEquals(types(result.blocks), ['paragraph', 'image', 'paragraph', 'image', 'image', 'image'])
  assertEquals(props(result.blocks[1]!).url, FILE_A)
  assertEquals(props(result.blocks[1]!).alt, 'Diagram')
  assertEquals(props(result.blocks[1]!).name, 'Diagram 1.png')
  assertEquals(props(result.blocks[3]!).url, '')
  assertEquals(props(result.blocks[4]!).url, FILE_B)
  assertEquals(props(result.blocks[5]!).url, 'https://cdn.example.com/x.png')
  assertEquals(result.assets, [{ path: 'Pasted image.png', kind: 'image', block_id: String(result.blocks[3]!.id), label: 'pasted' }])
})

Deno.test('keeps file links as text, adds a file block when uploaded, and lists it otherwise', () => {
  const result = markdownToNoteBlocks('See [the report](files/report.pdf) and [notes](notes/other.pdf).', { 'files/report.pdf': FILE_A })
  assertEquals(types(result.blocks), ['paragraph', 'file'])
  assertEquals(content(result.blocks[0]!).map((item) => item.type), ['text'])
  assertEquals(props(result.blocks[1]!).url, FILE_A)
  assertEquals(props(result.blocks[1]!).name, 'report.pdf')
  assertEquals(result.assets, [{ path: 'notes/other.pdf', kind: 'file', block_id: null, label: 'notes' }])
})

Deno.test('removes front matter, rewrites wikilinks, and never returns an empty document', () => {
  const result = markdownToNoteBlocks('---\ntitle: Hello\ntags: [a]\n---\n\nSee [[Other page|the other one]].', {})
  assertEquals(result.frontMatter, 'title: Hello\ntags: [a]')
  assertEquals(content(result.blocks[0]!), [{ type: 'text', text: 'See the other one.', styles: {} }])
  assert(result.notes.some((note) => note.startsWith('Front matter')))
  assertEquals(types(markdownToNoteBlocks('', {}).blocks), ['paragraph'])
})

Deno.test('rejects asset mappings that are not ready attachment URLs', () => {
  assertThrows(() => markdownToNoteBlocks('![a](a.png)', { 'a.png': 'https://elsewhere.example/a.png' }), TypeError, 'manor-attachment://')
})

Deno.test('the tool creates through import_note at revision 0 and replaces through update_note afterwards', async () => {
  const { executeManorTool } = await import('../functions/_shared/toolExecution.ts')
  const calls: { name: string; parameters: JsonObject }[] = []
  const client = {
    rpc(name: string, parameters: JsonObject): Promise<JsonValue> {
      calls.push({ name, parameters })
      return Promise.resolve({ command_id: 'c', operation: String((parameters as JsonObject).p_operation), record: { id: 'note-1', revision: calls.length }, replayed: false })
    },
    invoke(): Promise<JsonValue> { return Promise.reject(new Error('not used')) },
    convertMarkdown: markdownToNoteBlocks
  }
  const created = await executeManorTool('import_markdown_note', { command_id: 'c1', id: 'note-1', expected_revision: 0, title: 'Imported', folder_id: null, parent_page_id: null, markdown: '# Hi\n\n![a](a.png)' }, client) as JsonObject
  const first = calls[0]!.parameters as JsonObject
  assertEquals(first.p_operation, 'import_note')
  assertEquals((first.p_input as JsonObject).format, 'block_json')
  assertEquals((first.p_input as JsonObject).title, 'Imported')
  const importReport = created.import as JsonObject
  assertEquals((importReport.assets as JsonObject[]).length, 1)
  assertEquals(importReport.block_count, 2)

  await executeManorTool('import_markdown_note', { command_id: 'c2', id: 'note-1', expected_revision: 1, title: 'Imported', markdown: '# Hi\n\n![a](a.png)', assets: { 'a.png': FILE_A } }, client)
  const second = calls[1]!.parameters as JsonObject
  assertEquals(second.p_operation, 'update_note')
  assertEquals((second.p_input as JsonObject).expected_revision, 1)
  assert(!('format' in (second.p_input as JsonObject)))
  const blocks = (second.p_input as JsonObject).content_json as JsonObject[]
  assertEquals(props(blocks[1]!).url, FILE_A)
})
