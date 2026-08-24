import type { NoteFolder, NotePage } from '../../../../shared/notes'

export type NotesScope =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'archived'
  | 'trash'
  | `folder:${string}`

export interface NoteTreeRow {
  page: NotePage
  depth: number
}

function inlineText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(inlineText).join(' ')
  if (typeof value !== 'object' || value === null) return ''
  const record = value as Record<string, unknown>
  return [record.text, record.content, record.children, record.caption, record.name]
    .map(inlineText)
    .filter(Boolean)
    .join(' ')
}

export function searchableNoteText(page: NotePage): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(page.contentJson)
  } catch {
    return page.title.toLowerCase()
  }
  return `${page.title} ${inlineText(parsed)}`.toLowerCase()
}

export function pagesForScope(
  pages: readonly NotePage[],
  scope: NotesScope,
  query: string
): readonly NotePage[] {
  const normalized = query.trim().toLowerCase()
  return pages
    .filter((page) => {
      if (scope === 'trash') return page.status === 'trash'
      if (scope === 'archived') return page.status === 'archived'
      if (page.status !== 'active') return false
      if (scope === 'favorites') return page.favorite
      if (scope.startsWith('folder:')) return page.folderId === scope.slice(7)
      return true
    })
    .filter((page) => normalized === '' || searchableNoteText(page).includes(normalized))
    .sort((left, right) => {
      const leftDate = scope === 'recent' ? left.lastOpenedAt : left.updatedAt
      const rightDate = scope === 'recent' ? right.lastOpenedAt : right.updatedAt
      return rightDate.localeCompare(leftDate)
    })
}

export function treeRows(pages: readonly NotePage[]): readonly NoteTreeRow[] {
  const pageIds = new Set(pages.map((page) => page.id))
  const children = new Map<string | null, NotePage[]>()
  pages.forEach((page) => {
    const parentId = page.parentPageId !== null && pageIds.has(page.parentPageId)
      ? page.parentPageId
      : null
    children.set(parentId, [...(children.get(parentId) ?? []), page])
  })
  children.forEach((group) => group.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
  const rows: NoteTreeRow[] = []
  const visit = (parentId: string | null, depth: number): void => {
    ;(children.get(parentId) ?? []).forEach((page) => {
      rows.push({ page, depth })
      visit(page.id, depth + 1)
    })
  }
  visit(null, 0)
  return rows
}

export function scopeTitle(scope: NotesScope, folders: readonly NoteFolder[]): string {
  if (!scope.startsWith('folder:')) return scope[0].toUpperCase() + scope.slice(1)
  return folders.find((folder) => folder.id === scope.slice(7))?.name ?? 'Folder'
}

export function formatNoteTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}
