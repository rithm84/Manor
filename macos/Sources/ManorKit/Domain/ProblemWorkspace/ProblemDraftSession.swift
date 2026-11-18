import Foundation

/// The account's cloud copy of a code draft.
public struct CloudCodeDraft: Codable, Hashable, Sendable {
  public var id: String
  public var problemId: String
  public var language: ProblemLanguage
  public var contentVersion: Int
  public var source: String
  public var revision: Int
  public var updatedAt: String

  public init(id: String, problemId: String, language: ProblemLanguage, contentVersion: Int, source: String, revision: Int, updatedAt: String) {
    self.id = id; self.problemId = problemId; self.language = language; self.contentVersion = contentVersion
    self.source = source; self.revision = revision; self.updatedAt = updatedAt
  }
}

/// Reads and saves cloud code drafts. `save_problem_draft` rejects concurrent edits or a changed statement.
@MainActor
public protocol ProblemDraftCloud: AnyObject {
  func loadDraft(problemId: String, language: ProblemLanguage) async throws -> CloudCodeDraft?
  func saveDraft(_ draft: LocalCodeDraft) async throws -> CloudCodeDraft
}

/// Code drafts are bounded to 256 KiB of UTF-8.
public let maximumCodeDraftBytes = 262_144

@MainActor
public final class GatewayDraftCloud: ProblemDraftCloud {
  private let gateway: Gateway
  public init(gateway: Gateway) { self.gateway = gateway }

  public func loadDraft(problemId: String, language: ProblemLanguage) async throws -> CloudCodeDraft? {
    let value = try await gateway.rpc("manor_problem_query", [
      "p_query": "read_problem_draft", "p_input": ["problem_id": .string(problemId), "language": .string(language.rawValue)]
    ])
    guard let row = value.object else { return nil }
    return try Self.draft(from: row)
  }

  public func saveDraft(_ draft: LocalCodeDraft) async throws -> CloudCodeDraft {
    guard draft.code.utf8.count <= maximumCodeDraftBytes else {
      throw ManorRequestError(operation: "save_problem_draft", code: "size", detail: "Code drafts can hold at most 256 KiB. Your code is safe on this device.")
    }
    guard let requestId = UUID(uuidString: draft.requestId) else {
      throw ManorRequestError(operation: "save_problem_draft", code: "request", detail: "The code draft has no valid request identity.")
    }
    let receipt = try await gateway.command("save_problem_draft", [
      "id": .string(draft.id), "expected_revision": .number(Double(draft.cloudRevision)), "problem_id": .string(draft.problemId),
      "language": .string(draft.language), "content_version": .number(Double(draft.contentVersion)), "source": .string(draft.code)
    ], id: requestId)
    guard let record = receipt.record else {
      throw ManorRequestError(operation: "save_problem_draft", code: "receipt", detail: "The saved code draft did not come back.")
    }
    return try Self.draft(from: record)
  }

  static func draft(from row: Row) throws -> CloudCodeDraft {
    guard let id = row["id"]?.string, let problemId = row["problem_id"]?.string,
          let language = row["language"]?.string.flatMap(ProblemLanguage.init(rawValue:)),
          let contentVersion = row["content_version"]?.int, let source = row["source"]?.string,
          let revision = row["revision"]?.int else {
      throw ManorRequestError(operation: "Read problem code draft", code: "decode", detail: "The cloud code draft is incomplete.")
    }
    return CloudCodeDraft(id: id, problemId: problemId, language: language, contentVersion: contentVersion, source: source, revision: revision, updatedAt: row["updated_at"]?.string ?? "")
  }
}

public enum CodeDraftStatus: Equatable, Sendable { case loading, protecting, protected, saving, saved, failed }

/// Serializes local protection and cloud writes for one account, problem, and language:
/// typing is protected on this device first, then saved to the cloud
/// about 600 ms after it stops; edits made before the cloud draft arrives conflict with a newer cloud draft.
@MainActor
public final class ProblemDraftSession {
  public let accountId: String
  public let problemId: String
  public let language: ProblemLanguage
  public let contentVersion: Int
  private let store: CodeDraftStore
  private let boundary: CodeDraftProtectionBoundary
  private let cloud: ProblemDraftCloud
  private let onStatus: @MainActor (CodeDraftStatus, String?) -> Void
  private let saveDelay: Duration

