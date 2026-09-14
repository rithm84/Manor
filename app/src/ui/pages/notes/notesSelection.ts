/** Multi-select over the ordered note list: plain click, Shift for a range from the anchor, Cmd or Ctrl to toggle. */
export interface NoteSelection {
  readonly ids: readonly string[]
  readonly anchor: string | null
}

export const EMPTY_SELECTION: NoteSelection = { ids: [], anchor: null }

export interface SelectionModifiers {
  readonly range: boolean
  readonly toggle: boolean
}

export function selectOne(id: string): NoteSelection {
  return { ids: [id], anchor: id }
}

export function selectAll(order: readonly string[]): NoteSelection {
  return { ids: [...order], anchor: order[0] ?? null }
}

/** The rows between the anchor and `id` in list order, inclusive; without an anchor the click starts the range. */
export function selectRange(selection: NoteSelection, order: readonly string[], id: string): NoteSelection {
  const anchor = selection.anchor ?? id
  const from = order.indexOf(anchor), to = order.indexOf(id)
  if (from < 0 || to < 0) return selectOne(id)
  const [start, end] = from <= to ? [from, to] : [to, from]
  return { ids: order.slice(start, end + 1), anchor }
}

export function toggleSelection(selection: NoteSelection, id: string): NoteSelection {
  const ids = selection.ids.includes(id) ? selection.ids.filter((candidate) => candidate !== id) : [...selection.ids, id]
  return { ids, anchor: id }
}

export function clickSelection(selection: NoteSelection, order: readonly string[], id: string, modifiers: SelectionModifiers): NoteSelection {
  if (modifiers.range) return selectRange(selection, order, id)
  if (modifiers.toggle) return toggleSelection(selection, id)
  return selectOne(id)
}

/** Drops rows that left the list (moved to Trash, restored, or filtered out). */
export function pruneSelection(selection: NoteSelection, order: readonly string[]): NoteSelection {
  const present = new Set(order)
  const ids = selection.ids.filter((id) => present.has(id))
  if (ids.length === selection.ids.length) return selection
  return { ids, anchor: selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : ids[0] ?? null }
}
