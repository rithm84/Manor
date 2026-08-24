import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  createCodeBlockSpec
} from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { createReactInlineMathSpec, createReactMathBlockSpec } from '@blocknote/math-block'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  tableOfContentsBlock,
  twoColumnsBlock,
  webBookmarkBlock,
  webEmbedBlock
} from './noteAdvancedBlocks'

const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      tone: {
        default: 'plum',
        values: ['plum', 'info', 'warning', 'success'] as const
      }
    },
    content: 'inline'
  },
  {
    render: ({ block, contentRef }): ReactNode => (
      <aside className={`note-callout note-callout--${block.props.tone}`}>
        <Info size={17} aria-hidden="true" />
        <div ref={contentRef} className="note-callout-content" />
      </aside>
    ),
    toExternalHTML: ({ block, contentRef }): ReactNode => (
      <aside data-callout-tone={block.props.tone}>
        <div ref={contentRef} />
      </aside>
    )
  }
)()

const pageMention = createReactInlineContentSpec(
  {
    type: 'pageMention',
    propSchema: {
      pageId: { default: '' },
      title: { default: 'Untitled' }
    },
    content: 'none'
  },
  {
    render: ({ inlineContent }): ReactNode => (
      <button
        type="button"
        className="note-page-mention"
        data-page-id={inlineContent.props.pageId}
        contentEditable={false}
        onClick={() => window.dispatchEvent(new CustomEvent('manor:open-note', {
          detail: inlineContent.props.pageId
        }))}
      >
        {inlineContent.props.title}
      </button>
    ),
    toExternalHTML: ({ inlineContent }): ReactNode => (
      <a href={`manor-note://${inlineContent.props.pageId}`}>{inlineContent.props.title}</a>
    )
  }
)

const { checkListItem: _checkListItem, codeBlock: _codeBlock, ...documentBlockSpecs } =
  defaultBlockSpecs

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...documentBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    callout: calloutBlock,
    twoColumns: twoColumnsBlock,
    mathBlock: createReactMathBlockSpec(),
    tableOfContents: tableOfContentsBlock,
    webBookmark: webBookmarkBlock,
    webEmbed: webEmbedBlock
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: createReactInlineMathSpec(),
    pageMention
  },
  styleSpecs: defaultStyleSpecs
})

export type NoteEditor = typeof noteEditorSchema.BlockNoteEditor
export type NoteEditorBlock = typeof noteEditorSchema.Block