  private var local: LocalCodeDraft?
  private var localWrites: Task<Void, Error> = Task {}
  private var cloudWrite: Task<Void, Error>?
  private var timer: Task<Void, Never>?
  private var cloudConflict: CloudCodeDraft?
  private var cloudReadFailed = false
  /// True while the local draft's identity was minted on this device and no cloud draft has been read.
  private var minted = false
  private var cloudRead: Task<String?, Never> = Task { nil }
  private var stopped = false

  public init(accountId: String, problemId: String, language: ProblemLanguage, contentVersion: Int, store: CodeDraftStore, boundary: CodeDraftProtectionBoundary, cloud: ProblemDraftCloud, saveDelay: Duration = .milliseconds(600), onStatus: @escaping @MainActor (CodeDraftStatus, String?) -> Void) {
    self.accountId = accountId; self.problemId = problemId; self.language = language; self.contentVersion = contentVersion
    self.store = store; self.boundary = boundary; self.cloud = cloud; self.saveDelay = saveDelay; self.onStatus = onStatus
  }

  /// This device's draft, or the starter code when there is none, without waiting for the cloud. The cloud draft is
  /// read in the background; `reconciled()` reports whether it replaced the code.
  public func open(starterCode: String) async throws -> String {
    var stored = boundary.readUnprotected(accountId: accountId, problemId: problemId, language: language)
    if stored == nil { stored = try await store.read(accountId: accountId, problemId: problemId, language: language) }
    minted = stored == nil
    if let stored {
      local = stored.pending && stored.contentVersion == contentVersion ? stored : stored.revised { $0.contentVersion = contentVersion }
    } else {
      local = LocalCodeDraft(id: UUID().uuidString.lowercased(), accountId: accountId, problemId: problemId, language: language, contentVersion: contentVersion, code: starterCode, cloudRevision: 0, pending: false)
    }
    cloudRead = Task { await self.readCloud() }
    return local!.code
  }

  /// The cloud code when it replaced unedited local code, or nil when the code on screen stands.
  public func reconciled() async -> String? { await cloudRead.value }

  public var code: String? { local?.code }
  public var conflict: CloudCodeDraft? { cloudConflict }

  /// Protects new source on this device, then schedules its cloud save.
  public func protect(_ code: String) {
    guard let current = local else { return }
    let draft = current.revised { $0.contentVersion = contentVersion; $0.code = code; $0.pending = true; $0.updatedAt = Date() }
    local = draft
    onStatus(.protecting, nil)
    let write = queueLocalProtection(draft)
    Task {
      do {
        try await write.value
        if self.localWrites == write { self.onStatus(.protected, nil) }
        self.schedule()
      } catch { self.report(error) }
    }
  }

  /// Waits until every edit so far is durable on this device.
  public func protected() async throws { try await localWrites.value }

  public func retry() async throws -> String {
    guard let current = local else { throw ManorRequestError(operation: "Protect code", code: "state", detail: "The code draft must load before saving can be retried.") }
    do { try await localWrites.value } catch {
      do { try await queueLocalProtection(current).value; onStatus(.protected, nil) } catch { report(error); throw error }
    }
    if cloudReadFailed {
      cloudRead = Task { await self.readCloud() }
      _ = await cloudRead.value
      return local?.code ?? current.code
    }
    try await sync()
    return local?.code ?? current.code
  }

  public func keepLocal() async throws {
    guard let current = local, let remote = cloudConflict else {
      throw ManorRequestError(operation: "Resolve code", code: "state", detail: "Both code drafts must exist before resolving their conflict.")
    }
    let draft = current.revised { $0.cloudRevision = remote.revision; $0.contentVersion = contentVersion; $0.pending = true }
    local = draft
    try await queueLocalProtection(draft).value
    cloudConflict = nil
    try await sync()
  }

  public func useCloud() async throws -> String {
    guard let remote = try await cloud.loadDraft(problemId: problemId, language: language) else {
      throw ManorRequestError(operation: "Resolve code", code: "missing", detail: "The cloud code draft no longer exists. Your local code remains protected.")
    }
    let draft = LocalCodeDraft(id: remote.id, accountId: accountId, problemId: problemId, language: language, contentVersion: remote.contentVersion, code: remote.source, cloudRevision: remote.revision, pending: false, updatedAt: ProblemSubmissionStats.parseTimestamp(remote.updatedAt) ?? Date())
    local = draft
    try await queueLocalProtection(draft).value
    cloudConflict = nil
    onStatus(.saved, nil)
    return remote.source
  }

