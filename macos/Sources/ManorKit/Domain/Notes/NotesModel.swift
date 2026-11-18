import Foundation

/// What the note list shows: one of the fixed views or a folder.
public enum NotesScope: Hashable, Codable, Sendable {
  case all, favorites, recent, archived, trash
  case folder(String)

  public static let views: [NotesScope] = [.all, .favorites, .recent, .archived, .trash]

  public var folderId: String? {
    if case .folder(let id) = self { return id }
    return nil
  }

  /// Trash and Archived hold notes moved there; the other views create notes.
  public var canCreate: Bool { self != .trash && self != .archived }

  public var label: String {
    switch self {
    case .all: return "All notes"
    case .favorites: return "Favorites"
    case .recent: return "Recent"
    case .archived: return "Archived"
    case .trash: return "Trash"
    case .folder: return "Folder"
    }
  }

  /// The view a note belongs to when it is opened from a link or restored.
  public static func of(_ page: NotePage) -> NotesScope {
    switch page.status {
    case .archived: return .archived
    case .trash: return .trash
    case .active: return page.folderId.map(NotesScope.folder) ?? .all
    }
  }
}

/// One row of the note list: a page and its nesting depth under its parent pages.
public struct NoteTreeRow: Identifiable, Hashable, Sendable {
  public var page: NotePage
  public var depth: Int
  public var id: String { page.id }
}

/// Counts the view picker shows.
public struct NotesCounts: Hashable, Sendable {
  public var all = 0, favorites = 0, archived = 0, trash = 0
  public var folders: [String: Int] = [:]
  public init() {}

  public init(_ pages: [NotePage]) {
    for page in pages {
      switch page.status {
      case .active:
        all += 1
        if page.favorite { favorites += 1 }
        if let folder = page.folderId { folders[folder, default: 0] += 1 }
      case .archived: archived += 1
      case .trash: trash += 1
      }
    }
  }

  public func count(for scope: NotesScope) -> Int? {
    switch scope {
    case .all: return all
    case .favorites: return favorites
    case .recent: return nil
    case .archived: return archived
    case .trash: return trash
    case .folder(let id): return folders[id] ?? 0
    }
  }
}

public enum NotesModel {
  // MARK: Search

