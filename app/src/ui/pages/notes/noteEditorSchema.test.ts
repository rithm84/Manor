import { BlockNoteEditor } from '@blocknote/core'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { describe, expect, it } from 'vitest'

import { noteEditorSchema } from './noteEditorSchema'

describe('note editor document schema', () => {
  it('keeps the rich document fundamentals including local checkboxes', () => {
    expect(Object.keys(noteEditorSchema.blockSchema)).toEqual(expect.arrayContaining([
      'paragraph',
      'heading',
      'bulletListItem',
      'numberedListItem',
      'toggleListItem',
      'quote',
      'divider',
      'codeBlock',
      'table',
      'image',
      'file',
      'callout',
      'twoColumns',
      'mathBlock',
      'tableOfContents',
      'webBookmark',
      'webEmbed'
    ]))
    expect(noteEditorSchema.blockSchema).toHaveProperty('checkListItem')
    expect(noteEditorSchema.inlineContentSchema).toHaveProperty('math')
  })

  it('replaces slash input with a self-contained two-column block', () => {
    const editor = BlockNoteEditor.create({
      schema: noteEditorSchema,
      initialContent: [{ type: 'paragraph', content: '/' }]
    })

    insertOrUpdateBlockForSlashMenu(editor, { type: 'twoColumns', props: { ratio: 50 } })

    expect(editor.document[0]).toMatchObject({
      type: 'twoColumns',
      props: { ratio: 50 }
    })
    expect(editor.document[0]?.children).toEqual([])
  })

  it('edits native child blocks inside columns and tabs by stable ID', () => {
    const editor = BlockNoteEditor.create({ schema: noteEditorSchema, initialContent: [{
      id: 'layout', type: 'documentTabs', children: [{
        id: 'tab', type: 'documentTab', props: { title: 'Research' }, children: [{
          id: 'columns', type: 'twoColumns', children: [{
            id: 'left', type: 'noteColumn', children: [{ id: 'target', type: 'paragraph', content: 'Before' }]
          }, { id: 'right', type: 'noteColumn', children: [{ type: 'paragraph', content: 'Right' }] }]
        }]
      }]
    }] })
    editor.updateBlock('target', { content: 'After' })
    expect(editor.getBlock('target')).toMatchObject({ id: 'target', content: [{ text: 'After' }] })
    expect(JSON.stringify(editor.document)).toContain('Right')
    expect(JSON.stringify(editor.document)).not.toContain('leftContent')
  })
})
