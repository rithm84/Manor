import Foundation

/// The backend surface Notes uses. `Gateway` provides it; tests use an in-memory server.
@MainActor
public protocol NotesTransport: AnyObject {
  var accountId: String { get }
  /// Folder and page rows, from the local mirror once it serves.
  func rows(_ table: String, where filters: [RowFilter]) async throws -> [Row]
  /// A read straight from Postgres (versions, suggestions, the current row during a re-base).
  func serverRows(_ table: String, where filters: [RowFilter]) async throws -> [Row]
  @discardableResult func command(_ operation: String, _ input: JSONObject, id: UUID) async throws -> CommandReceipt
}

extension Gateway: NotesTransport {
  public func serverRows(_ table: String, where filters: [RowFilter]) async throws -> [Row] {
    try await rowsFromServer(table, where: filters)
  }
}

/// The note changed elsewhere in a way the block merge cannot combine; Compare versions resolves it.
public struct NoteConflictError: LocalizedError, Sendable {
  public let noteId: String
  public var errorDescription: String? { "This note changed elsewhere. Compare versions before saving your draft." }
}

/// Notes persistence: protected drafts, the per-note save queue, the block merge on a moved revision, lifecycle
/// commands, versions, suggestions, and the offline snapshot. Ported from the web app's `NotesService`.
@MainActor
public final class NotesService {
  public let transport: NotesTransport
  public let store: NoteDraftStore
  public var accountId: String { transport.accountId }

  /// Highest revision seen per note. Reads that overtake a save cannot lower it.
  private var revisions: [String: Int] = [:]
  private var folderRevisions: [String: Int] = [:]
  private var conflicts = Set<String>()
  /// The tail of each note's save chain; saves for one note run strictly in order.
  private var chains: [String: Task<Void, Never>] = [:]
  private var confirmed: [String: (page: NotePage, title: String, blocks: [JSONValue])] = [:]
  /// Foreign block edits merged into a save, until the open editor collects them.
  private var mergedOps: [String: [NoteMerge.BlockOp]] = [:]
  private var snapshot: NotesSnapshot?
  private var snapshotWrite: Task<Void, Never>?
  /// Set once a sign-out passed its check, so no later edit slips in before the session ends.
  public private(set) var signingOut = false

  public init(transport: NotesTransport, store: NoteDraftStore) {
    self.transport = transport
    self.store = store
  }

  // MARK: Revisions

  @discardableResult
  private func adopt(_ noteId: String, _ revision: Int) -> Int {
    let known = max(revisions[noteId] ?? 0, revision)
    revisions[noteId] = known
    return known
  }

  /// The highest revision this device has seen for a note, or nil before it was loaded.
  public func knownRevision(_ noteId: String) -> Int? { revisions[noteId] }

  public func hasConflict(_ noteId: String) -> Bool { conflicts.contains(noteId) }

  /// Ops from the latest save that merged foreign block changes into this note, handed over once.
  public func takeMergedOps(_ noteId: String) -> [NoteMerge.BlockOp] {
    mergedOps.removeValue(forKey: noteId) ?? []
  }

  // MARK: Load

  public struct OfflineUnavailable: LocalizedError {
    public var errorDescription: String? { "Connect once to load your Notes on this device." }
  }

  private func cachedState() async throws -> NotesState {
    if snapshot == nil { snapshot = try await store.snapshot(accountId: accountId) }
    guard let snapshot else { throw OfflineUnavailable() }
    for (id, revision) in snapshot.revisions { adopt(id, revision) }
    return snapshot.state
  }

  /// Reads the corpus (the mirror answers once it serves), keeps newer copies this device already holds, and
  /// overlays protected drafts. Without a connection it starts from the stored snapshot.
  public func load() async throws -> NotesState {
    try await withDrafts(try await readCorpus().state)
  }

  /// Like `load`, but nil when the read carries nothing this device does not already hold: the echo of its own
  /// save or opening. This is what a change notification calls, so only real foreign changes reload the page.
  public func loadIfChanged() async throws -> NotesState? {
    let result = try await readCorpus()
    guard result.changed else { return nil }
    return try await withDrafts(result.state)
  }

