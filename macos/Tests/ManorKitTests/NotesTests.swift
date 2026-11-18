import Foundation
import Testing
@testable import ManorKit

// MARK: Fixtures

private func para(_ id: String, _ text: String) -> JSONValue {
  ["id": .string(id), "type": "paragraph", "props": ["textAlignment": "left"],
   "content": [["type": "text", "text": .string(text), "styles": [:]]], "children": []]
}

private func ids(_ blocks: [JSONValue]) -> [String] { blocks.compactMap { $0["id"]?.string } }
private func text(_ block: JSONValue) -> String? { block["content"]?.array?.first?["text"]?.string }

private let base: [JSONValue] = [para("a", "first"), para("b", "second"), para("c", "third")]

private func page(_ id: String, title: String = "Note", folder: String? = nil, parent: String? = nil, status: NotePageStatus = .active,
                  favorite: Bool = false, updated: String = "2026-11-01T10:00:00+00:00", opened: String = "2026-11-01T10:00:00+00:00",
                  content: [JSONValue] = [], revision: Int = 1) -> NotePage {
  NotePage(id: id, title: title, folderId: folder, parentPageId: parent, content: content, favorite: favorite, status: status,
           createdAt: "2026-11-01T09:00:00+00:00", updatedAt: updated, lastOpenedAt: opened, revision: revision)
}

// MARK: Merge

@Suite("Note block merge")
struct NoteMergeTests {
  @Test func mergesEditsToDifferentBlocksAndReturnsOps() throws {
    let mine = [para("a", "first, edited by me"), para("b", "second"), para("c", "third")]
    let theirs = base + [para("d", "appended elsewhere")]
    guard case .clean(let merged, let ops) = try NoteMerge.merge(base: base, mine: mine, theirs: theirs) else { Issue.record("expected clean"); return }
    #expect(ids(merged) == ["a", "b", "c", "d"])
    #expect(text(merged[0]) == "first, edited by me")
    #expect(ops == [.insert(block: para("d", "appended elsewhere"), afterId: "c")])
    #expect(NoteMerge.apply(ops, to: mine) == merged)
  }

  @Test func reportsSameBlockEditsAndEditVersusRemoval() throws {
    let mine = [para("a", "mine"), para("b", "second"), para("c", "third")]
    let theirs = [para("a", "theirs"), para("b", "second"), para("c", "third")]
    #expect(try NoteMerge.merge(base: base, mine: mine, theirs: theirs) == .conflict(blockIds: ["a"]))
    let removed = [para("b", "second"), para("c", "third")]
    #expect(try NoteMerge.merge(base: base, mine: mine, theirs: removed) == .conflict(blockIds: ["a"]))
  }

  @Test func treatsIdenticalEditsRemovalsAndKeyOrderAsAgreement() throws {
    let mine = [para("a", "same"), para("c", "third")]
    // Built in a different key order, the way jsonb returns it.
    let reordered: JSONValue = .object(["children": [], "content": [["styles": [:], "text": "same", "type": "text"]], "id": "a", "props": ["textAlignment": "left"], "type": "paragraph"])
    let theirs = [reordered, para("c", "third")]
    guard case .clean(_, let ops) = try NoteMerge.merge(base: base, mine: mine, theirs: theirs) else { Issue.record("expected clean"); return }
    #expect(ops.isEmpty)
  }

  @Test func followsTheOneSideThatReorderedAndConflictsWhenBothDid() throws {
    let mine = [para("a", "first!"), para("b", "second"), para("c", "third")]
    let theirs = [para("c", "third"), para("a", "first"), para("b", "second")]
    guard case .clean(let merged, let ops) = try NoteMerge.merge(base: base, mine: mine, theirs: theirs) else { Issue.record("expected clean"); return }
    #expect(ids(merged) == ["c", "a", "b"])
    #expect(text(merged[1]) == "first!")
    #expect(NoteMerge.apply(ops, to: mine) == merged)
    let mineReordered = [para("b", "second"), para("a", "first"), para("c", "third")]
    #expect(try NoteMerge.merge(base: base, mine: mineReordered, theirs: theirs) == .conflict(blockIds: ["order"]))
  }

