import Foundation

/// Where a note lives in its lifecycle.
public enum NotePageStatus: String, Codable, Hashable, Sendable {
  case active, archived, trash
}

public struct NoteFolder: Identifiable, Hashable, Codable, Sendable {
  public var id: String
  public var name: String
  public var parentFolderId: String?
  public var createdAt: String
  public var updatedAt: String
  public var revision: Int

  public init(id: String, name: String, parentFolderId: String? = nil, createdAt: String, updatedAt: String, revision: Int = 1) {
    self.id = id
    self.name = name
    self.parentFolderId = parentFolderId
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.revision = revision
  }
}

/// One note as the list and editor show it. `content` is the stored block array in Manor's block document format (`content_json`).
public struct NotePage: Identifiable, Hashable, Codable, Sendable {
  public var id: String
  public var title: String
  public var folderId: String?
  public var parentPageId: String?
  public var content: [JSONValue]
  public var favorite: Bool
  public var status: NotePageStatus
  public var createdAt: String
  public var updatedAt: String
  public var lastOpenedAt: String
  public var archivedAt: String?
  public var deletedAt: String?
  /// The row's revision as read; the service keeps the highest revision it has seen separately.
  public var revision: Int

  public init(
    id: String, title: String, folderId: String? = nil, parentPageId: String? = nil, content: [JSONValue] = [],
    favorite: Bool = false, status: NotePageStatus = .active, createdAt: String, updatedAt: String, lastOpenedAt: String,
    archivedAt: String? = nil, deletedAt: String? = nil, revision: Int = 1
  ) {
    self.id = id
    self.title = title
    self.folderId = folderId
    self.parentPageId = parentPageId
    self.content = content
    self.favorite = favorite
    self.status = status
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.lastOpenedAt = lastOpenedAt
    self.archivedAt = archivedAt
    self.deletedAt = deletedAt
    self.revision = revision
  }

  public var displayTitle: String { title.isEmpty ? "Untitled" : title }
}

/// The whole Notes corpus the page shows.
public struct NotesState: Hashable, Codable, Sendable {
  public var folders: [NoteFolder]
  public var pages: [NotePage]
  public init(folders: [NoteFolder] = [], pages: [NotePage] = []) {
    self.folders = folders
    self.pages = pages
  }
}

/// The editable part of a note: what a draft holds and `update_note` sends.
public struct NoteContent: Hashable, Codable, Sendable {
  public var id: String
  public var title: String
  public var blocks: [JSONValue]
  public init(id: String, title: String, blocks: [JSONValue]) {
    self.id = id
    self.title = title
    self.blocks = blocks
  }

  /// The title as saved: trimmed, and "Untitled" when empty.
  public var savedTitle: String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Untitled" : trimmed
  }
}

/// A superseded revision the server keeps for seven days.
public struct NoteVersion: Identifiable, Hashable, Sendable {
  public var id: String { String(revision) }
  public var noteId: String
  public var revision: Int
  public var title: String
  public var blocks: [JSONValue]
  public var createdAt: String
  public init(noteId: String, revision: Int, title: String, blocks: [JSONValue], createdAt: String) {
    self.noteId = noteId
    self.revision = revision
    self.title = title
    self.blocks = blocks
    self.createdAt = createdAt
  }
}

/// An agent's proposed edit to one block, accepted or rejected by the reader.
public struct NoteSuggestion: Identifiable, Hashable, Sendable {
  public enum Status: String, Hashable, Sendable { case pending, accepted, rejected }
  public var id: String
  public var noteId: String
  public var blockId: String
  public var summary: String
  public var before: [JSONValue]
  public var after: [JSONValue]
  public var status: Status
  public var createdAt: String
  public init(id: String, noteId: String, blockId: String, summary: String, before: [JSONValue], after: [JSONValue], status: Status, createdAt: String) {
    self.id = id
    self.noteId = noteId
    self.blockId = blockId
    self.summary = summary
    self.before = before
    self.after = after
    self.status = status
    self.createdAt = createdAt
  }
}

/// The two copies Compare versions shows: the cloud note and this device's draft.
public struct NoteConflict: Hashable, Sendable {
  public var current: NotePage
  public var local: NoteContent
  public var revision: Int
  public init(current: NotePage, local: NoteContent, revision: Int) {
    self.current = current
    self.local = local
    self.revision = revision
  }
}

// MARK: Validation

public enum NoteValidationError: LocalizedError, Equatable {
  case invalid(String)
  public var errorDescription: String? {
    switch self { case .invalid(let message): return message }
  }
}

public enum NoteLimits {
  public static let titleLength = 300
  public static let folderNameLength = 120
  public static let contentBytes = 12 * 1024 * 1024

