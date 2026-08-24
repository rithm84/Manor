import { BlockNoteEditor } from '@blocknote/core'
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { describe, expect, it } from 'vitest'

import { noteEditorSchema } from './noteEditorSchema'

describe('note editor document schema', () => {
  it('keeps document blocks while intentionally excluding checklist blocks', () => {
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
    expect(noteEditorSchema.blockSchema).not.toHaveProperty('checkListItem')
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
})
