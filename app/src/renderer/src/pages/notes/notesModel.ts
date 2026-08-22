import type { NoteDoc, NoteFolder } from '../../data/mock'

/** Local, mutable copies of the mock folders; interactions stay in page state. */
export interface LocalDoc {
  id: string
  title: string
  updatedLabel: string
}

export interface LocalFolder {
  id: string
  name: string
  docs: readonly LocalDoc[]
}

function toLocalDoc(doc: NoteDoc): LocalDoc {
  return { id: doc.id, title: doc.title, updatedLabel: doc.updatedLabel }
}

export function toLocalFolder(folder: NoteFolder): LocalFolder {
  return { id: folder.id, name: folder.name, docs: folder.docs.map(toLocalDoc) }
}