  public func sync() async throws {
    _ = await cloudRead.value
    try await localWrites.value
    if let cloudWrite {
      try await cloudWrite.value
      if local?.pending == true { return try await sync() }
      return
    }
    guard let draft = local, draft.pending else { return }
    if cloudConflict != nil {
      throw ManorRequestError(operation: "save_problem_draft", code: "conflict", detail: "Choose which code draft to keep before saving.")
    }
    onStatus(.saving, nil)
    let cloud = self.cloud
    let pending = Task { @MainActor in
      let receipt = try await cloud.saveDraft(draft)
      try await self.acknowledge(draft, revision: receipt.revision)
    }
    cloudWrite = pending
    defer { cloudWrite = nil }
    do { try await pending.value } catch {
      var committed = false
      do {
        let latest = try await cloud.loadDraft(problemId: problemId, language: language)
        if let latest, latest.source == draft.code, latest.contentVersion == draft.contentVersion {
          try await acknowledge(draft, revision: latest.revision)
          committed = true
        } else if let latest, latest.revision != draft.cloudRevision {
          cloudConflict = latest
        }
      } catch {}
      if !committed { report(error); throw error }
    }
    if local?.pending == true { schedule() }
  }

  /// Saves what is pending after leaving the problem or language; nothing is lost if this fails, because the source
  /// stays protected locally and the next open retries.
  public func stop() {
    stopped = true
    timer?.cancel()
    timer = nil
    Task { try? await self.sync() }
  }

  /// Reconciles the cloud draft with the local one. Unedited local code takes the cloud draft; edits made before it
  /// arrived conflict with a cloud draft whose revision they did not start from. The decision and the swap happen
  /// synchronously after the read, so no keystroke can land between them.
  private func readCloud() async -> String? {
    let remote: CloudCodeDraft?
    do { remote = try await cloud.loadDraft(problemId: problemId, language: language) } catch {
      cloudReadFailed = true
      onStatus(.failed, "Your code is safe on this device, but its cloud draft could not load: \(error.localizedDescription)")
      return nil
    }
    cloudReadFailed = false
    guard let current = local else { return nil }
    let reconciled: LocalCodeDraft
    if let remote {
      if !current.pending {
        reconciled = LocalCodeDraft(id: remote.id, accountId: accountId, problemId: problemId, language: language, contentVersion: contentVersion, code: remote.source, cloudRevision: remote.revision, pending: false, updatedAt: ProblemSubmissionStats.parseTimestamp(remote.updatedAt) ?? Date())
      } else if minted {
        var copy = current
        copy.id = remote.id
        reconciled = copy
      } else {
        reconciled = current
      }
    } else {
      reconciled = current
    }
    local = reconciled
    minted = false
    let written = queueLocalProtection(reconciled)
    if reconciled.pending, let remote, remote.revision != reconciled.cloudRevision {
      cloudConflict = remote
      onStatus(.protected, "This code was changed on another device. Compare the two drafts before saving.")
    } else if reconciled.pending {
      onStatus(.protected, nil)
      schedule()
    } else {
      onStatus(.saved, nil)
    }
    Task { do { try await written.value } catch { self.report(error) } }
    return reconciled.code == current.code ? nil : reconciled.code
  }

  private func schedule() {
    guard cloudConflict == nil, !stopped else { return }
    timer?.cancel()
    let delay = saveDelay
    timer = Task {
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      self.timer = nil
      try? await self.sync()
    }
  }

  private func queueLocalProtection(_ draft: LocalCodeDraft) -> Task<Void, Error> {
    let release = boundary.begin(draft)
    let previous = localWrites
    let store = self.store
    let write = Task { @MainActor in
      _ = await previous.result
      try await store.write(draft)
      release()
    }
    localWrites = write
    return write
  }

  private func acknowledge(_ draft: LocalCodeDraft, revision: Int) async throws {
    try await localWrites.value
    try await store.acknowledge(accountId: draft.accountId, problemId: draft.problemId, language: language, source: draft.code, revision: revision)
    if var current = local {
      current.cloudRevision = revision
      current.pending = current.code != draft.code
      local = current
    }
    onStatus(local?.pending == true ? .protected : .saved, nil)
  }

  private func report(_ error: Error) { onStatus(.failed, error.localizedDescription) }
}