  /// Every piece of readable text in a block tree: inline text, captions, alt text, names, and nested children.
  public static func inlineText(_ value: JSONValue) -> String {
    switch value {
    case .string(let text): return text
    case .array(let items): return items.map(inlineText).filter { !$0.isEmpty }.joined(separator: " ")
    case .object(let record):
      let props = record["props"]?.object ?? [:]
      var parts: [String] = []
      for key in ["text", "content", "children", "caption", "name"] { if let inner = record[key] { parts.append(inlineText(inner)) } }
      for key in ["caption", "alt", "title", "name"] { if let inner = props[key] { parts.append(inlineText(inner)) } }
      for key in ["leftContent", "rightContent"] {
        if let serialized = props[key]?.string, let data = serialized.data(using: .utf8),
           let parsed = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data) {
          parts.append(inlineText(parsed))
        }
      }
      return parts.filter { !$0.isEmpty }.joined(separator: " ")
    default: return ""
    }
  }

  /// The lowercased title and body a search matches against.
  public static func searchableText(_ page: NotePage) -> String {
    "\(page.title) \(inlineText(.array(page.content)))".lowercased()
  }

  /// The pages a view shows, filtered by the search and newest first (Recent by opening, the rest by edit).
  public static func pages(_ pages: [NotePage], scope: NotesScope, query: String, searchIndex: [String: String] = [:]) -> [NotePage] {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return pages
      .filter { page in
        switch scope {
        case .trash: return page.status == .trash
        case .archived: return page.status == .archived
        case .favorites: return page.status == .active && page.favorite
        case .folder(let id): return page.status == .active && page.folderId == id
        case .all, .recent: return page.status == .active
        }
      }
      .filter { page in
        normalized.isEmpty || (searchIndex[page.id] ?? searchableText(page)).contains(normalized)
      }
      .sorted { left, right in
        scope == .recent ? left.lastOpenedAt > right.lastOpenedAt : left.updatedAt > right.updatedAt
      }
  }

  /// Pages nested under their parents (when the parent is in the same list), each level newest first.
  public static func treeRows(_ pages: [NotePage]) -> [NoteTreeRow] {
    let ids = Set(pages.map(\.id))
    var children: [String?: [NotePage]] = [:]
    for page in pages {
      let parent = page.parentPageId.flatMap { ids.contains($0) ? $0 : nil }
      children[parent, default: []].append(page)
    }
    for key in children.keys { children[key]?.sort { $0.updatedAt > $1.updatedAt } }
    var rows: [NoteTreeRow] = []
    var visited = Set<String>()
    func visit(_ parent: String?, _ depth: Int) {
      for page in children[parent] ?? [] where !visited.contains(page.id) {
        visited.insert(page.id)
        rows.append(NoteTreeRow(page: page, depth: depth))
        visit(page.id, depth + 1)
      }
    }
    visit(nil, 0)
    return rows
  }

  public static func scopeTitle(_ scope: NotesScope, folders: [NoteFolder]) -> String {
    if case .folder(let id) = scope { return folders.first { $0.id == id }?.name ?? "Folder" }
    return scope.label
  }

  /// The ids plus every page nested under them, which the server moves with them.
  public static func withDescendants(_ ids: [String], in pages: [NotePage]) -> Set<String> {
    var result = Set(ids)
    var grew = true
    while grew {
      grew = false
      for page in pages {
        if let parent = page.parentPageId, result.contains(parent), !result.contains(page.id) {
          result.insert(page.id)
          grew = true
        }
      }
    }
    return result
  }

  // MARK: Import

  /// Title for an imported file: extension off, and the 32-hex page ID appended to exported names trimmed.
  public static func importedTitle(fileName: String) -> String {
    var base = fileName.replacingOccurrences(of: #"\.(md|markdown|json)$"#, with: "", options: [.regularExpression, .caseInsensitive])
    base = base.replacingOccurrences(of: #"\s+[0-9a-fA-F]{32}$"#, with: "", options: .regularExpression)
    base = base.replacingOccurrences(of: #"\.manor$"#, with: "", options: [.regularExpression, .caseInsensitive])
    base = base.trimmingCharacters(in: .whitespacesAndNewlines)
    return base.isEmpty ? "Imported note" : base
  }

  /// A document that opens with a level-one heading is titled by it, and the heading leaves the body. Front
  /// matter and blank lines before the heading are skipped.
  public static func splitLeadingHeading(_ markdown: String) -> (title: String?, body: String) {
    var text = markdown
    if let frontMatter = text.range(of: #"^---\r?\n[\s\S]*?\r?\n---\r?\n?"#, options: .regularExpression) {
      text.removeSubrange(frontMatter)
    }
    guard let match = text.range(of: #"^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)"#, options: .regularExpression) else {
      return (nil, markdown)
    }
    let line = String(text[match])
    var title = line.trimmingCharacters(in: .whitespacesAndNewlines)
    title = String(title.drop(while: { $0 == "#" }))
    title = title.replacingOccurrences(of: #"[ \t]*#*[ \t]*$"#, with: "", options: .regularExpression)
    title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return (nil, markdown) }
    return (title, String(text[match.upperBound...]))
  }

  /// A file name for an exported note.
  public static func exportFileName(title: String, extension ext: String) -> String {
    let slug = title.replacingOccurrences(of: #"[^A-Za-z0-9]+"#, with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return "\(slug.isEmpty ? "note" : slug).\(ext)"
  }

  // MARK: Time

  private static let isoFractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private static let isoPlain: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  /// Parses Postgres timestamps, which carry up to six fractional digits.
  public static func date(_ timestamp: String) -> Date? {
    if let date = isoPlain.date(from: timestamp) { return date }
    // Trim fractional seconds to milliseconds, which the formatter accepts.
    let trimmed = timestamp.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
    return isoFractional.date(from: trimmed) ?? isoPlain.date(from: trimmed)
  }

  public static func timestamp(_ date: Date = Date()) -> String { isoFractional.string(from: date) }
}

// MARK: Selection

/// Multi-select over the ordered note list: plain click, Shift for a range from the anchor, Command to toggle.
public struct NoteSelection: Hashable, Sendable {
  public var ids: [String]
  public var anchor: String?

  public init(ids: [String] = [], anchor: String? = nil) {
    self.ids = ids
    self.anchor = anchor
  }

  public static let empty = NoteSelection()
  public static func one(_ id: String) -> NoteSelection { NoteSelection(ids: [id], anchor: id) }
  public static func all(_ order: [String]) -> NoteSelection { NoteSelection(ids: order, anchor: order.first) }

  public func contains(_ id: String) -> Bool { ids.contains(id) }

  /// The rows between the anchor and `id` in list order, inclusive; without an anchor the click starts the range.
  public func range(to id: String, in order: [String]) -> NoteSelection {
    let anchor = self.anchor ?? id
    guard let from = order.firstIndex(of: anchor), let to = order.firstIndex(of: id) else { return .one(id) }
    let bounds = from <= to ? from...to : to...from
    return NoteSelection(ids: Array(order[bounds]), anchor: anchor)
  }

  public func toggling(_ id: String) -> NoteSelection {
    NoteSelection(ids: ids.contains(id) ? ids.filter { $0 != id } : ids + [id], anchor: id)
  }

  public func click(_ id: String, in order: [String], range: Bool, toggle: Bool) -> NoteSelection {
    if range { return self.range(to: id, in: order) }
    if toggle { return toggling(id) }
    return .one(id)
  }

  /// Drops rows that left the list (moved to Trash, restored, or filtered out).
  public func pruned(to order: [String]) -> NoteSelection {
    let present = Set(order)
    let kept = ids.filter { present.contains($0) }
    if kept.count == ids.count { return self }
    return NoteSelection(ids: kept, anchor: anchor.flatMap { present.contains($0) ? $0 : nil } ?? kept.first)
  }

  /// The notes an action on `id` applies to: the selection when the row is part of it, otherwise that row.
  public func targets(for id: String) -> [String] {
    ids.contains(id) && ids.count > 1 ? ids : [id]
  }
}