  @Test func placesAForeignInsertionAfterItsNearestSurvivingNeighbor() throws {
    let mine = [para("a", "first"), para("c", "third")]
    let theirs = [para("a", "first"), para("b", "second"), para("x", "after b"), para("c", "third")]
    guard case .clean(let merged, _) = try NoteMerge.merge(base: base, mine: mine, theirs: theirs) else { Issue.record("expected clean"); return }
    #expect(ids(merged) == ["a", "x", "c"])
  }

  @Test func refusesBlocksWithoutIds() {
    #expect(throws: NoteMerge.MissingBlockId.self) { try NoteMerge.merge(base: [["type": "paragraph"]], mine: [], theirs: []) }
  }

  @Test func mergesTitles() {
    #expect(NoteMerge.mergeTitle(base: "Plan", mine: "Plan", theirs: "Plan v2") == "Plan v2")
    #expect(NoteMerge.mergeTitle(base: "Plan", mine: "Mine", theirs: "Plan") == "Mine")
    #expect(NoteMerge.mergeTitle(base: "Plan", mine: "Mine", theirs: "Theirs") == nil)
    #expect(NoteMerge.mergeTitle(base: "Plan", mine: "Same", theirs: "Same") == "Same")
  }
}

// MARK: Model

@Suite("Notes model")
struct NotesModelTests {
  @Test func decodesRowsAndFillsMissingBlockIdsOnce() throws {
    let row: Row = ["id": "n1", "title": "Plan", "folder_id": .null, "parent_page_id": .null, "content_json": [["type": "paragraph"], para("keep", "x")],
                    "favorite": true, "status": "archived", "created_at": "2026-11-01T00:00:00+00:00", "updated_at": "2026-11-02T00:00:00+00:00",
                    "last_opened_at": "2026-11-03T00:00:00+00:00", "archived_at": "2026-11-02T00:00:00+00:00", "deleted_at": .null, "revision": 4]
    let note = try NoteRows.page(row)
    #expect(note.status == .archived && note.favorite && note.revision == 4 && note.content.count == 2)
    let native = NoteRows.nativeBlocks(note.content)
    #expect(native[0]["id"]?.string?.isEmpty == false)
    #expect(native[1]["id"]?.string == "keep")
    #expect(throws: NoteRows.DecodeError.self) { try NoteRows.page(["id": "x", "status": "gone"]) }
  }

  @Test func scopesFilterSearchAndSortNewestFirst() {
    let pages = [
      page("a", title: "Groceries", updated: "2026-11-01T10:00:00+00:00", opened: "2026-11-05T10:00:00+00:00"),
      page("b", title: "Trip", folder: "f1", favorite: true, updated: "2026-11-03T10:00:00+00:00", content: [para("p", "Lisbon itinerary")]),
      page("c", title: "Old", status: .trash), page("d", title: "Shelved", status: .archived)
    ]
    #expect(NotesModel.pages(pages, scope: .all, query: "").map(\.id) == ["b", "a"])
    #expect(NotesModel.pages(pages, scope: .recent, query: "").map(\.id) == ["a", "b"])
    #expect(NotesModel.pages(pages, scope: .favorites, query: "").map(\.id) == ["b"])
    #expect(NotesModel.pages(pages, scope: .folder("f1"), query: "").map(\.id) == ["b"])
    #expect(NotesModel.pages(pages, scope: .trash, query: "").map(\.id) == ["c"])
    #expect(NotesModel.pages(pages, scope: .archived, query: "").map(\.id) == ["d"])
    #expect(NotesModel.pages(pages, scope: .all, query: "LISBON").map(\.id) == ["b"])
    let counts = NotesCounts(pages)
    #expect(counts.all == 2 && counts.favorites == 1 && counts.trash == 1 && counts.archived == 1 && counts.count(for: .folder("f1")) == 1)
  }

