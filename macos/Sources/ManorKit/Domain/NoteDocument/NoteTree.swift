import Foundation

/// Where a block sits: the index path from the document root.
public typealias NoteBlockPath = [Int]

/// Tree operations on a note's block array, addressed by stable block id.
public extension Array where Element == NoteBlock {
  /// The index path of a block, searching depth first.
  func path(of id: String) -> NoteBlockPath? {
    for (index, block) in enumerated() {
      if block.id == id { return [index] }
      if let inner = block.children.path(of: id) { return [index] + inner }
    }
    return nil
  }

  subscript(path path: NoteBlockPath) -> NoteBlock? {
    get {
      guard let first = path.first, indices.contains(first) else { return nil }
      if path.count == 1 { return self[first] }
      return self[first].children[path: Array<Int>(path.dropFirst())]
    }
  }

  func block(id: String) -> NoteBlock? {
    guard let path = path(of: id) else { return nil }
    return self[path: path]
  }

  /// The id of the block that contains `id` as a child, or `nil` at the top level.
  func parentID(of id: String) -> String? {
    guard let path = path(of: id), path.count > 1 else { return nil }
    return self[path: Array<Int>(path.dropLast())]?.id
  }

  /// Applies `change` to the block with `id`. Returns whether the block was found.
  @discardableResult
  mutating func update(id: String, _ change: (inout NoteBlock) -> Void) -> Bool {
    guard let path = path(of: id) else { return false }
    update(path: path, change)
    return true
  }

  mutating func update(path: NoteBlockPath, _ change: (inout NoteBlock) -> Void) {
    guard let first = path.first, indices.contains(first) else { return }
    if path.count == 1 { change(&self[first]); return }
    self[first].children.update(path: Array<Int>(path.dropFirst()), change)
  }

  /// The sibling array that holds the block at `path`, mutated in place.
  mutating func updateSiblings(of path: NoteBlockPath, _ change: (inout [NoteBlock]) -> Void) {
    if path.count <= 1 { change(&self); return }
    update(path: Array<Int>(path.dropLast())) { parent in change(&parent.children) }
  }

  /// Removes the blocks with these ids wherever they are, returning them in document order.
  @discardableResult
  mutating func remove(ids: Set<String>) -> [NoteBlock] {
    var removed: [NoteBlock] = []
    removeAll(matching: ids, into: &removed)
    return removed
  }

  private mutating func removeAll(matching ids: Set<String>, into removed: inout [NoteBlock]) {
    var kept: [NoteBlock] = []
    kept.reserveCapacity(count)
    for var block in self {
      if ids.contains(block.id) { removed.append(block); continue }
      block.children.removeAll(matching: ids, into: &removed)
      kept.append(block)
    }
    self = kept
  }

  enum Placement { case before, after, firstChild, lastChild }

  /// Inserts blocks relative to an existing block. Returns `false` when the anchor is missing.
  @discardableResult
  mutating func insert(_ blocks: [NoteBlock], relativeTo anchorID: String, _ placement: Placement) -> Bool {
    guard let path = path(of: anchorID), let index = path.last else { return false }
    switch placement {
    case .before: updateSiblings(of: path) { $0.insert(contentsOf: blocks, at: index) }
    case .after: updateSiblings(of: path) { $0.insert(contentsOf: blocks, at: index + 1) }
    case .firstChild: update(path: path) { $0.children.insert(contentsOf: blocks, at: 0) }
    case .lastChild: update(path: path) { $0.children.append(contentsOf: blocks) }
    }
    return true
  }

  /// Every block in reading order, with its depth.
  func flattened(depth: Int = 0) -> [(block: NoteBlock, depth: Int)] {
    var out: [(NoteBlock, Int)] = []
    for block in self {
      out.append((block, depth))
      out.append(contentsOf: block.children.flattened(depth: depth + 1))
    }
    return out
  }

  /// Every block id in reading order.
  var allIDs: [String] { flattened().map(\.block.id) }

  func contains(id: String) -> Bool { path(of: id) != nil }

  /// The headings of the document in reading order, for the live table of contents.
  var headings: [NoteHeading] {
    var out: [NoteHeading] = []
    func visit(_ blocks: [NoteBlock]) {
      for block in blocks {
        if block.type == "heading" {
          let title = block.plainText.trimmingCharacters(in: .whitespacesAndNewlines)
          if !title.isEmpty { out.append(NoteHeading(id: block.id, level: block.props["level"]?.int ?? 1, title: title)) }
        }
        if !block.children.isEmpty { visit(block.children) }
      }
    }
    visit(self)
    return out
  }

  /// Removes the given ids from a selection and keeps only the outermost selected blocks, in document order.
  func outermost(_ ids: Set<String>) -> [NoteBlock] {
    var out: [NoteBlock] = []
    for block in self {
      if ids.contains(block.id) { out.append(block) } else { out.append(contentsOf: block.children.outermost(ids)) }
    }
    return out
  }
}

public struct NoteHeading: Hashable, Sendable, Identifiable {
  public let id: String
  public let level: Int
  public let title: String
}

/// In-note links: `#block=<id>` names a block, and any other fragment is a heading slug the way Markdown
/// tables of contents write them, with `-2`, `-3` suffixes for repeated titles.
public enum NoteFragments {
  public static func slug(_ value: String) -> String {
    let lowered = value.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    var kept = ""
    for scalar in lowered.unicodeScalars {
      if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) || scalar == "-" { kept.unicodeScalars.append(scalar) }
      else if CharacterSet.whitespaces.contains(scalar) || scalar == "\n" || scalar == "\t" { kept.unicodeScalars.append(scalar) }
    }
    var collapsed = ""
    for character in kept {
      let next: Character = character.isWhitespace ? "-" : character
      if next == "-" && collapsed.last == "-" { continue }
      collapsed.append(next)
    }
    return collapsed
  }

  /// The block a fragment points at, or `nil` when it names nothing in the note.
  public static func blockID(for fragment: String, in blocks: [NoteBlock]) -> String? {
    var raw = fragment
    if raw.hasPrefix("#") { raw.removeFirst() }
    let hash = (raw.removingPercentEncoding ?? raw).trimmingCharacters(in: .whitespacesAndNewlines)
    if hash.isEmpty { return nil }
    if hash.hasPrefix("block=") {
      let id = String(hash.dropFirst("block=".count))
      return id.isEmpty ? nil : id
    }
    // Other tools keep a hyphen per dropped character ("a--b"); Manor's export collapses them. Both resolve.
    var wanted = ""
    for character in hash.lowercased() where !(character == "-" && wanted.last == "-") { wanted.append(character) }
    var seen: [String: Int] = [:]
    for entry in blocks.flattened() where entry.block.kind == .heading {
      let base = slug(entry.block.plainText)
      let count = seen[base, default: 0]
      seen[base] = count + 1
      let candidate = count == 0 ? base : "\(base)-\(count + 1)"
      if candidate == wanted { return entry.block.id }
    }
    return nil
  }

  /// The in-note fragment of a link address, or `nil` for links that leave the note.
  public static func fragment(ofLink href: String) -> String? {
    if href.hasPrefix("#") { return href }
    return nil
  }
}
