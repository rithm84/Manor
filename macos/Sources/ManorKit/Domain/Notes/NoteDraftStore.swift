import Foundation
import GRDB

/// A note draft as this device protects it: the exact title and blocks, the revision the edit started from, and
/// the mutation id that identifies this version of the draft (it doubles as the save's command id, so a save
/// retried after a relaunch replays instead of applying twice). `sequence` orders pending saves across notes.
public struct ProtectedNoteDraft: Hashable, Sendable {
  public var accountId: String
  public var noteId: String
  public var title: String
  public var blocks: [JSONValue]
  public var baseRevision: Int
  public var mutationId: String
  public var protectedAt: Date
  public var sequence: Int64

  public init(accountId: String, noteId: String, title: String, blocks: [JSONValue], baseRevision: Int,
              mutationId: String = UUID().uuidString.lowercased(), protectedAt: Date = Date(), sequence: Int64 = 0) {
    self.accountId = accountId
    self.noteId = noteId
    self.title = title
    self.blocks = blocks
    self.baseRevision = baseRevision
    self.mutationId = mutationId
    self.protectedAt = protectedAt
    self.sequence = sequence
  }

  public var content: NoteContent { NoteContent(id: noteId, title: title, blocks: blocks) }
}

/// A file upload started from a note's media block that has not reached the block yet. The bytes live in the
/// Files service's journal; this record links the upload to its block, so after a lost connection or a
/// relaunch the block finishes with the right file instead of an error.
public struct PendingNoteUpload: Hashable, Sendable {
  public var accountId: String
  public var noteId: String
  public var blockId: String
  public var uploadId: UUID
  public var name: String
  public init(accountId: String, noteId: String, blockId: String, uploadId: UUID, name: String) {
    self.accountId = accountId
    self.noteId = noteId
    self.blockId = blockId
    self.uploadId = uploadId
    self.name = name
  }
}

/// The corpus as last read, for starting without a connection, with the highest revision seen per note.
public struct NotesSnapshot: Hashable, Codable, Sendable {
  public var accountId: String
  public var state: NotesState
  public var revisions: [String: Int]
  public init(accountId: String, state: NotesState, revisions: [String: Int]) {
    self.accountId = accountId
    self.state = state
    self.revisions = revisions
  }
}

/// Account-scoped draft protection in SQLite under Application Support. A write that returns is committed to
/// disk; every read-modify-write runs in one transaction, so a keystroke and a save's re-base never interleave.
public final class NoteDraftStore: Sendable {
  private let database: DatabaseQueue

  public init(path: String) throws {
    var configuration = Configuration()
    configuration.label = "ManorNoteDrafts"
    database = try DatabaseQueue(path: path, configuration: configuration)
    try Self.migrator.migrate(database)
  }

  /// An in-memory store for tests.
  public init() throws {
    database = try DatabaseQueue()
    try Self.migrator.migrate(database)
  }

  /// `Application Support/Manor/<environment>/NotesDrafts.sqlite`.
  public static func defaultLocation(environment: AppConfig.Environment) throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("Manor", isDirectory: true).appendingPathComponent(environment.rawValue, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("NotesDrafts.sqlite")
  }