  @Test func nestsSubpagesUnderParentsInTheSameList() {
    let rows = NotesModel.treeRows([
      page("child", parent: "root", updated: "2026-11-02T00:00:00+00:00"), page("root", updated: "2026-11-01T00:00:00+00:00"),
      page("orphan", parent: "missing", updated: "2026-11-03T00:00:00+00:00")
    ])
    #expect(rows.map(\.id) == ["orphan", "root", "child"])
    #expect(rows.map(\.depth) == [0, 0, 1])
    #expect(NotesModel.withDescendants(["root"], in: [page("child", parent: "root"), page("root"), page("g", parent: "child")]) == ["root", "child", "g"])
  }

  @Test func searchesInlineTextCaptionsAndMentions() {
    let doc: [JSONValue] = [["id": "i", "type": "image", "props": ["caption": "Harbor at dusk"]],
                            ["id": "m", "type": "paragraph", "content": [["type": "pageMention", "props": ["pageId": "x", "title": "Budget"]]]]]
    let text = NotesModel.searchableText(page("p", title: "Photos", content: doc))
    #expect(text.contains("harbor at dusk") && text.contains("budget"))
  }

  @Test func titlesImportsByTheOpeningHeading() {
    #expect(NotesModel.importedTitle(fileName: "Trip plan 0123456789abcdef0123456789abcdef.md") == "Trip plan")
    #expect(NotesModel.importedTitle(fileName: ".md") == "Imported note")
    let split = NotesModel.splitLeadingHeading("---\ntags: x\n---\n\n# Weekly plan #\nBody line\n")
    #expect(split.title == "Weekly plan")
    #expect(split.body == "Body line\n")
    #expect(NotesModel.splitLeadingHeading("Intro\n# Later").title == nil)
    #expect(NotesModel.splitLeadingHeading("## Second level\nx").title == nil)
  }

  @Test func selectsRangesTogglesAndPrunes() {
    let order = ["a", "b", "c", "d"]
    var selection = NoteSelection.one("b")
    selection = selection.click("d", in: order, range: true, toggle: false)
    #expect(selection.ids == ["b", "c", "d"] && selection.anchor == "b")
    selection = selection.click("a", in: order, range: false, toggle: true)
    #expect(selection.ids == ["b", "c", "d", "a"] && selection.anchor == "a")
    selection = selection.click("c", in: order, range: false, toggle: true)
    #expect(selection.ids == ["b", "d", "a"])
    #expect(selection.targets(for: "d") == ["b", "d", "a"])
    #expect(selection.targets(for: "c") == ["c"])
    let pruned = selection.pruned(to: ["b", "c"])
    #expect(pruned.ids == ["b"] && pruned.anchor == "c")
    #expect(selection.pruned(to: ["b"]).anchor == "b")
    #expect(NoteSelection.all(order).ids == order)
    #expect(NoteSelection.empty.range(to: "c", in: order).ids == ["c"])
  }
}

// MARK: Draft store