  private func readCorpus() async throws -> (state: NotesState, changed: Bool) {
    do {
      async let folderRows = transport.rows("note_folders", where: [])
      async let pageRows = transport.rows("note_pages", where: [])
      let (folders, pages) = try await (folderRows, pageRows)
      if snapshot == nil { snapshot = try? await store.snapshot(accountId: accountId) }
      let previous = snapshot
      var state = NotesState()
      for row in folders where row["deleted_at"]?.isNull ?? true {
        let folder = try NoteRows.folder(row)
        folderRevisions[folder.id] = folder.revision
        state.folders.append(folder)
      }
      state.folders.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
      let kept = Dictionary((previous?.state.pages ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
      for row in pages {
        let current = try NoteRows.page(row)
        let known = adopt(current.id, current.revision)
        // A read that started before a save finished returns the note as it was, and one after an opening whose
        // pull failed carries the earlier last_opened_at; keep the newer copy this device already has.
        if let local = kept[current.id], current.revision < known || (current.revision == known && local.lastOpenedAt > current.lastOpenedAt) {
          state.pages.append(local)
        } else {
          state.pages.append(current)
        }
      }
      let changed = previous.map { !Self.same($0, state, revisions) } ?? true
      if changed { remember(state) }
      return (state, changed)
    } catch is ManorConnectionError {
      return (try await cachedState(), snapshot == nil)
    }
  }

  /// Whether a fresh read says nothing the stored snapshot does not.
  static func same(_ previous: NotesSnapshot, _ state: NotesState, _ revisions: [String: Int]) -> Bool {
    guard previous.state.folders.count == state.folders.count, previous.state.pages.count == state.pages.count else { return false }
    for (old, new) in zip(previous.state.folders, state.folders) {
      if old.id != new.id || old.name != new.name || old.parentFolderId != new.parentFolderId || old.updatedAt != new.updatedAt { return false }
    }
    let oldPages = Dictionary(previous.state.pages.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    for page in state.pages {
      guard let old = oldPages[page.id] else { return false }
      if old.updatedAt != page.updatedAt || old.lastOpenedAt != page.lastOpenedAt || old.status != page.status || old.favorite != page.favorite
        || old.folderId != page.folderId || old.parentPageId != page.parentPageId || old.revision != page.revision { return false }
    }
    for (id, revision) in revisions where previous.revisions[id] != revision { return false }
    return true
  }

  private func withDrafts(_ state: NotesState) async throws -> NotesState {
    let pending = Dictionary(try await store.list(accountId: accountId).map { ($0.noteId, $0) }, uniquingKeysWith: { _, last in last })
    guard !pending.isEmpty else { return state }
    var result = state
    result.pages = state.pages.map { page in
      guard let draft = pending[page.id] else { return page }
      var copy = page
      copy.title = draft.title
      copy.content = draft.blocks
      return copy
    }
    return result
  }

  /// Keeps the in-memory snapshot current and writes it to disk shortly after, coalescing bursts of saves.
  private func remember(_ state: NotesState) {
    snapshot = NotesSnapshot(accountId: accountId, state: state, revisions: revisions)
    scheduleSnapshotWrite()
  }

  private func remember(page: NotePage) {
    guard var current = snapshot else { return }
    if let index = current.state.pages.firstIndex(where: { $0.id == page.id }) { current.state.pages[index] = page }
    else { current.state.pages.append(page) }
    current.revisions = revisions
    snapshot = current
    scheduleSnapshotWrite()
  }

  private func forget(pages ids: Set<String>) {
    guard var current = snapshot else { return }
    current.state.pages.removeAll { ids.contains($0.id) }
    for id in ids { current.revisions[id] = nil }
    snapshot = current
    scheduleSnapshotWrite()
  }

  private func scheduleSnapshotWrite() {
    snapshotWrite?.cancel()
    snapshotWrite = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(600))
      guard !Task.isCancelled, let self, let snapshot = self.snapshot else { return }
      try? await self.store.saveSnapshot(snapshot)
    }
  }

  /// Writes any pending snapshot now (before quitting or signing out).
  public func flushSnapshot() async {
    snapshotWrite?.cancel()
    snapshotWrite = nil
    if let snapshot { try? await store.saveSnapshot(snapshot) }
  }

  // MARK: Drafts

  public struct SigningOut: LocalizedError {
    public var errorDescription: String? { "Manor is signing out. This edit was not saved." }
  }

  /// Protects a draft on this device. Returning means the SQLite transaction committed.
  public func protectDraft(_ content: NoteContent) async throws {
    guard !signingOut else { throw SigningOut() }
    var native = content
    native.blocks = NoteRows.nativeBlocks(content.blocks)
    try await store.protect(accountId: accountId, content: native, knownRevision: revisions[content.id])
  }

  public func pendingDrafts() async throws -> [NoteContent] {
    try await store.list(accountId: accountId).map(\.content)
  }

  /// Sends every protected draft, oldest first.
  public func syncDrafts() async throws -> [NotePage] {
    var saved: [NotePage] = []
    for draft in try await pendingDrafts() { saved.append(try await updatePage(draft)) }
    return saved
  }

  // MARK: Save queue

  private func serialized<T: Sendable>(_ noteId: String, _ work: @escaping @MainActor () async throws -> T) async throws -> T {
    let previous = chains[noteId]
    let task = Task { @MainActor () -> Result<T, Error> in
      await previous?.value
      do { return .success(try await work()) } catch { return .failure(error) }
    }
    let tail = Task { @MainActor in _ = await task.value }
    chains[noteId] = tail
    let result = await task.value
    if chains[noteId] == tail { chains[noteId] = nil }
    return try result.get()
  }

  /// Saves a note's protected draft. Saves for one note run in order, so each one replays the draft as re-based by
  /// the save before it.
  public func updatePage(_ content: NoteContent) async throws -> NotePage {
    try await serialized(content.id) { try await self.savePage(content, rebases: 0) }
  }

  private func savePage(_ update: NoteContent, rebases: Int) async throws -> NotePage {
    if conflicts.contains(update.id) { throw NoteConflictError(noteId: update.id) }
    guard let pending = try await store.read(accountId: accountId, noteId: update.id) else {
      // Nothing is pending: an earlier save in the queue already carried this draft (or a newer one).
      if let saved = confirmed[update.id] { return saved.page }
      throw ManorRequestError(operation: "Save note", code: "unprotected", detail: "The note's draft was not saved on this device before syncing.")
    }
    try NoteLimits.checkContent(pending.blocks)
    let title = try NoteLimits.title(pending.title)
    let receipt: CommandReceipt
    do {
      receipt = try await transport.command("update_note", [
        "id": .string(update.id), "title": .string(title), "content_json": .array(pending.blocks),
        "expected_revision": .number(Double(pending.baseRevision))
      ], id: UUID(uuidString: pending.mutationId) ?? UUID())
    } catch let error as ManorRequestError where error.isConflict {
      // The revision moved. Blocks are the unit of conflict: the draft is re-based onto the server document when
      // the two sides changed different blocks (or nothing but the revision moved), and sent once more.
      if rebases == 0, try await rebaseOntoServer(update.id) { return try await savePage(update, rebases: rebases + 1) }
      conflicts.insert(update.id)
      throw NoteConflictError(noteId: update.id)
    }
    guard let record = receipt.record else {
      throw ManorRequestError(operation: "Save note", code: "receipt", detail: "Saving the note did not return the committed document.")
    }
    let saved = try NoteRows.page(record)
    let revision = adopt(update.id, saved.revision)
    remember(page: saved)
    if case .conflict = try await store.commit(sent: pending, revision: revision, committed: saved.content) {
      conflicts.insert(update.id)
    }
    confirmed[update.id] = (saved, title, pending.blocks)
    return saved
  }

  /// Re-bases the pending draft onto the current server document using the version the draft started from, which
  /// the server keeps for every superseded revision. False when the same block (or the title) changed on both sides.
  private func rebaseOntoServer(_ noteId: String) async throws -> Bool {
    guard let draft = try await store.read(accountId: accountId, noteId: noteId) else { return false }
    async let currentRows = transport.serverRows("note_pages", where: [RowFilter("id", .string(noteId))])
    async let baseRows = transport.serverRows("note_versions", where: [RowFilter("note_id", .string(noteId)), RowFilter("revision", .number(Double(draft.baseRevision)))])
    let (current, base) = try await (currentRows, baseRows)
    guard let currentRow = current.first, let baseRow = base.first else { return false }
    let server = try NoteRows.page(currentRow)
    let version = try NoteRows.version(baseRow, noteId: noteId)
    guard case .clean(let merged, let ops) = try NoteMerge.merge(base: version.blocks, mine: draft.blocks, theirs: server.content),
          let title = NoteMerge.mergeTitle(base: version.title, mine: draft.title, theirs: server.title) else { return false }
    let revision = adopt(noteId, server.revision)
    let sentMutation = draft.mutationId
    let sentBlocks = draft.blocks
    try await store.update(accountId: accountId, noteId: noteId) { latest in
      guard var latest else { return nil }
      if latest.mutationId != sentMutation {
        // Typing continued during the fetch: carry the merged-in foreign blocks over onto it.
        guard case .clean(let combined, _) = try NoteMerge.merge(base: sentBlocks, mine: latest.blocks, theirs: merged) else {
          throw NoteConflictError(noteId: noteId)
        }
        latest.blocks = combined
      } else {
        latest.blocks = merged
      }
      latest.title = latest.title == draft.title ? title : latest.title
      latest.baseRevision = revision
      return latest
    }
    if !ops.isEmpty { mergedOps[noteId, default: []].append(contentsOf: ops) }
    return true
  }

  /// Lands whatever this device still holds for a note before another change to it goes out.
  private func flushDraft(_ noteId: String) async throws {
    await chains[noteId]?.value
    guard let pending = try await store.read(accountId: accountId, noteId: noteId) else { return }
    _ = try await updatePage(pending.content)
  }

  // MARK: Commands

  public struct NotLoaded: LocalizedError {
    public var errorDescription: String? { "Load the note before changing it." }
  }

  private func receiptPage(_ receipt: CommandReceipt, _ operation: String) throws -> NotePage {
    guard let record = receipt.record else {
      throw ManorRequestError(operation: operation, code: "receipt", detail: "The change did not return the saved note.")
    }
    let page = try NoteRows.page(record)
    adopt(page.id, page.revision)
    remember(page: page)
    return page
  }

  /// A change to one note, sent behind its protected draft with the revision that draft committed.
  private func command(_ operation: String, _ id: String, _ input: JSONObject) async throws -> NotePage {
    try await flushDraft(id)
    guard let revision = revisions[id] else { throw NotLoaded() }
    var payload = input
    payload["id"] = .string(id)
    payload["expected_revision"] = .number(Double(revision))
    return try receiptPage(try await transport.command(operation, payload, id: UUID()), operation)
  }

  /// Creates a note with a fresh id and returns the corpus with it.
  public func createPage(title: String, folderId: String?, parentPageId: String?, blocks: [JSONValue]) async throws -> (state: NotesState, id: String) {
    let id = UUID().uuidString.lowercased()
    let native = NoteRows.nativeBlocks(blocks)
    try NoteLimits.checkContent(native)
    let receipt = try await transport.command("create_note", [
      "id": .string(id), "title": .string(try NoteLimits.title(title)), "content_json": .array(native),
      "folder_id": .from(folderId), "parent_page_id": .from(parentPageId), "expected_revision": 0
    ], id: UUID())
    _ = try? receiptPage(receipt, "create_note")
    return (try await load(), id)
  }

  public func createFolder(name: String, parentFolderId: String? = nil) async throws -> (state: NotesState, id: String) {
    let id = UUID().uuidString.lowercased()
    try await transport.command("create_note_folder", [
      "id": .string(id), "name": .string(try NoteLimits.folderName(name)), "parent_folder_id": .from(parentFolderId), "expected_revision": 0
    ], id: UUID())
    return (try await load(), id)
  }

  public func renameFolder(id: String, name: String) async throws -> NotesState {
    try await transport.command("update_note_folder", [
      "id": .string(id), "name": .string(try NoteLimits.folderName(name)), "expected_revision": .number(Double(folderRevisions[id] ?? 0))
    ], id: UUID())
    return try await load()
  }

  public func deleteFolder(id: String) async throws -> NotesState {
    try await transport.command("remove_note_folder", ["id": .string(id), "expected_revision": .number(Double(folderRevisions[id] ?? 0))], id: UUID())
    return try await load()
  }

  /// Records an opening. Without a connection the note opens from what this device holds.
  public func touchPage(_ id: String) async throws -> NotePage? {
    do {
      let receipt = try await transport.command("touch_note", ["id": .string(id), "expected_revision": .number(Double(revisions[id] ?? 0))], id: UUID())
      var page = try receiptPage(receipt, "touch_note")
      if let pending = try await store.read(accountId: accountId, noteId: id) {
        page.title = pending.title
        page.content = pending.blocks
      }
      return page
    } catch is ManorConnectionError {
      return nil
    }
  }

  public func movePage(id: String, folderId: String?, parentPageId: String?) async throws -> NotesState {
    _ = try await command("move_note", id, ["folder_id": .from(folderId), "parent_page_id": .from(parentPageId)])
    return try await load()
  }

  public func setFavorite(id: String, favorite: Bool) async throws -> NotesState {
    _ = try await command("update_note", id, ["favorite": .bool(favorite)])
    return try await load()
  }

  public func archivePage(id: String) async throws -> NotesState {
    _ = try await command("archive_note", id, [:])
    return try await load()
  }

  public func trashPages(_ ids: [String]) async throws -> NotesState {
    for id in ids { _ = try await command("trash_note", id, [:]) }
    return try await load()
  }

  public func restorePages(_ ids: [String]) async throws -> NotesState {
    for id in ids { _ = try await command("restore_note", id, [:]) }
    return try await load()
  }

  /// Permanently deletes notes already in Trash, with their subpages; nothing recovers them afterwards.
  public func purgePages(_ ids: [String]) async throws -> NotesState {
    var removed = Set<String>()
    for id in ids {
      guard let revision = revisions[id] else { throw NotLoaded() }
      try await transport.command("purge_note", ["id": .string(id), "expected_revision": .number(Double(revision))], id: UUID())
      revisions[id] = nil
      confirmed[id] = nil
      conflicts.remove(id)
      try? await store.discard(accountId: accountId, noteId: id)
      removed.insert(id)
    }
    forget(pages: removed)
    return try await load()
  }

  public func duplicatePage(_ id: String) async throws -> (state: NotesState, id: String) {
    try await flushDraft(id)
    let state = try await load()
    guard let source = state.pages.first(where: { $0.id == id }) else {
      throw ManorRequestError(operation: "Duplicate note", code: "missing", detail: "The note to duplicate is unavailable.")
    }
    // A copy gets fresh block ids so the two documents never share addresses.
    return try await createPage(title: String("\(source.title) (copy)".prefix(NoteLimits.titleLength)), folderId: source.folderId,
                                parentPageId: source.parentPageId, blocks: Self.freshIds(source.content))
  }

  static func freshIds(_ blocks: [JSONValue]) -> [JSONValue] {
    blocks.map { block in
      guard var object = block.object else { return block }
      object["id"] = .string(UUID().uuidString.lowercased())
      if case .array(let children)? = object["children"] { object["children"] = .array(freshIds(children)) }
      return .object(object)
    }
  }

  /// Moves blocks to another note; both notes' drafts land first.
  public func moveBlocks(sourceId: String, targetId: String, blockIds: [String]) async throws -> NotesState {
    try await flushDraft(sourceId)
    try await flushDraft(targetId)
    guard let source = revisions[sourceId], let target = revisions[targetId] else { throw NotLoaded() }
    try await transport.command("move_note_blocks", [
      "id": .string(sourceId), "expected_revision": .number(Double(source)), "target_note_id": .string(targetId),
      "target_expected_revision": .number(Double(target)), "block_ids": .array(blockIds.map(JSONValue.string))
    ], id: UUID())
    return try await load()
  }

  // MARK: Versions and suggestions

  public func listVersions(_ noteId: String) async throws -> [NoteVersion] {
    try await transport.serverRows("note_versions", where: [RowFilter("note_id", .string(noteId))])
      .map { try NoteRows.version($0, noteId: noteId) }
      .sorted { $0.revision > $1.revision }
  }

  /// Restoring creates a new current revision; the replaced one stays in history.
  public func restoreVersion(noteId: String, revision: Int) async throws -> NotePage {
    try await command("restore_note_version", noteId, ["version_revision": .number(Double(revision))])
  }

  public func listSuggestions(_ noteId: String) async throws -> [NoteSuggestion] {
    try await transport.serverRows("note_suggestions", where: [RowFilter("note_id", .string(noteId))])
      .map { try NoteRows.suggestion($0, noteId: noteId) }
      .sorted { $0.createdAt < $1.createdAt }
  }

  public func reviewSuggestions(noteId: String, ids: [String], accept: Bool) async throws -> NotePage {
    try await command("resolve_note_suggestions", noteId, [
      "suggestion_ids": .array(ids.map(JSONValue.string)), "decision": .string(accept ? "accepted" : "rejected")
    ])
  }

  // MARK: Conflicts

  public func readConflict(_ noteId: String) async throws -> NoteConflict {
    guard let local = try await store.read(accountId: accountId, noteId: noteId) else {
      throw ManorRequestError(operation: "Compare versions", code: "missing", detail: "There is no draft on this device to compare.")
    }
    guard let row = try await transport.serverRows("note_pages", where: [RowFilter("id", .string(noteId))]).first else {
      throw ManorRequestError(operation: "Compare versions", code: "missing", detail: "The note is no longer in your account.")
    }
    let current = try NoteRows.page(row)
    return NoteConflict(current: current, local: local.content, revision: current.revision)
  }

  /// Saves this device's draft over the cloud note; the replaced cloud revision stays in history.
  public func resolveConflict(_ conflict: NoteConflict) async throws -> NotePage {
    let local = conflict.local
    try await store.update(accountId: accountId, noteId: local.id) { current in
      guard var current, current.title == local.title, current.blocks == local.blocks else {
        throw ManorRequestError(operation: "Compare versions", code: "changed", detail: "Your draft changed. Reopen the comparison before resolving it.")
      }
      current.baseRevision = conflict.revision
      current.mutationId = UUID().uuidString.lowercased()
      return current
    }
    adopt(local.id, conflict.revision)
    conflicts.remove(local.id)
    return try await updatePage(local)
  }

  /// Keeps the cloud copy: the draft on this device is dropped and the note shows the cloud version.
  public func discardDraft(_ noteId: String) async throws {
    try await store.discard(accountId: accountId, noteId: noteId)
    conflicts.remove(noteId)
  }

  // MARK: Sign-out

  /// The sign-out check: waits for in-flight saves, then refuses while anything is unsynced. When it passes,
  /// further edits are refused so nothing slips in before the session ends.
  public func prepareSignOut() async -> String? {
    for chain in chains.values { await chain.value }
    do {
      if try await store.hasUnsynced(accountId: accountId) {
        return "Your Notes have changes saved on this Mac that have not synced yet. Connect and let them sync before signing out."
      }
    } catch {
      return "Manor could not check your Notes for unsynced changes, so sign-out was cancelled."
    }
    signingOut = true
    await flushSnapshot()
    return nil
  }

  /// Lets edits through again when a sign-out did not finish.
  public func cancelSignOut() { signingOut = false }
}
