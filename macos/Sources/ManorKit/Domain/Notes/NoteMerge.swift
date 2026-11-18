import Foundation

/// Block-level three-way merge for note documents. A document is an ordered list of blocks with stable ids, so
/// two edits based on the same revision conflict only when they touch the same block or both reorder the list.
/// `JSONValue` equality ignores object key order, which is what the server's `jsonb` storage needs.
public enum NoteMerge {
  /// An edit to a live document, relative to the document the editor currently shows.
  public enum BlockOp: Hashable, Sendable {
    case insert(block: JSONValue, afterId: String?)
    case replace(id: String, block: JSONValue)
    case remove(id: String)
  }

  public enum Outcome: Hashable, Sendable {
    /// The merged document and the ops that turn `mine` into it.
    case clean(blocks: [JSONValue], ops: [BlockOp])
    /// The blocks both sides changed incompatibly; `order` when both reordered.
    case conflict(blockIds: [String])
  }

  public enum Change: Hashable, Sendable { case added, changed, removed }

  public struct MissingBlockId: LocalizedError {
    public var errorDescription: String? { "A block in this note has no id, so its edits cannot be merged." }
  }

  /// The id of a top-level block, or nil when the block has none.
  public static func blockId(_ block: JSONValue) -> String? {
    guard let id = block["id"]?.string, !id.isEmpty else { return nil }
    return id
  }

  /// Every block's id, failing when one is missing (merges need stable ids).
  static func ids(_ blocks: [JSONValue]) throws -> [String] {
    try blocks.map { block in
      guard let id = blockId(block) else { throw MissingBlockId() }
      return id
    }
  }

  private static func byId(_ blocks: [JSONValue]) -> [String: JSONValue] {
    var map: [String: JSONValue] = [:]
    for block in blocks { if let id = blockId(block) { map[id] = block } }
    return map
  }

  /// Blocks whose content, presence, or absence differs between two documents, in the order the TS service
  /// reports them: additions and edits in `next` order, then removals in `base` order.
  public static func blockChanges(_ base: [JSONValue], _ next: [JSONValue]) -> [(id: String, change: Change)] {
    let before = byId(base), after = byId(next)
    var changes: [(id: String, change: Change)] = []
    for block in next {
      guard let id = blockId(block) else { continue }
      if let original = before[id] {
        if original != block { changes.append((id, .changed)) }
      } else {
        changes.append((id, .added))
      }
    }
    for block in base {
      guard let id = blockId(block), after[id] == nil else { continue }
      changes.append((id, .removed))
    }
    return changes
  }

  /// Whether `next` orders the blocks it shares with `base` differently.
  static func reordered(_ base: [JSONValue], _ next: [JSONValue]) -> Bool {
    let nextIds = Set(next.compactMap(blockId)), baseIds = Set(base.compactMap(blockId))
    let baseOrder = base.compactMap(blockId).filter { nextIds.contains($0) }
    let nextOrder = next.compactMap(blockId).filter { baseIds.contains($0) }
    return baseOrder != nextOrder
  }

  /// The document that carries the `spine` order plus every change the other side made.
  static func overlay(spine: [JSONValue], other: [JSONValue], otherChanges: [String: Change]) -> [JSONValue] {
    let others = byId(other)
    var merged: [JSONValue] = []
    for block in spine {
      guard let id = blockId(block) else { merged.append(block); continue }
      let change = otherChanges[id]
      if change == .removed { continue }
      merged.append(change == .changed ? (others[id] ?? block) : block)
    }
    // Additions land after the nearest earlier block of the other document that survived the merge.
    for (index, block) in other.enumerated() {
      guard let id = blockId(block), otherChanges[id] == .added else { continue }
      var position = 0
      var cursor = index - 1
      while cursor >= 0 {
        if let anchor = blockId(other[cursor]), let at = merged.firstIndex(where: { blockId($0) == anchor }) {
          position = at + 1
          break
        }
        cursor -= 1
      }
      merged.insert(block, at: position)
    }
    return merged
  }