@Suite("Note draft store")
struct NoteDraftStoreTests {
  @Test func protectsKeepsTheBaseRevisionAndAcknowledgesOnlyTheSentVersion() async throws {
    let store = try NoteDraftStore()
    let first = try await store.protect(accountId: "u1", content: NoteContent(id: "n", title: "T", blocks: [para("a", "one")]), knownRevision: 3)
    #expect(first.baseRevision == 3)
    let same = try await store.protect(accountId: "u1", content: NoteContent(id: "n", title: "T", blocks: [para("a", "one")]), knownRevision: 9)
    #expect(same.mutationId == first.mutationId)
    let second = try await store.protect(accountId: "u1", content: NoteContent(id: "n", title: "T", blocks: [para("a", "two")]), knownRevision: 9)
    #expect(second.baseRevision == 3 && second.mutationId != first.mutationId)
    try await store.acknowledge(accountId: "u1", noteId: "n", mutationId: first.mutationId)
    #expect(try await store.read(accountId: "u1", noteId: "n") != nil)
    #expect(try await store.hasUnsynced(accountId: "u1"))
    #expect(try await store.hasUnsynced(accountId: "u2") == false)
    try await store.acknowledge(accountId: "u1", noteId: "n", mutationId: second.mutationId)
    #expect(try await store.read(accountId: "u1", noteId: "n") == nil)
    await #expect(throws: ManorRequestError.self) {
      try await store.protect(accountId: "u1", content: NoteContent(id: "unknown", title: "T", blocks: []), knownRevision: nil)
    }
  }

  @Test func commitMovesNewerTypingOntoTheCommittedRevisionAndMergesForeignBlocks() async throws {
    let store = try NoteDraftStore()
    let sent = try await store.protect(accountId: "u", content: NoteContent(id: "n", title: "T", blocks: base), knownRevision: 2)
    // Typing continued during the request.
    var typed = base
    typed[2] = para("c", "third, typed during the save")
    try await store.protect(accountId: "u", content: NoteContent(id: "n", title: "T", blocks: typed), knownRevision: 2)
    // The committed document carries a foreign edit to block a (the save was merged).
    var committed = base
    committed[0] = para("a", "first, from another Mac")
    guard case .kept(let kept) = try await store.commit(sent: sent, revision: 5, committed: committed) else { Issue.record("expected kept"); return }
    #expect(kept.baseRevision == 5)
    #expect(text(kept.blocks[0]) == "first, from another Mac")
    #expect(text(kept.blocks[2]) == "third, typed during the save")
    let latest = try #require(try await store.read(accountId: "u", noteId: "n"))
    #expect(latest.blocks == kept.blocks)
    #expect(try await store.commit(sent: latest, revision: 6, committed: latest.blocks) == .cleared)
  }

  @Test func refusesToClearWhileUnsyncedAndRoundTripsTheSnapshot() async throws {
    let store = try NoteDraftStore()
    let snapshot = NotesSnapshot(accountId: "u", state: NotesState(folders: [NoteFolder(id: "f", name: "Work", createdAt: "x", updatedAt: "x")], pages: [page("p")]), revisions: ["p": 4])
    try await store.saveSnapshot(snapshot)
    #expect(try await store.snapshot(accountId: "u") == snapshot)
    try await store.protect(accountId: "u", content: NoteContent(id: "p", title: "T", blocks: []), knownRevision: 4)
    await #expect(throws: ManorRequestError.self) { try await store.clear(accountId: "u") }
    try await store.discard(accountId: "u", noteId: "p")
    try await store.clear(accountId: "u")
    #expect(try await store.snapshot(accountId: "u") == nil)
  }
}

// MARK: Service

/// An in-memory `manor_command` for note saves, with revision checks and kept versions.
@MainActor
private final class FakeNotesServer: NotesTransport {
  let accountId = "u"
  var pages: [String: Row] = [:]
  var versions: [String: Row] = [:]
  var commands: [(operation: String, input: JSONObject)] = []
  var offline = false

  func seed(_ id: String, title: String, blocks: [JSONValue], revision: Int) {
    pages[id] = ["id": .string(id), "title": .string(title), "folder_id": .null, "parent_page_id": .null, "content_json": .array(blocks),
                 "favorite": false, "status": "active", "created_at": "2026-11-01T00:00:00+00:00", "updated_at": "2026-11-01T00:00:00+00:00",
                 "last_opened_at": "2026-11-01T00:00:00+00:00", "archived_at": .null, "deleted_at": .null, "revision": .number(Double(revision))]
  }

