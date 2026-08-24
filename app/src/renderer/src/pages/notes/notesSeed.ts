import type { NotePage, NotesSeed } from '../../../../shared/notes'
import { noteFolders, openDoc } from '../../data/mock'

const SEED_TIME = '2026-08-22T16:00:00.000Z'

function text(textValue: string): readonly Record<string, unknown>[] {
  return [{ type: 'text', text: textValue, styles: {} }]
}

function paragraph(textValue: string): Record<string, unknown> {
  return { type: 'paragraph', content: text(textValue), children: [] }
}

function openDocumentContent(): string {
  const blocks = openDoc.blocks.flatMap((block) => {
    if (block.kind === 'heading') {
      return [{ type: 'heading', props: { level: 2 }, content: text(block.text), children: [] }]
    }
    if (block.kind === 'paragraph') return [paragraph(block.text)]
    if (block.kind === 'code') {
      return [{
        type: 'codeBlock',
        props: { language: block.language },
        content: text(block.code),
        children: []
      }]
    }
    return [{
      type: 'callout',
      props: { tone: 'info' },
      content: text(block.caption),
      children: []
    }]
  })
  return JSON.stringify(blocks)
}

function seedPage(id: string, title: string, folderId: string, order: number): NotePage {
  const timestamp = new Date(Date.parse(SEED_TIME) - order * 3_600_000).toISOString()
  return {
    id,
    title,
    folderId,
    parentPageId: null,
    contentJson: id === openDoc.id ? openDocumentContent() : JSON.stringify([paragraph('')]),
    favorite: id === openDoc.id,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    archivedAt: null,
    deletedAt: null
  }
}

export const notesSeed: NotesSeed = {
  folders: noteFolders.map((folder, index) => ({
    id: folder.id,
    name: folder.name,
    parentFolderId: null,
    createdAt: new Date(Date.parse(SEED_TIME) - index * 86_400_000).toISOString(),
    updatedAt: SEED_TIME
  })),
  pages: noteFolders.flatMap((folder) =>
    folder.docs.map((page, index) => seedPage(page.id, page.title, folder.id, index))
  )
}