  /// Longest common subsequence of two id lists: the blocks that keep their relative order and need no move.
  static func stableIds(_ left: [String], _ right: [String]) -> Set<String> {
    let rows = left.count, columns = right.count
    guard rows > 0, columns > 0 else { return [] }
    var table = Array(repeating: Array(repeating: 0, count: columns + 1), count: rows + 1)
    for i in stride(from: rows - 1, through: 0, by: -1) {
      for j in stride(from: columns - 1, through: 0, by: -1) {
        table[i][j] = left[i] == right[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
      }
    }
    var kept = Set<String>()
    var i = 0, j = 0
    while i < rows && j < columns {
      if left[i] == right[j] { kept.insert(left[i]); i += 1; j += 1 }
      else if table[i + 1][j] >= table[i][j + 1] { i += 1 }
      else { j += 1 }
    }
    return kept
  }

  /// The edits that turn `shown` into `target`, for applying a merge to a live editor without replacing it.
  public static func documentOps(shown: [JSONValue], target: [JSONValue]) -> [BlockOp] {
    let before = byId(shown), after = byId(target)
    var ops: [BlockOp] = []
    for block in shown {
      if let id = blockId(block), after[id] == nil { ops.append(.remove(id: id)) }
    }
    let kept = stableIds(
      shown.compactMap(blockId).filter { after[$0] != nil },
      target.compactMap(blockId).filter { before[$0] != nil }
    )
    for (index, block) in target.enumerated() {
      guard let id = blockId(block) else { continue }
      let shownBlock = before[id]
      if let shownBlock, kept.contains(id) {
        if shownBlock != block { ops.append(.replace(id: id, block: block)) }
        continue
      }
      if shownBlock != nil { ops.append(.remove(id: id)) }
      ops.append(.insert(block: block, afterId: index == 0 ? nil : blockId(target[index - 1])))
    }
    return ops
  }

  /// Applies ops to a plain block list, for callers without a live editor.
  public static func apply(_ ops: [BlockOp], to blocks: [JSONValue]) -> [JSONValue] {
    var result = blocks
    for op in ops {
      switch op {
      case .remove(let id):
        if let at = result.firstIndex(where: { blockId($0) == id }) { result.remove(at: at) }
      case .replace(let id, let block):
        if let at = result.firstIndex(where: { blockId($0) == id }) { result[at] = block }
      case .insert(let block, let afterId):
        if let afterId {
          if let at = result.firstIndex(where: { blockId($0) == afterId }) { result.insert(block, at: at + 1) }
          else { result.append(block) }
        } else {
          result.insert(block, at: 0)
        }
      }
    }
    return result
  }

  /// Merges `mine` and `theirs`, both derived from `base`. Conflicts are blocks both sides changed differently,
  /// a block one side changed and the other removed, or both sides reordering the list.
  public static func merge(base: [JSONValue], mine: [JSONValue], theirs: [JSONValue]) throws -> Outcome {
    _ = try ids(base); _ = try ids(mine); _ = try ids(theirs)
    let mineChanges = blockChanges(base, mine), theirsChanges = blockChanges(base, theirs)
    let theirsMap = Dictionary(theirsChanges.map { ($0.id, $0.change) }, uniquingKeysWith: { first, _ in first })
    let mineMap = Dictionary(mineChanges.map { ($0.id, $0.change) }, uniquingKeysWith: { first, _ in first })
    let mineById = byId(mine), theirsById = byId(theirs)
    var conflicts: [String] = []
    for (id, change) in mineChanges {
      guard let other = theirsMap[id] else { continue }
      if change == .removed && other == .removed { continue }
      if change != .removed && other != .removed && mineById[id] == theirsById[id] { continue }
      conflicts.append(id)
    }
    let mineReordered = reordered(base, mine), theirsReordered = reordered(base, theirs)
    if mineReordered && theirsReordered { conflicts.append("order") }
    if !conflicts.isEmpty { return .conflict(blockIds: conflicts) }
    let merged = theirsReordered
      ? overlay(spine: theirs, other: mine, otherChanges: mineMap)
      : overlay(spine: mine, other: theirs, otherChanges: theirsMap)
    return .clean(blocks: merged, ops: documentOps(shown: mine, target: merged))
  }

  /// The merged title, or nil when both sides retitled differently.
  public static func mergeTitle(base: String, mine: String, theirs: String) -> String? {
    let mineTitle = mine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled" : mine.trimmingCharacters(in: .whitespacesAndNewlines)
    if mineTitle != base && theirs != base && mineTitle != theirs { return nil }
    return mineTitle != base ? mine : theirs
  }
}