  /// A folder name as saved, or an error the dialog shows.
  public static func folderName(_ name: String) throws -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw NoteValidationError.invalid("Give the folder a name.") }
    guard trimmed.count <= folderNameLength else { throw NoteValidationError.invalid("Folder names are \(folderNameLength) characters or fewer.") }
    return trimmed
  }

  /// A title as saved: trimmed, "Untitled" when empty, and within the stored limit.
  public static func title(_ title: String) throws -> String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count <= titleLength else { throw NoteValidationError.invalid("Titles are \(titleLength) characters or fewer.") }
    return trimmed.isEmpty ? "Untitled" : trimmed
  }

  /// Checks a document is within the stored size.
  public static func checkContent(_ blocks: [JSONValue]) throws {
    let size = (try? ManorJSON.plainEncoder.encode(JSONValue.array(blocks)).count) ?? 0
    guard size <= contentBytes else { throw NoteValidationError.invalid("This note is larger than 12 MB. Split it into smaller notes to save it.") }
  }
}

// MARK: Rows

public enum NoteRows {
  public struct DecodeError: LocalizedError {
    public let detail: String
    public var errorDescription: String? { "A note could not be read: \(detail)." }
  }

  public static func page(_ row: Row) throws -> NotePage {
    guard let id = row["id"]?.string else { throw DecodeError(detail: "missing id") }
    guard let status = row["status"]?.string.flatMap(NotePageStatus.init(rawValue:)) else { throw DecodeError(detail: "unknown status") }
    let content: [JSONValue]
    switch row["content_json"] {
    case .array(let blocks): content = blocks
    case .string(let text):
      // Defensive: a text-typed column returns the document serialized.
      guard let data = text.data(using: .utf8), case .array(let blocks)? = try? ManorJSON.plainDecoder.decode(JSONValue.self, from: data) else {
        throw DecodeError(detail: "content is not a block array")
      }
      content = blocks
    default: throw DecodeError(detail: "content is not a block array")
    }
    let created = row["created_at"]?.string ?? ""
    let updated = row["updated_at"]?.string ?? created
    return NotePage(
      id: id, title: row["title"]?.string ?? "Untitled", folderId: row["folder_id"]?.string, parentPageId: row["parent_page_id"]?.string,
      content: content, favorite: row["favorite"]?.bool ?? false, status: status, createdAt: created, updatedAt: updated,
      lastOpenedAt: row["last_opened_at"]?.string ?? updated, archivedAt: row["archived_at"]?.string, deletedAt: row["deleted_at"]?.string,
      revision: row["revision"]?.int ?? 0
    )
  }

  public static func folder(_ row: Row) throws -> NoteFolder {
    guard let id = row["id"]?.string, let name = row["name"]?.string else { throw DecodeError(detail: "folder without id or name") }
    let created = row["created_at"]?.string ?? ""
    return NoteFolder(id: id, name: name, parentFolderId: row["parent_folder_id"]?.string, createdAt: created,
                      updatedAt: row["updated_at"]?.string ?? created, revision: row["revision"]?.int ?? 0)
  }

  public static func version(_ row: Row, noteId: String) throws -> NoteVersion {
    guard let revision = row["revision"]?.int else { throw DecodeError(detail: "version without revision") }
    return NoteVersion(noteId: noteId, revision: revision, title: row["title"]?.string ?? "Untitled",
                       blocks: row["content_json"]?.array ?? [], createdAt: row["created_at"]?.string ?? "")
  }

  public static func suggestion(_ row: Row, noteId: String) throws -> NoteSuggestion {
    guard let id = row["id"]?.string, let status = row["status"]?.string.flatMap(NoteSuggestion.Status.init(rawValue:)) else {
      throw DecodeError(detail: "suggestion without id or status")
    }
    func blocks(_ value: JSONValue?) -> [JSONValue] {
      switch value {
      case .array(let items): return items
      case .object: return [value!]
      default: return []
      }
    }
    return NoteSuggestion(
      id: id, noteId: noteId, blockId: row["block_id"]?.string ?? "", summary: row["description"]?.string ?? "Suggested edit",
      before: blocks(row["before_content_json"]), after: blocks(row["after_content_json"]), status: status,
      createdAt: row["created_at"]?.string ?? ""
    )
  }

  /// Gives every block (and nested child) a stable id once, keeping existing ids and every other property.
  public static func nativeBlocks(_ blocks: [JSONValue]) -> [JSONValue] {
    blocks.map { block in
      guard var object = block.object else { return block }
      if (object["id"]?.string ?? "").isEmpty { object["id"] = .string(UUID().uuidString.lowercased()) }
      if case .array(let children)? = object["children"] { object["children"] = .array(nativeBlocks(children)) }
      return .object(object)
    }
  }
}
