// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { blockIdForFragment, contentJsonToMarkdown, fragmentLink, markdownToContentJson } from './RichNoteEditor'
import type { PortableBlock } from './RichNoteEditor'

describe('Notes Markdown interchange', () => {
  it('imports document blocks and preserves code text in native JSON', () => {
    const nativeJson = markdownToContentJson([
      '# Imported heading',
      '',
      '> Quoted text',
      '',
      '```ts',
      'const answer = 42',
      '  // intentional indentation',
      '```'
    ].join('\n'))
    const blocks = JSON.parse(nativeJson) as Array<{
      type: string
      content?: string | Array<{ type: string; text: string; styles: Record<string, string> }>
    }>

    expect(blocks.map((block) => block.type)).toEqual(['heading', 'quote', 'codeBlock'])
    expect(blocks[2]?.content).toEqual([{
      type: 'text',
      text: 'const answer = 42\n  // intentional indentation',
      styles: {}
    }])
  })

  it('exports native headings, lists, links, and tables as practical Markdown', () => {
    const nativeJson = markdownToContentJson([
      '## Reference',
      '',
      '- [BlockNote](https://www.blocknotejs.org/)',
      '',
      '| Topic | Status |',
      '| --- | --- |',
      '| Notes | Ready |'
    ].join('\n'))
    const markdown = contentJsonToMarkdown(nativeJson)

    expect(markdown).toContain('## Reference')
    expect(markdown).toContain('[BlockNote](https://www.blocknotejs.org/)')
    expect(markdown).toContain('| Topic')
    expect(markdown).toContain('| Notes')
  })

  it('round-trips block and inline equations through Markdown boundaries', () => {
    const nativeJson = markdownToContentJson([
      'Inline $E = mc^2$ relation.',
      '',
      '$$',
      '\\int_0^1 x^2 dx',
      '$$'
    ].join('\n'))
    const blocks = JSON.parse(nativeJson) as Array<{ type: string }>
    const markdown = contentJsonToMarkdown(nativeJson)

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'mathBlock'])
    expect(markdown).toContain('$E = mc^2$')
    expect(markdown).toContain('$$')
    expect(markdown).toContain('\\int_0^1 x^2 dx')
  })

  it('exports live contents and web blocks through honest Markdown equivalents', () => {
    const markdown = contentJsonToMarkdown(JSON.stringify([
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Research notes', styles: {} }], children: [] },
      { type: 'tableOfContents', props: {}, content: undefined, children: [] },
      { type: 'webBookmark', props: { url: 'https://example.com/source', title: 'Primary source' }, content: undefined, children: [] },
      { type: 'webEmbed', props: { url: 'https://example.com/embed', title: 'Reference view' }, content: undefined, children: [] }
    ]))

    expect(markdown).toContain('- [Research notes](#research-notes)')
    expect(markdown).toContain('[Primary source](https://example.com/source)')
    expect(markdown).toContain('[Embedded page: Reference view](https://example.com/embed)')
  })

  it('flattens persisted document columns without losing either column in Markdown', () => {
    const text = (value: string) => [{ type: 'text', text: value, styles: {} }]
    const column = (value: string) => JSON.stringify([{ type: 'paragraph', content: text(value), children: [] }])
    const markdown = contentJsonToMarkdown(JSON.stringify([{
      type: 'twoColumns',
      props: { ratio: 40, leftContent: column('Left column'), rightContent: column('Right column') },
      children: []
    }]))

    expect(markdown).toContain('Left column')
    expect(markdown).toContain('***')
    expect(markdown).toContain('Right column')
  })
})

describe('in-note fragment links', () => {
  const heading = (id: string, text: string, children: PortableBlock[] = []): PortableBlock => ({ id, type: 'heading', props: { level: 2 }, content: [{ type: 'text', text, styles: {} }], children })
  const document: PortableBlock[] = [
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'Intro', styles: {} }], children: [] },
    heading('h1', '1. The interview mental model'),
    heading('h2', 'Variables, assignment & truthiness', [heading('h2b', 'Nested: details')]),
    heading('h3', 'Recap'),
    heading('h4', 'Recap')
  ]

  it('resolves Markdown table-of-contents slugs to the heading blocks, including nested and repeated titles', () => {
    expect(blockIdForFragment(document, '#1-the-interview-mental-model')).toBe('h1')
    expect(blockIdForFragment(document, '#variables-assignment--truthiness')).toBe('h2')
    expect(blockIdForFragment(document, '#nested-details')).toBe('h2b')
    expect(blockIdForFragment(document, '#recap')).toBe('h3')
    expect(blockIdForFragment(document, '#recap-2')).toBe('h4')
    expect(blockIdForFragment(document, '#block=p1')).toBe('p1')
    expect(blockIdForFragment(document, '#missing')).toBeNull()
    expect(blockIdForFragment(document, '#')).toBeNull()
  })

  it('recognizes links that stay inside the note and ignores the rest', () => {
    const root = window.document.createElement('div')
    root.innerHTML = '<p><a id="toc" href="#recap">Recap</a> <a id="web" href="https://example.com/#recap">Web</a> <span id="plain">text</span></p>'
    window.document.body.append(root)
    const outside = window.document.createElement('a')
    outside.href = '#recap'
    window.document.body.append(outside)
    expect(fragmentLink(root.querySelector('#toc'), root)).toBe('#recap')
    expect(fragmentLink(root.querySelector('#web'), root)).toBeNull()
    expect(fragmentLink(root.querySelector('#plain'), root)).toBeNull()
    expect(fragmentLink(outside, root)).toBeNull()
    root.remove()
    outside.remove()
  })
})
