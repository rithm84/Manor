import { z } from 'zod'

/**
 * Block-level three-way merge for note documents. A document is an ordered list of blocks with stable ids, so two
 * edits based on the same revision conflict only when they touch the same block or both reorder the list.
 */

const blockSchema = z.object({ id: z.string().min(1) }).catchall(z.json())
export type NoteBlock = z.infer<typeof blockSchema>

/** An edit to a live document, relative to the document the editor currently shows. */
export type BlockOp =
  | { kind: 'insert'; block: NoteBlock; afterId: string | null }
  | { kind: 'replace'; id: string; block: NoteBlock }
  | { kind: 'remove'; id: string }

export type MergeOutcome =
  | { status: 'clean'; contentJson: string; ops: readonly BlockOp[] }
  | { status: 'conflict'; blockIds: readonly string[] }

export function parseBlocks(contentJson: string): NoteBlock[] {
  return z.array(blockSchema).parse(JSON.parse(contentJson))
}

/** Stable serialization: the server stores jsonb, which reorders object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return inner
    const record = inner as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))
  })
}

const sameBlock = (left: NoteBlock | undefined, right: NoteBlock | undefined): boolean =>
  left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right)
const byId = (blocks: readonly NoteBlock[]): Map<string, NoteBlock> => new Map(blocks.map((block) => [block.id, block]))

type Change = 'added' | 'changed' | 'removed'

/** Blocks whose content, presence, or absence differs between two documents. */
export function blockChanges(base: readonly NoteBlock[], next: readonly NoteBlock[]): Map<string, Change> {
  const before = byId(base), after = byId(next)
  const changes = new Map<string, Change>()
  for (const [id, block] of after) {
    const original = before.get(id)
    if (original === undefined) changes.set(id, 'added')
    else if (!sameBlock(original, block)) changes.set(id, 'changed')
  }
  for (const id of before.keys()) if (!after.has(id)) changes.set(id, 'removed')
  return changes
}

/** Whether `next` orders the blocks it shares with `base` differently. */
function reordered(base: readonly NoteBlock[], next: readonly NoteBlock[]): boolean {
  const shared = new Set(next.map((block) => block.id))
  const baseOrder = base.filter((block) => shared.has(block.id)).map((block) => block.id)
  const baseIds = new Set(base.map((block) => block.id))
  const nextOrder = next.filter((block) => baseIds.has(block.id)).map((block) => block.id)
  return baseOrder.join('\n') !== nextOrder.join('\n')
}

/** The document that carries the `spine` order plus every change the other side made. */
function overlay(spine: readonly NoteBlock[], other: readonly NoteBlock[], otherChanges: ReadonlyMap<string, Change>): NoteBlock[] {
  const others = byId(other)
  const merged: NoteBlock[] = []
  for (const block of spine) {
    const change = otherChanges.get(block.id)
    if (change === 'removed') continue
    const replacement = change === 'changed' ? others.get(block.id) : undefined
    merged.push(replacement ?? block)
  }
  // Additions land after the nearest earlier block of the other document that survived the merge.
  for (const [index, block] of other.entries()) {
    if (otherChanges.get(block.id) !== 'added') continue
    let position = 0
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const anchorId = other[cursor]?.id
      const at = merged.findIndex((candidate) => candidate.id === anchorId)
      if (at >= 0) { position = at + 1; break }
    }
    merged.splice(position, 0, block)
  }
  return merged
}

/** Longest common subsequence of two id lists: the blocks that keep their relative order and need no move. */
function stableIds(left: readonly string[], right: readonly string[]): Set<string> {
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i -= 1) for (let j = right.length - 1; j >= 0; j -= 1) {
    table[i]![j] = left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  }
  const kept = new Set<string>()
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (left[i] === right[j]) { kept.add(left[i]!); i += 1; j += 1 }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1
    else j += 1
  }
  return kept
}

/** The edits that turn `shown` into `target`, for applying a merge to a live editor without replacing the document. */
export function documentOps(shown: readonly NoteBlock[], target: readonly NoteBlock[]): BlockOp[] {
  const before = byId(shown), after = byId(target)
  const ops: BlockOp[] = []
  for (const block of shown) if (!after.has(block.id)) ops.push({ kind: 'remove', id: block.id })
  const kept = stableIds(shown.filter((block) => after.has(block.id)).map((block) => block.id), target.filter((block) => before.has(block.id)).map((block) => block.id))
  for (const [index, block] of target.entries()) {
    const shownBlock = before.get(block.id)
    if (shownBlock !== undefined && kept.has(block.id)) {
      if (!sameBlock(shownBlock, block)) ops.push({ kind: 'replace', id: block.id, block })
      continue
    }
    if (shownBlock !== undefined) ops.push({ kind: 'remove', id: block.id })
    ops.push({ kind: 'insert', block, afterId: index === 0 ? null : target[index - 1]?.id ?? null })
  }
  return ops
}

/** Applies editor ops to a plain block list, for callers without a live editor. */
export function applyBlockOps(blocks: readonly NoteBlock[], ops: readonly BlockOp[]): NoteBlock[] {
  const result = [...blocks]
  for (const op of ops) {
    if (op.kind === 'remove') { const at = result.findIndex((block) => block.id === op.id); if (at >= 0) result.splice(at, 1); continue }
    if (op.kind === 'replace') { const at = result.findIndex((block) => block.id === op.id); if (at >= 0) result[at] = op.block; continue }
    const at = op.afterId === null ? 0 : result.findIndex((block) => block.id === op.afterId) + 1
    result.splice(at < 0 ? result.length : at, 0, op.block)
  }
  return result
}

/**
 * Merges `mine` and `theirs`, both derived from `base`. Conflicts are blocks both sides changed differently, a block
 * one side changed and the other removed, or both sides reordering the list. The returned ops transform `mine` into
 * the merged document.
 */
export function mergeDocuments(baseJson: string, mineJson: string, theirsJson: string): MergeOutcome {
  const base = parseBlocks(baseJson), mine = parseBlocks(mineJson), theirs = parseBlocks(theirsJson)
  const mineChanges = blockChanges(base, mine), theirsChanges = blockChanges(base, theirs)
  const mineById = byId(mine), theirsById = byId(theirs)
  const blockIds: string[] = []
  for (const [id, change] of mineChanges) {
    const other = theirsChanges.get(id)
    if (other === undefined) continue
    if (change === 'removed' && other === 'removed') continue
    if (change !== 'removed' && other !== 'removed' && sameBlock(mineById.get(id), theirsById.get(id))) continue
    blockIds.push(id)
  }
  const mineReordered = reordered(base, mine), theirsReordered = reordered(base, theirs)
  if (mineReordered && theirsReordered) blockIds.push('order')
  if (blockIds.length > 0) return { status: 'conflict', blockIds }
  const merged = theirsReordered ? overlay(theirs, mine, mineChanges) : overlay(mine, theirs, theirsChanges)
  return { status: 'clean', contentJson: JSON.stringify(merged), ops: documentOps(mine, merged) }
}