  /// Another device saves a new revision, keeping the superseded one as a version.
  func foreignEdit(_ id: String, blocks: [JSONValue], title: String? = nil) {
    guard var row = pages[id], let revision = row["revision"]?.int else { return }
    versions["\(id)#\(revision)"] = ["note_id": .string(id), "revision": .number(Double(revision)), "title": row["title"]!, "content_json": row["content_json"]!, "created_at": "2026-11-01T00:00:00+00:00"]
    row["content_json"] = .array(blocks)
    if let title { row["title"] = .string(title) }
    row["revision"] = .number(Double(revision + 1))
    row["updated_at"] = .string("2026-11-02T00:00:0\(revision)+00:00")
    pages[id] = row
  }

  func rows(_ table: String, where filters: [RowFilter]) async throws -> [Row] {
    if offline { throw ManorConnectionError(operation: "Read", detail: "offline") }
    return try await serverRows(table, where: filters)
  }

  func serverRows(_ table: String, where filters: [RowFilter]) async throws -> [Row] {
    if offline { throw ManorConnectionError(operation: "Read", detail: "offline") }
    let source: [Row]
    switch table {
    case "note_pages": source = Array(pages.values)
    case "note_versions": source = Array(versions.values)
    default: source = []
    }
    return source.filter { row in filters.allSatisfy { row[$0.column] == $0.value } }
  }

  func command(_ operation: String, _ input: JSONObject, id: UUID) async throws -> CommandReceipt {
    if offline { throw ManorConnectionError(operation: operation, detail: "offline") }
    commands.append((operation, input))
    guard let noteId = input["id"]?.string else { throw ManorRequestError(operation: operation, code: "22023", detail: "id") }
    switch operation {
    case "update_note", "touch_note":
      guard var row = pages[noteId], let revision = row["revision"]?.int else { throw ManorRequestError(operation: operation, code: "P0001", detail: "Note is unavailable") }
      if operation == "touch_note" {
        row["last_opened_at"] = "2026-11-09T00:00:00+00:00"
      } else {
        guard input["expected_revision"]?.int == revision else { throw ManorRequestError(operation: operation, code: "PT409", detail: "Revision conflict") }
        versions["\(noteId)#\(revision)"] = ["note_id": .string(noteId), "revision": .number(Double(revision)), "title": row["title"]!, "content_json": row["content_json"]!, "created_at": "2026-11-01T00:00:00+00:00"]
        if let title = input["title"] { row["title"] = title }
        if let content = input["content_json"] { row["content_json"] = content }
        if let favorite = input["favorite"] { row["favorite"] = favorite }
        row["revision"] = .number(Double(revision + 1))
      }
      pages[noteId] = row
      return CommandReceipt(commandId: id, operation: operation, replayed: false, record: row, records: [], raw: .null)
    default:
      throw ManorRequestError(operation: operation, code: "P0001", detail: "Unsupported in the fake")
    }
  }
}

@Suite("Notes service")
@MainActor
struct NotesServiceTests {
  private func service(_ server: FakeNotesServer) throws -> NotesService {
    NotesService(transport: server, store: try NoteDraftStore())
  }

  @Test func savesAProtectedDraftAndAdoptsTheReceiptRevision() async throws {
    let server = FakeNotesServer()
    server.seed("n", title: "Plan", blocks: base, revision: 3)
    let notes = try service(server)
    let state = try await notes.load()
    #expect(state.pages.count == 1 && notes.knownRevision("n") == 3)
    var edited = base
    edited[1] = para("b", "second, edited")
    try await notes.protectDraft(NoteContent(id: "n", title: "Plan ", blocks: edited))
    let saved = try await notes.updatePage(NoteContent(id: "n", title: "Plan ", blocks: edited))
    #expect(saved.revision == 4 && notes.knownRevision("n") == 4)
    #expect(server.commands.last?.input["title"] == "Plan")
    #expect(server.commands.last?.input["expected_revision"] == 3)
    #expect(try await notes.pendingDrafts().isEmpty)
    // The echo of this save changes nothing this device does not already hold.
    #expect(try await notes.loadIfChanged() == nil)
  }