  private static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()
    migrator.registerMigration("v1") { db in
      try db.create(table: "note_drafts") { table in
        table.column("account_id", .text).notNull()
        table.column("note_id", .text).notNull()
        table.column("title", .text).notNull()
        table.column("blocks", .blob).notNull()
        table.column("base_revision", .integer).notNull()
        table.column("mutation_id", .text).notNull()
        table.column("protected_at", .double).notNull()
        table.column("sequence", .integer).notNull()
        table.primaryKey(["account_id", "note_id"])
      }
      try db.create(table: "note_attachments") { table in
        table.column("account_id", .text).notNull()
        table.column("attachment_id", .text).notNull()
        table.column("note_id", .text).notNull()
        table.column("name", .text).notNull()
        table.column("mime_type", .text).notNull()
        table.column("bytes", .blob).notNull()
        table.primaryKey(["account_id", "attachment_id"])
      }
      try db.create(table: "note_snapshots") { table in
        table.column("account_id", .text).notNull().primaryKey()
        table.column("snapshot", .blob).notNull()
      }
    }
    // v1's attachment table copied file bytes into SQLite and was never used; uploads are journaled by the
    // Files service, and this table only links them to their blocks.
    migrator.registerMigration("v2-note-uploads") { db in
      try db.drop(table: "note_attachments")
      try db.create(table: "note_uploads") { table in
        table.column("account_id", .text).notNull()
        table.column("upload_id", .text).notNull()
        table.column("note_id", .text).notNull()
        table.column("block_id", .text).notNull()
        table.column("name", .text).notNull()
        table.primaryKey(["account_id", "upload_id"])
      }
    }
    return migrator
  }

  // MARK: Drafts

  public struct InvalidDraft: LocalizedError {
    public var errorDescription: String? { "A note draft needs its account, note, and a base revision before it can be protected." }
  }

  private static func encode(_ blocks: [JSONValue]) throws -> Data { try ManorJSON.plainEncoder.encode(blocks) }

  private static func draft(_ row: GRDB.Row) throws -> ProtectedNoteDraft {
    let data: Data = row["blocks"]
    return ProtectedNoteDraft(
      accountId: row["account_id"], noteId: row["note_id"], title: row["title"],
      blocks: try ManorJSON.plainDecoder.decode([JSONValue].self, from: data), baseRevision: row["base_revision"],
      mutationId: row["mutation_id"], protectedAt: Date(timeIntervalSince1970: row["protected_at"]), sequence: row["sequence"]
    )
  }

  private static func read(_ db: Database, _ accountId: String, _ noteId: String) throws -> ProtectedNoteDraft? {
    try GRDB.Row.fetchOne(db, sql: "SELECT * FROM note_drafts WHERE account_id = ? AND note_id = ?", arguments: [accountId, noteId]).map(draft)
  }

  private static func put(_ db: Database, _ draft: ProtectedNoteDraft) throws {
    guard !draft.accountId.isEmpty, !draft.noteId.isEmpty, !draft.mutationId.isEmpty, draft.baseRevision >= 0 else { throw InvalidDraft() }
    let next = try Int64.fetchOne(db, sql: "SELECT COALESCE(MAX(sequence), 0) + 1 FROM note_drafts WHERE account_id = ?", arguments: [draft.accountId]) ?? 1
    try db.execute(sql: """
      INSERT INTO note_drafts (account_id, note_id, title, blocks, base_revision, mutation_id, protected_at, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, note_id) DO UPDATE SET title = excluded.title, blocks = excluded.blocks,
        base_revision = excluded.base_revision, mutation_id = excluded.mutation_id, protected_at = excluded.protected_at
      """, arguments: [draft.accountId, draft.noteId, draft.title, try encode(draft.blocks), draft.baseRevision, draft.mutationId,
                       draft.protectedAt.timeIntervalSince1970, next])
  }

  /// Protects a new version of a note's draft. An identical draft is left alone; otherwise the edit keeps the
  /// stored base revision (or takes `knownRevision` for a first edit) and gets a fresh mutation id.
  @discardableResult
  public func protect(accountId: String, content: NoteContent, knownRevision: Int?) async throws -> ProtectedNoteDraft {
    try await database.write { db in
      let current = try Self.read(db, accountId, content.id)
      if let current, current.title == content.title, current.blocks == content.blocks { return current }
      guard let revision = current?.baseRevision ?? knownRevision else {
        throw ManorRequestError(operation: "Protect note", code: "load", detail: "Load the note before editing it.")
      }
      let draft = ProtectedNoteDraft(accountId: accountId, noteId: content.id, title: content.title, blocks: content.blocks, baseRevision: revision)
      try Self.put(db, draft)
      return try Self.read(db, accountId, content.id) ?? draft
    }
  }

  /// Writes a draft exactly as given (a re-base or a conflict resolution).
  public func replace(_ draft: ProtectedNoteDraft) async throws {
    try await database.write { db in try Self.put(db, draft) }
  }

  public func read(accountId: String, noteId: String) async throws -> ProtectedNoteDraft? {
    try await database.read { db in try Self.read(db, accountId, noteId) }
  }

  /// Every pending draft for the account, oldest protection first.
  public func list(accountId: String) async throws -> [ProtectedNoteDraft] {
    try await database.read { db in
      try GRDB.Row.fetchAll(db, sql: "SELECT * FROM note_drafts WHERE account_id = ? ORDER BY sequence", arguments: [accountId]).map(Self.draft)
    }
  }

  /// Clears the draft only if it is still the version that was sent; typing that arrived during the request stays.
  public func acknowledge(accountId: String, noteId: String, mutationId: String) async throws {
    try await database.write { db in
      try db.execute(sql: "DELETE FROM note_drafts WHERE account_id = ? AND note_id = ? AND mutation_id = ?", arguments: [accountId, noteId, mutationId])
    }
  }

  public enum CommitOutcome: Hashable, Sendable {
    /// The sent draft was the latest; nothing remains.
    case cleared
    /// Typing that continued during the save remains, moved onto the committed revision.
    case kept(ProtectedNoteDraft)
    /// Typing that continued during a merged save touched the same blocks the merge brought in.
    case conflict
  }

  /// After a save commits: the sent draft is cleared, or newer typing built on the same base moves to the new
  /// revision. When the committed document differs from what was sent (the save merged foreign blocks), the newer
  /// typing is merged onto it in the same transaction.
  public func commit(sent: ProtectedNoteDraft, revision: Int, committed: [JSONValue]) async throws -> CommitOutcome {
    try await database.write { db in
      guard var current = try Self.read(db, sent.accountId, sent.noteId) else { return .cleared }
      if current.mutationId == sent.mutationId {
        try db.execute(sql: "DELETE FROM note_drafts WHERE account_id = ? AND note_id = ?", arguments: [sent.accountId, sent.noteId])
        return .cleared
      }
      if current.baseRevision == sent.baseRevision { current.baseRevision = revision }
      var outcome = CommitOutcome.kept(current)
      if committed != sent.blocks {
        switch try NoteMerge.merge(base: sent.blocks, mine: current.blocks, theirs: committed) {
        case .clean(let merged, _): current.blocks = merged; outcome = .kept(current)
        case .conflict: outcome = .conflict
        }
      }
      try Self.put(db, current)
      return outcome
    }
  }

  /// Runs a read-modify-write on one note's draft in a single transaction. Returning nil deletes it.
  public func update(accountId: String, noteId: String, _ change: @escaping @Sendable (ProtectedNoteDraft?) throws -> ProtectedNoteDraft?) async throws {
    try await database.write { db in
      let current = try Self.read(db, accountId, noteId)
      if let next = try change(current) { try Self.put(db, next) }
      else if current != nil { try db.execute(sql: "DELETE FROM note_drafts WHERE account_id = ? AND note_id = ?", arguments: [accountId, noteId]) }
    }
  }

  public func discard(accountId: String, noteId: String) async throws {
    try await database.write { db in
      try db.execute(sql: "DELETE FROM note_drafts WHERE account_id = ? AND note_id = ?", arguments: [accountId, noteId])
    }
  }

  // MARK: Snapshot

  public func saveSnapshot(_ snapshot: NotesSnapshot) async throws {
    let data = try ManorJSON.plainEncoder.encode(snapshot)
    try await database.write { db in
      try db.execute(sql: "INSERT INTO note_snapshots (account_id, snapshot) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET snapshot = excluded.snapshot",
                     arguments: [snapshot.accountId, data])
    }
  }

  public func snapshot(accountId: String) async throws -> NotesSnapshot? {
    let data = try await database.read { db in
      try Data.fetchOne(db, sql: "SELECT snapshot FROM note_snapshots WHERE account_id = ?", arguments: [accountId])
    }
    return try data.map { try ManorJSON.plainDecoder.decode(NotesSnapshot.self, from: $0) }
  }

  // MARK: Uploads

  public func protectUpload(_ upload: PendingNoteUpload) async throws {
    guard !upload.accountId.isEmpty, !upload.noteId.isEmpty, !upload.blockId.isEmpty else {
      throw ManorRequestError(operation: "Protect upload", code: "invalid", detail: "A pending upload needs its account, note, and block.")
    }
    try await database.write { db in
      try db.execute(sql: """
        INSERT OR REPLACE INTO note_uploads (account_id, upload_id, note_id, block_id, name) VALUES (?, ?, ?, ?, ?)
        """, arguments: [upload.accountId, upload.uploadId.uuidString.lowercased(), upload.noteId, upload.blockId, upload.name])
    }
  }

  /// The account's pending uploads, optionally only one note's, oldest first.
  public func uploads(accountId: String, noteId: String? = nil) async throws -> [PendingNoteUpload] {
    try await database.read { db in
      let rows = if let noteId {
        try GRDB.Row.fetchAll(db, sql: "SELECT * FROM note_uploads WHERE account_id = ? AND note_id = ? ORDER BY rowid", arguments: [accountId, noteId])
      } else {
        try GRDB.Row.fetchAll(db, sql: "SELECT * FROM note_uploads WHERE account_id = ? ORDER BY rowid", arguments: [accountId])
      }
      return rows.compactMap { row in
        guard let id = UUID(uuidString: row["upload_id"]) else { return nil }
        return PendingNoteUpload(accountId: row["account_id"], noteId: row["note_id"], blockId: row["block_id"], uploadId: id, name: row["name"])
      }
    }
  }

  public func acknowledgeUpload(accountId: String, uploadId: UUID) async throws {
    try await database.write { db in
      try db.execute(sql: "DELETE FROM note_uploads WHERE account_id = ? AND upload_id = ?", arguments: [accountId, uploadId.uuidString.lowercased()])
    }
  }

  // MARK: Sign-out

  /// Whether anything for the account still waits to reach the cloud.
  public func hasUnsynced(accountId: String) async throws -> Bool {
    try await database.read { db in
      let drafts = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM note_drafts WHERE account_id = ?", arguments: [accountId]) ?? 0
      let uploads = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM note_uploads WHERE account_id = ?", arguments: [accountId]) ?? 0
      return drafts + uploads > 0
    }
  }

  /// Removes the account's local Notes data after a completed sign-out. Refuses while anything is unsynced.
  public func clear(accountId: String) async throws {
    try await database.write { db in
      let drafts = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM note_drafts WHERE account_id = ?", arguments: [accountId]) ?? 0
      let uploads = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM note_uploads WHERE account_id = ?", arguments: [accountId]) ?? 0
      guard drafts + uploads == 0 else {
        throw ManorRequestError(operation: "Sign out", code: "pending", detail: "Notes changes are still waiting to sync.")
      }
      try db.execute(sql: "DELETE FROM note_snapshots WHERE account_id = ?", arguments: [accountId])
    }
  }
}
