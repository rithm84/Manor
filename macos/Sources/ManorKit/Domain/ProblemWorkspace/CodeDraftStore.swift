import Foundation
import GRDB

/// A code draft as this device protects it: exact source with its account, problem, language, content version, and
/// the cloud revision it starts from. `pending` stays true until the cloud acknowledges this exact source.
public struct LocalCodeDraft: Codable, Hashable, Sendable, FetchableRecord, PersistableRecord {
  public static let databaseTableName = "code_drafts"

  public var id: String
  public var requestId: String
  public var accountId: String
  public var problemId: String
  public var language: String
  public var contentVersion: Int
  public var code: String
  public var cloudRevision: Int
  public var pending: Bool
  public var updatedAt: Date

  public init(id: String, requestId: UUID = UUID(), accountId: String, problemId: String, language: ProblemLanguage, contentVersion: Int, code: String, cloudRevision: Int, pending: Bool, updatedAt: Date = Date()) {
    self.id = id; self.requestId = requestId.uuidString.lowercased(); self.accountId = accountId; self.problemId = problemId
    self.language = language.rawValue; self.contentVersion = contentVersion; self.code = code; self.cloudRevision = cloudRevision
    self.pending = pending; self.updatedAt = updatedAt
  }

  public var problemLanguage: ProblemLanguage? { ProblemLanguage(rawValue: language) }

  enum CodingKeys: String, CodingKey, ColumnExpression {
    case id, requestId = "request_id", accountId = "account_id", problemId = "problem_id", language
    case contentVersion = "content_version", code, cloudRevision = "cloud_revision", pending, updatedAt = "updated_at"
  }

  /// A copy with a fresh request identity, as every new local version gets.
  public func revised(_ change: (inout LocalCodeDraft) -> Void) -> LocalCodeDraft {
    var copy = self
    copy.requestId = UUID().uuidString.lowercased()
    change(&copy)
    return copy
  }
}

/// Account-scoped source stays on this device through relaunches, crashes, and expired sessions, in a small SQLite
/// file under Application Support. Writes are durable before they return.
public final class CodeDraftStore: Sendable {
  private let database: DatabaseQueue

  public init(path: String) throws {
    var configuration = Configuration()
    configuration.label = "ManorCodeDrafts"
    database = try DatabaseQueue(path: path, configuration: configuration)
    try Self.migrator.migrate(database)
  }

  /// An in-memory store for tests.
  public init() throws {
    database = try DatabaseQueue()
    try Self.migrator.migrate(database)
  }

  /// `Application Support/Manor/<environment>/ProblemCodeDrafts.sqlite`.
  public static func defaultLocation(environment: AppConfig.Environment) throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("Manor", isDirectory: true).appendingPathComponent(environment.rawValue, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("ProblemCodeDrafts.sqlite")
  }

  private static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()
    migrator.registerMigration("v1") { db in
      try db.create(table: "code_drafts") { table in
        table.column("account_id", .text).notNull()
        table.column("problem_id", .text).notNull()
        table.column("language", .text).notNull()
        table.column("id", .text).notNull()
        table.column("request_id", .text).notNull()
        table.column("content_version", .integer).notNull()
        table.column("code", .text).notNull()
        table.column("cloud_revision", .integer).notNull()
        table.column("pending", .boolean).notNull()
        table.column("updated_at", .datetime).notNull()
        table.primaryKey(["account_id", "problem_id", "language"])
      }
    }
    return migrator
  }

  private static func key(_ accountId: String, _ problemId: String, _ language: String) -> [String: (any DatabaseValueConvertible)?] {
    ["account_id": accountId, "problem_id": problemId, "language": language]
  }

  public func read(accountId: String, problemId: String, language: ProblemLanguage) async throws -> LocalCodeDraft? {
    try await database.read { db in try LocalCodeDraft.fetchOne(db, key: Self.key(accountId, problemId, language.rawValue)) }
  }

  /// Saves the draft without ever moving its cloud revision backwards.
  public func write(_ draft: LocalCodeDraft) async throws {
    try await database.write { db in
      let existing = try LocalCodeDraft.fetchOne(db, key: Self.key(draft.accountId, draft.problemId, draft.language))
      var stored = draft
      stored.cloudRevision = max(existing?.cloudRevision ?? 0, draft.cloudRevision)
      try stored.save(db)
    }
  }

  /// A cloud receipt advances the revision while preserving edits typed during the request.
  public func acknowledge(accountId: String, problemId: String, language: ProblemLanguage, source: String, revision: Int) async throws {
    try await database.write { db in
      guard var stored = try LocalCodeDraft.fetchOne(db, key: Self.key(accountId, problemId, language.rawValue)) else {
        throw ManorRequestError(operation: "Protect code", code: "missing", detail: "The code draft is missing while applying its cloud receipt.")
      }
      stored.cloudRevision = revision
      stored.pending = stored.code != source
      try stored.update(db)
    }
  }

  public func drafts(accountId: String) async throws -> [LocalCodeDraft] {
    try await database.read { db in
      try LocalCodeDraft.filter(LocalCodeDraft.CodingKeys.accountId == accountId).fetchAll(db)
    }
  }

  public func hasPending(accountId: String) async throws -> Bool {
    try await drafts(accountId: accountId).contains { $0.pending }
  }

  /// Explicit sign-out removes only drafts whose cloud save is acknowledged.
  public func clearSynced(accountId: String) async throws {
    try await database.write { db in
      let drafts = try LocalCodeDraft.filter(LocalCodeDraft.CodingKeys.accountId == accountId).fetchAll(db)
      if drafts.contains(where: \.pending) {
        throw ManorRequestError(operation: "Sign out", code: "pending", detail: "Code drafts are still waiting to save. Sign-out was cancelled.")
      }
      _ = try LocalCodeDraft.filter(LocalCodeDraft.CodingKeys.accountId == accountId).deleteAll(db)
    }
  }
}

/// A source version that exists only in memory until its local write finishes. Sign-out and quitting wait for it, and
/// a failed write keeps the source here so returning to the problem recovers it.
@MainActor
public final class CodeDraftProtectionBoundary {
  private struct Entry { let draft: LocalCodeDraft; let receipt: UUID }
  private var pending: [String: Entry] = [:]

  public init() {}

  private static func key(_ accountId: String, _ problemId: String, _ language: String) -> String { "\(accountId)\u{1F}\(problemId)\u{1F}\(language)" }

  /// Registers the newest source for its identity; the returned closure releases it once it is durable. An older
  /// receipt can never release a newer source.
  public func begin(_ draft: LocalCodeDraft) -> @MainActor () -> Void {
    let key = Self.key(draft.accountId, draft.problemId, draft.language)
    let receipt = UUID()
    pending[key] = Entry(draft: draft, receipt: receipt)
    return { [weak self] in
      guard let self, self.pending[key]?.receipt == receipt else { return }
      self.pending[key] = nil
    }
  }

  public var isEmpty: Bool { pending.isEmpty }

  public func hasUnprotected(accountId: String) -> Bool { pending.values.contains { $0.draft.accountId == accountId } }

  public func readUnprotected(accountId: String, problemId: String, language: ProblemLanguage) -> LocalCodeDraft? {
    pending[Self.key(accountId, problemId, language.rawValue)]?.draft
  }
}