  @Test func rebasesOntoAForeignEditToAnotherBlockAndResends() async throws {
    let server = FakeNotesServer()
    server.seed("n", title: "Plan", blocks: base, revision: 1)
    let notes = try service(server)
    _ = try await notes.load()
    server.foreignEdit("n", blocks: [para("a", "first, from the agent"), para("b", "second"), para("c", "third")])
    var mine = base
    mine[2] = para("c", "third, mine")
    try await notes.protectDraft(NoteContent(id: "n", title: "Plan", blocks: mine))
    let saved = try await notes.updatePage(NoteContent(id: "n", title: "Plan", blocks: mine))
    #expect(saved.revision == 3)
    #expect(text(saved.content[0]) == "first, from the agent")
    #expect(text(saved.content[2]) == "third, mine")
    #expect(notes.hasConflict("n") == false)
    let ops = notes.takeMergedOps("n")
    #expect(ops == [.replace(id: "a", block: para("a", "first, from the agent"))])
    #expect(notes.takeMergedOps("n").isEmpty)
  }

  @Test func reportsARealConflictAndResolvesWithTheLocalDraft() async throws {
    let server = FakeNotesServer()
    server.seed("n", title: "Plan", blocks: base, revision: 1)
    let notes = try service(server)
    _ = try await notes.load()
    server.foreignEdit("n", blocks: [para("a", "theirs"), para("b", "second"), para("c", "third")])
    let mine = [para("a", "mine"), para("b", "second"), para("c", "third")]
    try await notes.protectDraft(NoteContent(id: "n", title: "Plan", blocks: mine))
    await #expect(throws: NoteConflictError.self) { try await notes.updatePage(NoteContent(id: "n", title: "Plan", blocks: mine)) }
    #expect(notes.hasConflict("n"))
    let conflict = try await notes.readConflict("n")
    #expect(text(conflict.current.content[0]) == "theirs" && text(conflict.local.blocks[0]) == "mine")
    let resolved = try await notes.resolveConflict(conflict)
    #expect(text(resolved.content[0]) == "mine" && resolved.revision == 3)
    #expect(notes.hasConflict("n") == false)
  }

  @Test func startsOfflineFromTheSnapshotWithDraftsOverlaid() async throws {
    let server = FakeNotesServer()
    server.seed("n", title: "Plan", blocks: base, revision: 2)
    let store = try NoteDraftStore()
    let first = NotesService(transport: server, store: store)
    _ = try await first.load()
    await first.flushSnapshot()
    try await first.protectDraft(NoteContent(id: "n", title: "Offline title", blocks: base))
    server.offline = true
    let second = NotesService(transport: server, store: store)
    let state = try await second.load()
    #expect(state.pages.first?.title == "Offline title")
    #expect(second.knownRevision("n") == 2)
    #expect(await second.prepareSignOut() != nil)
    server.offline = false
    _ = try await second.syncDrafts()
    #expect(await second.prepareSignOut() == nil)
    await #expect(throws: NotesService.SigningOut.self) { try await second.protectDraft(NoteContent(id: "n", title: "Late", blocks: base)) }
  }

  @Test func keepsTheNewerOpeningThisDeviceAlreadyHolds() async throws {
    let server = FakeNotesServer()
    server.seed("n", title: "Plan", blocks: base, revision: 2)
    let notes = try service(server)
    _ = try await notes.load()
    let touched = try await notes.touchPage("n")
    #expect(touched?.lastOpenedAt == "2026-11-09T00:00:00+00:00")
    // A stale read still carries the earlier opening; the device keeps its newer copy.
    var stale = server.pages["n"]!
    stale["last_opened_at"] = "2026-11-01T00:00:00+00:00"
    server.pages["n"] = stale
    let state = try await notes.load()
    #expect(state.pages.first?.lastOpenedAt == "2026-11-09T00:00:00+00:00")
  }
}
