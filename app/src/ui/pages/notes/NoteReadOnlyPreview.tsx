import { BlockNoteView } from '@blocknote/ariakit'
import { useCreateBlockNote } from '@blocknote/react'
import type { ReactNode } from 'react'
import { useManorService } from '../../services/ManorServices'
import { blocksFromJson } from './RichNoteEditor'
import { noteEditorSchema } from './noteEditorSchema'
import { useNoteTheme } from './useNoteTheme'

export function NoteReadOnlyPreview({ contentJson }: { contentJson: string }): ReactNode {
  const notesApi = useManorService('notes')
  const theme = useNoteTheme()
  const parsed: unknown = JSON.parse(contentJson)
  const blocks = blocksFromJson(JSON.stringify(Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed]))
  const editor = useCreateBlockNote({ schema: noteEditorSchema, initialContent: blocks.length === 0 ? undefined : blocks,
    resolveFileUrl: async (url) => url.startsWith('manor-attachment://') ? notesApi.resolveAttachment(url.slice('manor-attachment://'.length)) : url
  }, [contentJson])
  return <BlockNoteView className="note-block-editor note-readonly-preview" editor={editor} theme={theme} editable={false}
    sideMenu={false} formattingToolbar={false} slashMenu={false} emojiPicker={false} />
}
