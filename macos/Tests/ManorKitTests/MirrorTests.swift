import CryptoKit
import Foundation
import Synchronization
import Testing
@testable import ManorKit

// MARK: Helpers

private func change(_ cursor: Int, _ objectType: String, _ objectKey: Row, _ kind: FeedChange.Kind, _ revision: Int?) -> FeedChange {
  FeedChange(cursor: cursor, objectType: objectType, objectKey: objectKey, change: kind, revision: revision)
}

private func storedKey(_ table: String, _ objectKey: Row) throws -> String {
  let identity = try #require(try MirrorTables.identity(table, objectKey: objectKey))
  return try MirrorTables.key(table, identity: identity)
}

private func taskKey(_ id: String) throws -> String { try storedKey("tasks", ["id": .string(id)]) }

private let account = "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa"
private let otherAccount = "8c2e5f31-77b4-42d9-bb60-1a3d9e0c5f22"

/// A directory that deletes itself.
private final class TemporaryDirectory {
  let url: URL
  init() throws {
    url = FileManager.default.temporaryDirectory.appendingPathComponent("manor-mirror-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  }
  var file: URL { url.appendingPathComponent("\(account).sqlite") }
  deinit { try? FileManager.default.removeItem(at: url) }
}

private func gzip(_ data: Data) throws -> Data {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
  process.arguments = ["-c", "-n"]
  let input = Pipe()
  let output = Pipe()
  process.standardInput = input
  process.standardOutput = output
  try process.run()
  let writer = Thread { input.fileHandleForWriting.write(data); try? input.fileHandleForWriting.close() }
  writer.start()
  let compressed = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  return compressed
}

private func line(_ value: JSONValue) throws -> String { try MirrorJSON.text(value) }

// MARK: Pull plan

@Suite struct PullPlanTests {
  @Test func keepsTheLastChangeForARowAndReportsTheBatchCursor() throws {
    let batch = try PullPlan.group([
      change(4, "tasks", ["id": "task-1"], .insert, 1),
      change(5, "tasks", ["id": "task-1"], .update, 2),
      change(6, "tasks", ["id": "task-2"], .insert, 1),
      change(7, "tasks", ["id": "task-2"], .delete, nil)
    ], since: 3)
    let tasks = try #require(batch.tables["tasks"])
    #expect(batch.lastCursor == 7)
    let first = try #require(tasks.byKey[try taskKey("task-1")])
    #expect(first.action == .reread && first.revision == 2 && !first.recreated)
    #expect(tasks.byKey[try taskKey("task-2")]?.action == .remove)
  }

  @Test func rereadsARowDeletedAndRecreatedWithinOneBatch() throws {
    let batch = try PullPlan.group([change(1, "tasks", ["id": "task-1"], .delete, nil), change(2, "tasks", ["id": "task-1"], .insert, 1)], since: 0)
    let entry = try #require(batch.tables["tasks"]?.byKey[try taskKey("task-1")])
    #expect(entry.action == .reread && entry.recreated)
  }

  @Test func remembersTheRecreationThroughTheUpdatesThatFollowIt() throws {
    let key: Row = ["habit_id": "habit-1", "date": "2026-09-14"]
    let batch = try PullPlan.group([
      change(1, "habit_entries", key, .delete, nil), change(2, "habit_entries", key, .insert, 1), change(3, "habit_entries", key, .update, 2)
    ], since: 0)
    let entry = try #require(batch.tables["habit_entries"]?.byKey[try storedKey("habit_entries", key)])
    #expect(entry.revision == 2 && entry.recreated)
  }

  @Test func treatsAPurgeAsADelete() throws {
    let batch = try PullPlan.group([change(1, "kb_entries", ["id": "capture-1"], .purge, nil)], since: 0)
    #expect(batch.tables["kb_entries"]?.byKey["capture-1"]?.action == .remove)
  }

  @Test func namesTheTablesTheMirrorDoesNotHoldAndStillAdvancesTheCursor() throws {
    let batch = try PullPlan.group([
      change(9, "note_versions", ["note_id": "note-1", "revision": 3], .insert, 3),
      change(10, "purge_tombstones", ["object_type": "note", "object_id": "note-1"], .purge, nil)
    ], since: 8)
    #expect(batch.tables.isEmpty)
    #expect(batch.ignored == ["note_versions", "purge_tombstones"])
    #expect(batch.lastCursor == 10)
  }

  @Test func asksForAFullRefreshWhenTheFeedCannotNameTheRow() throws {
    let batch = try PullPlan.group([change(2, "profiles", ["revision": 5], .update, 5)], since: 1)
    #expect(batch.tables["profiles"]?.fullRefresh == true)
    #expect(batch.tables["profiles"]?.byKey.isEmpty == true)
  }

  @Test func refusesAFeedThatDoesNotAscend() {
    #expect(throws: MirrorError.self) { try PullPlan.group([change(4, "tasks", ["id": "task-1"], .insert, 1)], since: 4) }
  }

  private func sample() throws -> TableChanges {
    try #require(try PullPlan.group([
      change(1, "tasks", ["id": "fresh"], .update, 5),
      change(2, "tasks", ["id": "already-applied"], .update, 3),
      change(3, "tasks", ["id": "gone"], .delete, nil)
    ], since: 0).tables["tasks"])
  }

  @Test func skipsARowTheLocalCopyAlreadyHoldsAtThatRevision() throws {
    let plan = PullPlan.plan(try sample(), localRevisions: [try taskKey("fresh"): 4, try taskKey("already-applied"): 3])
    #expect(plan.lookups.map(\.key) == [try taskKey("fresh")])
    #expect(plan.removals == [try taskKey("gone")])
  }

  @Test func rereadsEverythingWhenTheLocalCopyHasNoRevisions() throws {
    let plan = PullPlan.plan(try sample(), localRevisions: [:])
    #expect(plan.lookups.map(\.key) == [try taskKey("fresh"), try taskKey("already-applied")])
  }

  @Test func rereadsATableWithoutRevisionsOnEveryChange() throws {
    let events = try #require(try PullPlan.group([change(1, "calendar_events", ["account_id": "a", "calendar_id": "c", "id": "e"], .update, nil)], since: 0).tables["calendar_events"])
    #expect(PullPlan.plan(events, localRevisions: [try storedKey("calendar_events", ["account_id": "a", "calendar_id": "c", "id": "e"]): 9]).lookups.count == 1)
  }

  @Test func rereadsARecreatedNaturalKeyRowEvenWhenTheLocalRevisionIsHigher() throws {
    let objectKey: Row = ["habit_id": "habit-1", "date": "2026-09-14"]
    let key = try storedKey("habit_entries", objectKey)
    let entries = try #require(try PullPlan.group([change(1, "habit_entries", objectKey, .delete, nil), change(2, "habit_entries", objectKey, .insert, 1)], since: 0).tables["habit_entries"])
    let plan = PullPlan.plan(entries, localRevisions: [key: 7])
    #expect(plan.lookups.map(\.key) == [key])
    #expect(plan.removals.isEmpty)
  }
}

// MARK: Tables and keys

@Suite struct MirrorTableTests {
  @Test func includeTheNotesRowsAPageReadsAndNotTheVersionHistory() {
    #expect(MirrorTables.isMirrored("note_folders") && MirrorTables.isMirrored("note_pages") && MirrorTables.isMirrored("note_suggestions"))
    #expect(!MirrorTables.isMirrored("note_versions"))
  }

  @Test func holdTheSharedCatalogApartFromTheAccountsOwnProblemRows() {
    #expect(MirrorTables.isMirrored("problem_catalog") && MirrorTables.isCatalogTable("problem_catalog"))
    #expect(!MirrorTables.isCatalogTable("leetcode_problems"))
    #expect(MirrorTables.isSharedTable("problem_catalog_content") && MirrorTables.isSharedTable("job_listings"))
    #expect(!MirrorTables.isSharedTable("problem_practice") && !MirrorTables.isSharedTable("problem_content_versions"))
    #expect(!MirrorTables.accountTables.contains("problem_catalog"))
    // The mirror's sharing rule and the gateway's agree, so a re-read and a page read scope rows alike.
    for table in MirrorTables.all { #expect(MirrorTables.isSharedTable(table) == ManorTables.isShared(table)) }
  }

  @Test func keyACatalogStatementByProblemAndACustomStatementByProblemAndVersion() throws {
    #expect(try MirrorTables.identity("problem_catalog_content", objectKey: ["problem_id": "two-sum"]) == ["problem_id": "two-sum"])
    #expect(try MirrorTables.rowKey("problem_content_versions", ["problem_id": "custom-1", "version": 2]) != MirrorTables.rowKey("problem_content_versions", ["problem_id": "custom-1", "version": 3]))
    #expect(try MirrorTables.rowKey("problem_content_versions", ["problem_id": "custom-1", "version": 2]) == "custom-1\u{1f}2")
    #expect(try MirrorTables.identity("problem_practice", objectKey: ["problem_id": "two-sum", "revision": 2]) == ["problem_id": "two-sum"])
  }

  @Test func markNotePagesAsChangingWithoutTheirRevisionMoving() {
    #expect(MirrorTables.touchedWithoutRevision("note_pages"))
    #expect(!MirrorTables.touchedWithoutRevision("tasks"))
  }

  @Test func joinCompositeKeysInColumnOrder() throws {
    let event: Row = ["account_id": "account-1", "calendar_id": "calendar-1", "id": "event-1", "title": "Standup"]
    var renamed = event
    renamed["title"] = "Renamed"
    var moved = event
    moved["calendar_id"] = "calendar-2"
    #expect(try MirrorTables.rowKey("calendar_events", event) == MirrorTables.rowKey("calendar_events", renamed))
    #expect(try MirrorTables.rowKey("calendar_events", event) != MirrorTables.rowKey("calendar_events", moved))
  }

  @Test func readTheKeyTheFeedReportsWhateverElseItCarries() throws {
    let identity = try #require(try MirrorTables.identity("habit_entries", objectKey: ["habit_id": "habit-1", "date": "2026-09-14", "revision": 4]))
    #expect(try MirrorTables.key("habit_entries", identity: identity) == MirrorTables.rowKey("habit_entries", ["habit_id": "habit-1", "date": "2026-09-14", "value": 1]))
  }

  @Test func refuseARowWhoseKeyColumnIsMissing() {
    #expect(throws: MirrorError.self) { try MirrorTables.rowKey("tasks", ["title": "No identity"]) }
  }

  @Test func returnNilWhenTheFeedDoesNotNameEveryKeyColumn() throws {
    #expect(try MirrorTables.identity("profiles", objectKey: ["revision": 7]) == nil)
    #expect(try MirrorTables.identity("calendars", objectKey: ["id": "calendar-1"]) == nil)
  }

  @Test func reportARevisionOnlyForTablesThatCarryOne() {
    #expect(MirrorTables.revision(of: ["id": "task-1", "revision": 3]) == 3)
    #expect(MirrorTables.revision(of: ["id": "event-1"]) == nil)
  }

  @Test func mirrorOnlyTheOpenPostingsOfTheSharedBoard() {
    #expect(MirrorTables.standingFilters("job_listings") == [RowFilter("active", true)])
    #expect(MirrorTables.standingFilters("tasks").isEmpty)
  }

  @Test func rebuildAMirrorThatWasNeverFilledOrComesFromAnotherHistory() {
    #expect(MirrorTables.needsRebuild(ready: false, cursor: 0, head: 0))
    #expect(MirrorTables.needsRebuild(ready: false, cursor: 12, head: 40))
    #expect(!MirrorTables.needsRebuild(ready: true, cursor: 12, head: 40))
    #expect(!MirrorTables.needsRebuild(ready: true, cursor: 40, head: 40))
    // The feed answers a cursor past the head with no rows, so pulling such a copy would never update it.
    #expect(MirrorTables.needsRebuild(ready: true, cursor: 41, head: 40))
    #expect(MirrorTables.needsRebuild(ready: true, cursor: 900, head: 0))
  }
}

@Suite struct MirrorRowsTests {
  @Test func sortByTheKeyColumnsTheServerOrdersOn() {
    let rows: [Row] = [
      ["account_id": "a2", "calendar_id": "c1", "id": "e1"], ["account_id": "a1", "calendar_id": "c2", "id": "e1"],
      ["account_id": "a1", "calendar_id": "c1", "id": "e2"], ["account_id": "a1", "calendar_id": "c1", "id": "e1"]
    ]
    let sorted = MirrorRows.select("calendar_events", rows, filters: []).map { [$0["account_id"]!, $0["calendar_id"]!, $0["id"]!] }
    #expect(sorted == [["a1", "c1", "e1"], ["a1", "c1", "e2"], ["a1", "c2", "e1"], ["a2", "c1", "e1"]])
  }

  @Test func applyEqualityFiltersTheWayTheServerDoes() {
    let listings: [Row] = [["id": "1", "active": true, "term": "Summer 2027"], ["id": "2", "active": false, "term": "Summer 2027"], ["id": "3", "active": true, "term": "Fall 2026"]]
    #expect(MirrorRows.select("job_listings", listings, filters: [RowFilter("active", true)]).map { $0.id } == ["1", "3"])
    #expect(MirrorRows.select("job_listings", listings, filters: [RowFilter("active", true), RowFilter("term", "Fall 2026")]).map { $0.id } == ["3"])
  }

  @Test func sortMissingValuesLastTheWayPostgresOrdersNulls() {
    let contexts: [Row] = [["name": nil, "id": "b"], ["name": "Study", "id": "a"]]
    #expect(MirrorRows.select("contexts", contexts, filters: []).map { $0.id } == ["a", "b"])
  }
}

// MARK: Identity reads and calendar windows

@Suite struct IdentityReadTests {
  private func lookups(_ table: String, _ keys: [Row]) throws -> [KeyedChange] {
    let changes = keys.enumerated().map { change($0.offset + 1, table, $0.element, .update, nil) }
    return PullPlan.plan(try #require(try PullPlan.group(changes, since: 0).tables[table]), localRevisions: [:]).lookups
  }

  @Test func asksForSingleColumnKeysInOneFilterPerBatch() throws {
    let batches = try IdentityReads.batches("tasks", try lookups("tasks", [["id": "a"], ["id": "b"], ["id": "c"]]), limits: .init(rows: 2, characters: 4_000))
    #expect(batches == [.in(column: "id", values: ["a", "b"]), .in(column: "id", values: ["c"])])
  }

  @Test func asksForCompositeKeysAsOneChainPerRow() throws {
    let batches = try IdentityReads.batches("habit_entries", try lookups("habit_entries", [["habit_id": "habit-1", "date": "2026-09-14"], ["habit_id": "habit-2", "date": "2026-09-15"]]))
    #expect(batches == [.or(expression: #"and(habit_id.eq."habit-1",date.eq."2026-09-14"),and(habit_id.eq."habit-2",date.eq."2026-09-15")"#)])
  }

  @Test func quotesIdentitiesThatHoldReservedCharacters() throws {
    let batches = try IdentityReads.batches("calendar_events", try lookups("calendar_events", [["account_id": "account-1", "calendar_id": "en.usa#holiday@group.v.calendar.google.com", "id": "event,1"]]))
    #expect(batches.first == .or(expression: #"and(account_id.eq."account-1",calendar_id.eq."en.usa#holiday@group.v.calendar.google.com",id.eq."event,1")"#))
  }

  @Test func splitsAnOrExpressionByItsRenderedLength() throws {
    let rows: [Row] = (0..<60).map { index in
      ["account_id": "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa", "calendar_id": "en.usa#holiday@group.v.calendar.google.com",
       "id": .string("_6tk3ecpm6ss3ab9m64rj4b9k6or3ab9pcgs3cb9h8gr30c1g60s30c1g60o30c1g" + String(format: "%04d", index))]
    }
    let batches = try IdentityReads.batches("calendar_events", try lookups("calendar_events", rows))
    #expect(batches.count > 1)
    var chains = 0
    for batch in batches {
      guard case .or(let expression) = batch else { Issue.record("a composite key renders as an or expression"); continue }
      #expect(expression.count <= IdentityReads.limits.characters)
      chains += expression.components(separatedBy: "),and(").count
    }
    #expect(chains == rows.count)
  }

  @Test func sendsAChainLongerThanTheCapOnItsOwn() throws {
    let batches = try IdentityReads.batches("calendar_events", try lookups("calendar_events", [
      ["account_id": "a", "calendar_id": "c", "id": .string(String(repeating: "x", count: 40))],
      ["account_id": "a", "calendar_id": "c", "id": .string(String(repeating: "y", count: 40))]
    ]), limits: .init(rows: 200, characters: 10))
    #expect(batches.count == 2)
  }

  @Test func refusesLimitsThatWouldSendNothing() throws {
    let one = try lookups("tasks", [["id": "a"]])
    #expect(throws: MirrorError.self) { try IdentityReads.batches("tasks", one, limits: .init(rows: 0, characters: 4_000)) }
    #expect(throws: MirrorError.self) { try IdentityReads.batches("tasks", one, limits: .init(rows: 200, characters: 0)) }
  }
}

@Suite struct CalendarWindowTests {
  let window = try! CalendarWindow(days: ["2026-09-14", "2026-09-15", "2026-09-16"])

  private func timed(_ startsAt: String, _ endsAt: String) -> Row {
    ["id": "event", "account_id": "account", "calendar_id": "calendar", "starts_at": .string(startsAt), "ends_at": .string(endsAt), "all_day": false]
  }

  private func allDay(_ start: String, _ end: String) -> Row {
    ["id": "event", "start_date": .string(start), "end_date": .string(end), "all_day": true]
  }

  @Test func widensTheInstantSpanByADayOnEachSide() {
    #expect(window.earliestText == "2026-09-13T00:00:00.000Z")
    #expect(window.latestText == "2026-09-18T00:00:00.000Z")
    #expect(window.serverFilter == "and(all_day.eq.true,start_date.lte.2026-09-16,end_date.gt.2026-09-14),and(all_day.eq.false,starts_at.lt.2026-09-18T00:00:00.000Z,ends_at.gt.2026-09-13T00:00:00.000Z)")
  }

  @Test func keepsTimedEventsThatOverlapWhateverTheirOffset() {
    #expect(window.contains(timed("2026-09-15T16:00:00+00:00", "2026-09-15T17:00:00+00:00")))
    #expect(window.contains(timed("2026-09-12T16:00:00-07:00", "2026-09-13T04:00:00+00:00")))
    #expect(window.contains(timed("2026-09-15T16:00:00.77538+00:00", "2026-09-15T17:00:00.5+00:00")))
    #expect(!window.contains(timed("2026-09-11T16:00:00Z", "2026-09-12T17:00:00Z")))
    #expect(!window.contains(timed("2026-09-18T16:00:00Z", "2026-09-18T17:00:00Z")))
  }

  @Test func comparesAllDayEventsByDateWithAnExclusiveEnd() {
    #expect(window.contains(allDay("2026-09-16", "2026-09-17")))
    #expect(window.contains(allDay("2026-09-10", "2026-09-15")))
    #expect(!window.contains(allDay("2026-09-10", "2026-09-14")))
    #expect(!window.contains(allDay("2026-09-17", "2026-09-18")))
    #expect(!window.contains(["id": "event", "all_day": false, "starts_at": nil, "ends_at": nil]))
  }
}

// MARK: Catalog rows and snapshots

@Suite struct CatalogRowTests {
  private let source = "https://github.com/snehasishroy/leetcode-companywise-interview-questions/tree/e095c259"

  private func report(_ company: String, _ window: String, _ date: String) -> JSONValue {
    ["window": .string(window), "company": .string(company), "frequency": 12.5, "sourceUrl": .string(source), "acceptance": 84.4, "snapshotDate": .string(date), "sourceRevision": "e095c259"]
  }

  private func stockRow(_ id: String, _ reports: [JSONValue]) -> Row {
    var metadata: Row = ["difficultySource": "official"]
    if !reports.isEmpty {
      metadata["companyReports"] = .array(reports)
      metadata["snapshots"] = [["revision": "e095c259", "sourceUrl": .string(source), "snapshotDate": "2026-07-12"]]
    }
    return ["id": .string(id), "kind": "coding", "name": "Matrix Diagonal Sum", "revision": 5, "user_id": nil, "source_metadata": .object(metadata), "content_available": true]
  }

  @Test func keepOnlyTheReportTheRecencyColumnShows() throws {
    let reports = [report("Amazon", "all", "2026-07-12"), report("Google", "6m", "2026-07-12"), report("Meta", "30d", "2026-04-01")]
    let row = stockRow("00125aac-8ac0-59f9-bb8e-0a3b2082fe5d", reports)
    let parts = try CatalogRows.split(row)
    #expect(parts.index.key == row.id)
    #expect(parts.index.revision == 5)
    // The newest snapshot wins, and within it the shorter window.
    #expect(parts.index.data["source_metadata"] == ["difficultySource": "official", "companyReports": [reports[1]]])
    #expect(parts.detail?.data == ["companyReports": .array(reports), "snapshots": row["source_metadata"]!["snapshots"]!])
    #expect(try CatalogRows.join(parts.index.data, detail: parts.detail?.data) == row)
  }

  @Test func needNoDetailRowWithoutSourceEvidence() throws {
    let row: Row = ["id": "00007abd", "revision": 3, "user_id": nil, "source_metadata": ["difficultySource": "official"]]
    #expect(try CatalogRows.split(row) == CatalogRows.Parts(index: MirrorRow(key: "00007abd", data: row, revision: 3), detail: nil))
    #expect(try CatalogRows.join(row, detail: nil) == row)
  }

  @Test func refuseToPresentTheSingleKeptReportAsTheWholeList() throws {
    let parts = try CatalogRows.split(stockRow("lost-detail", [report("Amazon", "all", "2026-07-12")]))
    #expect(throws: MirrorError.self) { try CatalogRows.join(parts.index.data, detail: nil) }
  }
}

@Suite struct CatalogSnapshotTests {
  let manifest = try! CatalogSnapshot.parseManifest([
    "schema": 1, "cursor": 4812, "path": "catalog/4812.ndjson.gz", "bytes": 1_204_331,
    "sha256": .string(String(repeating: "a", count: 64)), "problems": 2, "contents": 1, "createdAt": "2026-10-13T17:02:11.000Z"
  ])

  static let lines: [JSONValue] = [
    ["schema": 1, "cursor": 4812, "problems": 2, "contents": 1],
    ["type": "problem", "row": ["id": "neetcode-two-sum", "name": "Two Sum", "revision": 3]],
    ["type": "content", "row": ["problem_id": "neetcode-two-sum", "version": 1, "statement_markdown": "Given an array…\nReturn indices."]],
    ["type": "problem", "row": ["id": "b1f0c2de-0000-5000-8000-000000000001", "name": "Meta: Two Sum", "revision": 1]]
  ]

  private func text(_ values: [JSONValue]) throws -> String { try values.map(line).joined(separator: "\n") }

  private func readAll(_ text: String, chunk: Int, manifest: CatalogSnapshot.Manifest? = nil) throws -> (entries: [CatalogSnapshot.Entry], cursor: Int) {
    let manifest = manifest ?? self.manifest
    let bytes = Data(text.utf8)
    var progress = CatalogSnapshot.Progress()
    var entries: [CatalogSnapshot.Entry] = []
    var offset = 0
    while offset < bytes.count {
      entries += try CatalogSnapshot.readChunk(&progress, bytes.subdata(in: offset..<min(offset + chunk, bytes.count)), manifest)
      offset += chunk
    }
    let last = try CatalogSnapshot.finish(&progress, manifest)
    return (entries + last.entries, last.header.cursor)
  }

  @Test func readsTheSameRowsWhateverTheChunkBoundaries() throws {
    let whole = try readAll(try text(Self.lines) + "\n", chunk: 1_000_000)
    #expect(whole.cursor == 4812)
    #expect(whole.entries.map { "\($0.type.rawValue):\(($0.row["id"] ?? $0.row["problem_id"])?.string ?? "")" } == [
      "problem:neetcode-two-sum", "content:neetcode-two-sum", "problem:b1f0c2de-0000-5000-8000-000000000001"
    ])
    // Seven-byte chunks split lines, keys, multi-byte characters, and the escaped newline inside a statement.
    let split = try readAll(try text(Self.lines), chunk: 7)
    #expect(split.entries == whole.entries && split.cursor == whole.cursor)
  }

  @Test func readsARealGzipStream() throws {
    let compressed = try gzip(Data(try text(Self.lines).utf8))
    let inflater = GzipInflater(compressed, chunkSize: 16)
    var progress = CatalogSnapshot.Progress()
    var count = 0
    while let chunk = try inflater.next() { count += try CatalogSnapshot.readChunk(&progress, chunk, manifest).count }
    count += try CatalogSnapshot.finish(&progress, manifest).entries.count
    #expect(count == 3)
  }

  @Test func inflatesALargeFileAcrossManyChunks() throws {
    var payload = Data()
    for index in 0..<40_000 { payload.append(Data("line \(index) \(UUID().uuidString)\n".utf8)) }
    let compressed = try gzip(payload)
    #expect(try GzipInflater.inflate(compressed) == payload)
    let inflater = GzipInflater(compressed, chunkSize: 4_096)
    var output = Data()
    while let chunk = try inflater.next() { output.append(chunk) }
    #expect(output == payload)
    // A second member's trailer does not describe the first member, so a concatenated file is refused, not half read.
    #expect(throws: MirrorError.self) { try GzipInflater.inflate(compressed + (try gzip(Data("tail\n".utf8)))) }
  }

  @Test func refusesADamagedOrTruncatedGzipFile() throws {
    var compressed = try gzip(Data(String(repeating: "Manor mirror\n", count: 500).utf8))
    let truncated = compressed.prefix(compressed.count - 6)
    #expect(throws: MirrorError.self) { try GzipInflater.inflate(truncated) }
    compressed[compressed.count - 8] ^= 0xFF
    #expect(throws: MirrorError.self) { try GzipInflater.inflate(compressed) }
    #expect(throws: MirrorError.self) { try GzipInflater.inflate(Data("not gzip".utf8)) }
  }

  @Test func checksTheBytesAgainstTheManifest() throws {
    let data = Data("snapshot".utf8)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let good = try CatalogSnapshot.parseManifest(["schema": 1, "cursor": 1, "path": "catalog/1.ndjson.gz", "bytes": .number(Double(data.count)), "sha256": .string(digest), "problems": 0, "contents": 0, "createdAt": "2026-10-13T17:02:11+00:00"])
    try CatalogSnapshot.verify(data, against: good)
    #expect(throws: MirrorError.self) { try CatalogSnapshot.verify(data + Data([0]), against: good) }
    var flipped = data
    flipped[0] ^= 1
    #expect(throws: MirrorError.self) { try CatalogSnapshot.verify(flipped, against: good) }
  }

  @Test func refusesASnapshotThatIsShortPaddedOrNotTheOneItsManifestNames() throws {
    #expect(throws: MirrorError("The catalog snapshot holds 1 problems and 1 statements but its header promises 2 and 1")) {
      try readAll(try text(Array(Self.lines.prefix(3))), chunk: 64)
    }
    #expect(throws: MirrorError.self) { try readAll(try text(Self.lines + [Self.lines[1]]), chunk: 64) }
    let otherCursor: [JSONValue] = [["schema": 1, "cursor": 4811, "problems": 2, "contents": 1]] + Self.lines.dropFirst()
    #expect(throws: MirrorError.self) { try readAll(try text(otherCursor), chunk: 64) }
    #expect(throws: MirrorError("The catalog snapshot is empty; it has no header line")) { try readAll("", chunk: 64) }
  }

  @Test func namesTheLineThatIsNotARow() throws {
    let header = try line(Self.lines[0])
    #expect(throws: MirrorError("Catalog snapshot line 2 is not a problem or statement row")) { try readAll(header + "\n{\"type\":\"problem\",\"row\":[1]}", chunk: 64) }
    #expect { try readAll(header + "\n{\"type\":\"problem\",", chunk: 64) } throws: { ($0 as? MirrorError)?.message.hasPrefix("Catalog snapshot line 2 is not JSON") == true }
    #expect(throws: MirrorError("Catalog snapshot line 2 is not a problem or statement row")) { try readAll(header + "\n" + (try line(["type": "testset", "row": [:]])), chunk: 64) }
  }

  @Test func refusesAManifestThatDoesNotNameASnapshotItCanCheck() throws {
    var object = [
      "schema": 1, "cursor": 4812, "path": "catalog/4812.ndjson.gz", "bytes": 1_204_331,
      "sha256": .string(String(repeating: "a", count: 64)), "problems": 2, "contents": 1, "createdAt": "2026-10-13T17:02:11.000Z"
    ] as Row
    object["sha256"] = "not-a-digest"
    #expect(throws: MirrorError.self) { try CatalogSnapshot.parseManifest(.object(object)) }
    object["sha256"] = .string(String(repeating: "a", count: 64))
    object["path"] = "../4812.ndjson.gz"
    #expect(throws: MirrorError.self) { try CatalogSnapshot.parseManifest(.object(object)) }
  }

  @Test func walksTheFeedWhileACompleteCopyIsCloseToTheHead() {
    #expect(!CatalogSnapshot.needsManifest(ready: true, cursor: 900, head: 900 + CatalogSnapshot.snapshotGap))
    #expect(CatalogSnapshot.plan(ready: true, cursor: 900, head: 900 + CatalogSnapshot.snapshotGap, manifestCursor: nil) == .feed)
  }

  @Test func loadsANewerSnapshotWhenFarBehindAndWalksTheFeedWhenNoneIsNewer() {
    let head = 900 + CatalogSnapshot.snapshotGap + 1
    #expect(CatalogSnapshot.needsManifest(ready: true, cursor: 900, head: head))
    #expect(CatalogSnapshot.plan(ready: true, cursor: 900, head: head, manifestCursor: head - 10) == .snapshot)
    #expect(CatalogSnapshot.plan(ready: true, cursor: 900, head: head, manifestCursor: 900) == .feed)
    #expect(CatalogSnapshot.plan(ready: true, cursor: 900, head: head, manifestCursor: nil) == .feed)
  }

  @Test func fillsAnEmptyCopyFromTheSnapshotOrTheTables() {
    #expect(CatalogSnapshot.needsManifest(ready: false, cursor: 0, head: 0))
    #expect(CatalogSnapshot.plan(ready: false, cursor: 0, head: 12_000, manifestCursor: 11_800) == .snapshot)
    #expect(CatalogSnapshot.plan(ready: false, cursor: 0, head: 12_000, manifestCursor: nil) == .tables)
  }

  @Test func rebuildsACopyFromAHistoryTheServerNoLongerHas() {
    #expect(CatalogSnapshot.needsManifest(ready: true, cursor: 20_000, head: 12_000))
    #expect(CatalogSnapshot.plan(ready: true, cursor: 20_000, head: 12_000, manifestCursor: 11_800) == .snapshot)
    #expect(CatalogSnapshot.plan(ready: true, cursor: 20_000, head: 12_000, manifestCursor: nil) == .tables)
  }
}

// MARK: Store

@Suite struct MirrorStoreTests {
  private func row(_ key: String, _ data: Row, _ revision: Int?) -> MirrorRow { MirrorRow(key: key, data: data, revision: revision) }

  @Test func aNewFileReportsAnEmptyCopy() throws {
    let directory = try TemporaryDirectory()
    let (_, status) = try MirrorStore.open(at: directory.file, accountId: account)
    #expect(status == MirrorStatus(ready: false, cursor: 0, catalogReady: false, catalogCursor: 0, rowCounts: [:]))
  }

  @Test func aReplacedTableReadsBackInKeyOrderAndReplacesWhatWasThere() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("tasks", rows: [row("old", ["id": "old"], 1)])
    try await store.replaceTable("tasks", rows: [row("b", ["id": "b", "title": "Second"], 2), row("a", ["id": "a", "title": "First", "done": false, "score": 1.5, "tags": ["x"]], 1)])
    try await store.replaceTable("contexts", rows: [row("ctx", ["id": "ctx"], nil)])
    let stored = try await store.mirrorRows("tasks")
    #expect(stored.map(\.key) == ["a", "b"])
    #expect(stored[0].data == ["id": "a", "title": "First", "done": false, "score": 1.5, "tags": ["x"]])
    #expect(try await store.status().rowCounts == ["tasks": 2, "contexts": 1])
  }

  @Test func anUpsertedRowOverwritesItsDataAndRevision() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("tasks", rows: [row("a", ["id": "a", "title": "Draft"], 1)])
    try await store.upsertRows("tasks", rows: [row("a", ["id": "a", "title": "Final"], 2), row("c", ["id": "c"], 1)])
    #expect(try await store.row("tasks", key: "a") == row("a", ["id": "a", "title": "Final"], 2))
    #expect(try await store.revisions("tasks") == ["a": 2, "c": 1])
  }

  @Test func deletingRemovesOnlyTheNamedKeysOfThatTable() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("tasks", rows: [row("a", ["id": "a"], 1), row("b", ["id": "b"], 1)])
    try await store.replaceTable("habits", rows: [row("a", ["id": "a"], 1)])
    try await store.deleteRows("tasks", keys: ["a", "never-held"])
    #expect(try await store.mirrorRows("tasks").map(\.key) == ["b"])
    #expect(try await store.mirrorRows("habits").map(\.key) == ["a"])
    #expect(try await store.row("tasks", key: "a") == nil)
  }

  @Test func revisionsReadBackEveryKeyIncludingTablesWithoutThem() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("calendar_events", rows: [row("e1", ["id": "e1"], nil)])
    let revisions = try await store.revisions("calendar_events")
    #expect(revisions.keys.sorted() == ["e1"])
    #expect(revisions["e1"] == .some(nil))
  }

  @Test func filtersRunOnStoredJSONWithStrictEquality() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("note_pages", rows: [
      row("1", ["id": "1", "folder_id": "f1", "archived": false, "position": 2], 1),
      row("2", ["id": "2", "folder_id": "f2", "archived": true, "position": 2.5], 1),
      row("3", ["id": "3", "folder_id": nil, "archived": false, "position": 1], 1),
      row("4", ["id": "4", "archived": "false", "position": "2"], 1)
    ])
    func ids(_ filters: [RowFilter]) async throws -> [String] { try await store.rows("note_pages", filters: filters).compactMap { $0.id }.sorted() }
    #expect(try await ids([RowFilter("folder_id", "f1")]) == ["1"])
    #expect(try await ids([RowFilter("archived", false)]) == ["1", "3"])
    #expect(try await ids([RowFilter("archived", "false")]) == ["4"])
    #expect(try await ids([RowFilter("position", 2)]) == ["1"])
    #expect(try await ids([RowFilter("position", 2.5)]) == ["2"])
    // A null filter matches a stored null, never a missing column, as the page-side comparison does.
    #expect(try await ids([RowFilter("folder_id", nil)]) == ["3"])
    #expect(try await ids([RowFilter("archived", false), RowFilter("position", 1)]) == ["3"])
    #expect(try await ids([RowFilter("Bad Column", 1)]) == [])
  }

  @Test func theCatalogCursorIsRecordedApartFromTheAccountCursor() async throws {
    let directory = try TemporaryDirectory()
    do {
      let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
      try await store.commit(cursor: 12, ready: true)
      try await store.commitCatalog(cursor: 4_294_967_296, ready: true)
      let status = try await store.status()
      #expect(status.ready && status.cursor == 12 && status.catalogReady && status.catalogCursor == 4_294_967_296)
      // A snapshot that starts over marks the catalog incomplete without touching the account copy.
      try await store.commitCatalog(cursor: 4_294_967_296, ready: false)
      store.close()
    }
    let (_, reopened) = try MirrorStore.open(at: directory.file, accountId: account)
    #expect(reopened.ready && reopened.cursor == 12 && !reopened.catalogReady && reopened.catalogCursor == 4_294_967_296)
  }

  @Test func aReopenedFileReportsItsCursorAndRows() async throws {
    let directory = try TemporaryDirectory()
    do {
      let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
      try await store.replaceTable("tasks", rows: [row("a", ["id": "a"], 1)])
      try await store.commit(cursor: 40, ready: true)
      store.close()
    }
    let (_, status) = try MirrorStore.open(at: directory.file, accountId: account)
    #expect(status == MirrorStatus(ready: true, cursor: 40, catalogReady: false, catalogCursor: 0, rowCounts: ["tasks": 1]))
  }

  @Test func anotherSchemaVersionOrAccountEmptiesTheCopy() async throws {
    let directory = try TemporaryDirectory()
    do {
      let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
      try await store.replaceTable("leetcode_problems", rows: [row("neetcode-two-sum", ["name": "Two Sum"], 3)])
      try await store.commit(cursor: 40, ready: true)
      try await store.commitCatalog(cursor: 7, ready: true)
      try await store.putDerived("manor_habits_state", value: ["solved": 41], cursor: 40, day: "2026-09-14")
      store.close()
    }
    let (_, other) = try MirrorStore.open(at: directory.file, accountId: otherAccount)
    #expect(other == MirrorStatus(ready: false, cursor: 0, catalogReady: false, catalogCursor: 0, rowCounts: [:]))

    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("tasks", rows: [row("a", ["id": "a"], 1)])
    try await store.commit(cursor: 9, ready: true)
    store.close()
    // A file written under the previous table set would stay ready while missing tables, so it is emptied.
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    process.arguments = [directory.file.path, "update meta set value = '5' where key = 'schema_version'"]
    try process.run()
    process.waitUntilExit()
    let (reopened, status) = try MirrorStore.open(at: directory.file, accountId: account)
    #expect(MirrorStore.schemaVersion == 6)
    #expect(status == MirrorStatus(ready: false, cursor: 0, catalogReady: false, catalogCursor: 0, rowCounts: [:]))
    #expect(try await reopened.derived("manor_habits_state") == nil)
  }

  @Test func aDerivedValueReadsBackWithItsCursorAndDayAndCanBeDropped() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.putDerived("manor_habits_state", value: ["solved": 41, "streak": ["days": 3]], cursor: 18, day: "2026-09-14")
    try await store.putDerived("manor_habits_state", value: ["solved": 42], cursor: 19, day: "2026-09-15")
    #expect(try await store.derived("manor_habits_state") == MirrorDerived(value: ["solved": 42], cursor: 19, day: "2026-09-15"))
    try await store.deleteDerived("manor_habits_state")
    #expect(try await store.derived("manor_habits_state") == nil)
    try await store.deleteDerived("manor_habits_state")
  }

  @Test func wipingDeletesTheFileAndItsCompanions() async throws {
    let directory = try TemporaryDirectory()
    let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
    try await store.replaceTable("tasks", rows: [row("a", ["id": "a"], 1)])
    try store.wipe()
    for suffix in ["", "-wal", "-shm"] { #expect(!FileManager.default.fileExists(atPath: directory.file.path + suffix)) }
  }

  @Test func acceptsOnlyACanonicalAccountId() {
    #expect(MirrorFiles.isAccountId(account))
    for supplied in ["", "0f4b1d2a6c384a1e9d772b5c8e4f10aa", "0F4B1D2A-6C38-4A1E-9D77-2B5C8E4F10AA", "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10a", "../../etc/passwd", "0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10a/"] {
      #expect(!MirrorFiles.isAccountId(supplied))
    }
  }

  @Test func sweepsOnlyTheFilesOfOtherAccounts() throws {
    for name in ["\(otherAccount).sqlite", "\(otherAccount).sqlite-wal", "\(otherAccount).sqlite-shm"] {
      #expect(MirrorFiles.belongsToAnotherAccount(name, accountId: account))
    }
    for name in ["\(account).sqlite", "\(account).sqlite-wal", "\(account).sqlite-shm", "notes.json", "sqlite"] {
      #expect(!MirrorFiles.belongsToAnotherAccount(name, accountId: account))
    }
    let directory = try TemporaryDirectory()
    for name in ["\(otherAccount).sqlite", "\(account).sqlite", "notes.json"] {
      FileManager.default.createFile(atPath: directory.url.appendingPathComponent(name).path, contents: Data())
    }
    MirrorFiles.sweep(directory.url, keeping: account)
    #expect(try FileManager.default.contentsOfDirectory(atPath: directory.url.path).sorted() == ["\(account).sqlite", "notes.json"])
  }
}

// MARK: Sync passes against a scripted server

/// A server the tests script: tables as they stand, a feed, and Storage objects.
private final class FakeRemote: MirrorRemote, @unchecked Sendable {
  struct State {
    var tables: [String: [Row]] = [:]
    var feeds: [String: [FeedChange]] = [:]
    var objects: [String: Data] = [:]
    var identityReads: [String: Int] = [:]
    var offline = false
  }
  let state = Mutex(State())

  func set(_ table: String, _ rows: [Row]) { state.withLock { $0.tables[table] = rows } }
  func append(_ feed: FeedFunctions, _ change: FeedChange) { state.withLock { $0.feeds[feed.changes, default: []].append(change) } }

  private func checkOnline() throws {
    if state.withLock({ $0.offline }) { throw ManorConnectionError(operation: "test", detail: "offline") }
  }

  func feedCursor(_ feed: FeedFunctions) async throws -> Int {
    try checkOnline()
    return state.withLock { $0.feeds[feed.changes]?.last?.cursor ?? 0 }
  }

  func feedChanges(_ feed: FeedFunctions, since: Int, limit: Int) async throws -> [FeedChange] {
    try checkOnline()
    return state.withLock { Array(($0.feeds[feed.changes] ?? []).filter { $0.cursor > since }.prefix(limit)) }
  }

  func readTable(_ table: String, filters: [RowFilter]) async throws -> [Row] {
    try checkOnline()
    return state.withLock { ($0.tables[table] ?? []).filter { row in filters.allSatisfy { MirrorRows.matches(row, $0) } } }
  }

  func readIdentities(_ table: String, lookups: [KeyedChange]) async throws -> [Row] {
    try checkOnline()
    let keys = Set(lookups.map(\.key))
    return state.withLock { state in
      state.identityReads[table, default: 0] += lookups.count
      return (state.tables[table] ?? []).filter { keys.contains((try? MirrorTables.rowKey(table, $0)) ?? "") }
    }
  }

  func download(bucket: String, path: String) async throws -> Data? {
    try checkOnline()
    return state.withLock { $0.objects[path] }
  }
}

private final class Published: @unchecked Sendable {
  let tables = Mutex<[Set<String>]>([])
  var all: Set<String> { tables.withLock { $0.reduce(into: Set<String>()) { $0.formUnion($1) } } }
  func clear() { tables.withLock { $0 = [] } }
}

@Suite struct MirrorSyncTests {
  private func make(_ remote: FakeRemote, _ directory: TemporaryDirectory) throws -> (MirrorSync, Published) {
    let (store, status) = try MirrorStore.open(at: directory.file, accountId: account)
    let published = Published()
    let mirror = MirrorSync(accountId: account, store: store, status: status, remote: remote, client: nil,
                            publish: { tables in published.tables.withLock { $0.append(tables) } }, isIssued: { _ in false })
    return (mirror, published)
  }

  @Test func bootstrapFillsEveryTableThenTheFeedKeepsItCurrent() async throws {
    let remote = FakeRemote()
    remote.set("tasks", [["id": "t1", "title": "Write", "revision": 1], ["id": "t2", "title": "Read", "revision": 1]])
    remote.set("job_listings", [["id": "l1", "active": true], ["id": "l2", "active": false]])
    remote.set("profiles", [["user_id": .string(account), "name": "Ada", "revision": 1]])
    remote.append(.workspace, change(5, "tasks", ["id": "t2"], .insert, 1))
    let directory = try TemporaryDirectory()
    let (mirror, published) = try make(remote, directory)

    #expect(await !mirror.isServing("tasks"))
    #expect(try await mirror.rows("tasks", filters: []) == nil)
    await mirror.account.pull()
    #expect(await mirror.isServing("tasks"))
    #expect(try await mirror.store.status().cursor == 5)
    #expect(try await mirror.rows("tasks", filters: [])?.map { $0.id } == ["t1", "t2"])
    // The copy holds only open postings, whatever a page asks for.
    #expect(try await mirror.rows("job_listings", filters: [])?.map { $0.id } == ["l1"])
    #expect(published.all.contains("tasks"))
    // The catalog is not served until its own copy is complete.
    #expect(await !mirror.isServing("problem_catalog"))

    // Another device renames one task, deletes the other, and adds a third.
    published.clear()
    remote.set("tasks", [["id": "t1", "title": "Write well", "revision": 2], ["id": "t3", "title": "New", "revision": 1]])
    remote.append(.workspace, change(6, "tasks", ["id": "t1"], .update, 2))
    remote.append(.workspace, change(7, "tasks", ["id": "t2"], .delete, nil))
    remote.append(.workspace, change(8, "tasks", ["id": "t3"], .insert, 1))
    remote.append(.workspace, change(9, "note_versions", ["note_id": "n1", "revision": 2], .insert, 2))
    await mirror.afterCommand()
    #expect(try await mirror.rows("tasks", filters: [])?.map { $0["title"]?.string } == ["Write well", "New"])
    #expect(try await mirror.store.status().cursor == 9)
    #expect(published.all == ["tasks", "note_versions"])

    // A row this device already holds at the feed's revision is not re-read.
    let before = remote.state.withLock { $0.identityReads["tasks"] ?? 0 }
    remote.append(.workspace, change(10, "tasks", ["id": "t3"], .update, 1))
    await mirror.account.pull()
    #expect(remote.state.withLock { $0.identityReads["tasks"] ?? 0 } == before)
    #expect(try await mirror.store.status().cursor == 10)
    await mirror.stop()
  }

  @Test func aJobRoleChangeRepullsItsStageTransitions() async throws {
    let remote = FakeRemote()
    remote.set("job_roles", [["id": "r1", "revision": 1]])
    let directory = try TemporaryDirectory()
    let (mirror, published) = try make(remote, directory)
    await mirror.account.pull()
    published.clear()
    remote.set("job_roles", [["id": "r1", "stage": "offer", "revision": 2]])
    remote.set("job_stage_transitions", [["id": "s1", "role_id": "r1"]])
    remote.append(.workspace, change(1, "job_roles", ["id": "r1"], .update, 2))
    await mirror.account.pull()
    #expect(try await mirror.rows("job_stage_transitions", filters: [])?.map { $0.id } == ["s1"])
    #expect(published.all == ["job_roles", "job_stage_transitions"])
    await mirror.stop()
  }

  @Test func aCopyFromAnotherHistoryIsRebuiltAndOfflineKeepsServing() async throws {
    let remote = FakeRemote()
    remote.set("tasks", [["id": "fresh", "revision": 1]])
    remote.append(.workspace, change(3, "tasks", ["id": "fresh"], .insert, 1))
    let directory = try TemporaryDirectory()
    do {
      let (store, _) = try MirrorStore.open(at: directory.file, accountId: account)
      try await store.replaceTable("tasks", rows: [MirrorRow(key: "stale", data: ["id": "stale"], revision: 1)])
      try await store.commit(cursor: 900, ready: true)
      store.close()
    }
    let (mirror, _) = try make(remote, directory)
    // A ready file serves from the start, before any pull.
    #expect(await mirror.isServing("tasks"))
    await mirror.account.pull()
    #expect(try await mirror.rows("tasks", filters: [])?.map { $0.id } == ["fresh"])
    #expect(try await mirror.store.status().cursor == 3)

    remote.state.withLock { $0.offline = true }
    await mirror.account.pull()
    #expect(await mirror.isServing("tasks"))
    await mirror.stop()
    #expect(await !mirror.isServing("tasks"))
    #expect(try await mirror.rows("tasks", filters: []) == nil)
  }

  @Test func theDerivedCacheFollowsTheCursorAndTheDay() async throws {
    let remote = FakeRemote()
    let directory = try TemporaryDirectory()
    let (mirror, _) = try make(remote, directory)
    let loads = Mutex(0)
    let load: @Sendable () async throws -> JSONValue = { .number(Double(loads.withLock { $0 += 1; return $0 })) }
    // Not serving yet: every read goes to the server.
    #expect(try await mirror.derived("manor_habits_state", day: "2026-09-14", load: load) == 1)
    await mirror.account.pull()
    #expect(try await mirror.derived("manor_habits_state", day: "2026-09-14", load: load) == 2)
    #expect(try await mirror.derived("manor_habits_state", day: "2026-09-14", load: load) == 2)
    #expect(try await mirror.derived("manor_habits_state", day: "2026-09-15", load: load) == 3)
    remote.set("habits", [["id": "h1", "revision": 1]])
    remote.append(.workspace, change(1, "habits", ["id": "h1"], .insert, 1))
    await mirror.account.pull()
    #expect(try await mirror.derived("manor_habits_state", day: "2026-09-15", load: load) == 4)
    await mirror.stop()
  }

  @Test func theCatalogFillsFromItsSnapshotAndFollowsItsFeed() async throws {
    let remote = FakeRemote()
    let problem: Row = [
      "id": "p1", "name": "Two Sum", "revision": 1, "user_id": nil, "content_available": true,
      "source_metadata": ["companyReports": [["company": "Meta", "window": "30d", "snapshotDate": "2026-07-12"], ["company": "Apple", "window": "all", "snapshotDate": "2026-07-12"]]]
    ]
    let lines: [JSONValue] = [
      ["schema": 1, "cursor": 40, "problems": 2, "contents": 1],
      ["type": "problem", "row": .object(problem)],
      ["type": "problem", "row": ["id": "p2", "name": "Gone soon", "revision": 1, "user_id": nil]],
      ["type": "content", "row": ["problem_id": "p1", "version": 1, "statement_markdown": "Find two numbers."]]
    ]
    let snapshot = try gzip(Data(try lines.map(line).joined(separator: "\n").utf8))
    let digest = SHA256.hash(data: snapshot).map { String(format: "%02x", $0) }.joined()
    let manifest: JSONValue = ["schema": 1, "cursor": 40, "path": "catalog/40.ndjson.gz", "bytes": .number(Double(snapshot.count)), "sha256": .string(digest), "problems": 2, "contents": 1, "createdAt": "2026-10-13T17:02:11.000Z"]
    remote.state.withLock {
      $0.objects["catalog/manifest.json"] = Data(try! MirrorJSON.text(manifest).utf8)
      $0.objects["catalog/40.ndjson.gz"] = snapshot
    }
    remote.append(.catalog, change(41, "problem_catalog", ["id": "p2"], .delete, nil))
    let directory = try TemporaryDirectory()
    let (mirror, published) = try make(remote, directory)
    await mirror.catalog.pull()
    #expect(await mirror.isServing("problem_catalog"))
    #expect(await mirror.isServing(MirrorTables.catalogDetailTable))
    #expect(try await mirror.store.status().catalogCursor == 41)
    #expect(try await mirror.rows("problem_catalog", filters: [])?.map { $0.id } == ["p1"])
    let index = try #require(try await mirror.rows("problem_catalog", filters: [])?.first)
    #expect(index["source_metadata"]?["companyReports"]?.array?.count == 1)
    guard case .row(let detail?) = try await mirror.row(MirrorTables.catalogDetailTable, key: "p1") else { Issue.record("the detail row is stored"); return }
    #expect(try CatalogRows.join(index, detail: detail) == problem)
    guard case .row(let content?) = try await mirror.row("problem_catalog_content", key: "p1") else { Issue.record("the statement is stored"); return }
    #expect(content["statement_markdown"] == "Find two numbers.")
    #expect(published.all.isSuperset(of: ["problem_catalog", "problem_catalog_content"]))
    // The account copy is a separate matter.
    #expect(await !mirror.isServing("tasks"))
    await mirror.stop()
  }

  @Test func aCatalogSnapshotThatFailsItsChecksIsNotServed() async throws {
    let remote = FakeRemote()
    let snapshot = try gzip(Data(#"{"schema":1,"cursor":1,"problems":0,"contents":0}"#.utf8))
    let manifest: JSONValue = ["schema": 1, "cursor": 1, "path": "catalog/1.ndjson.gz", "bytes": .number(Double(snapshot.count)), "sha256": .string(String(repeating: "0", count: 64)), "problems": 0, "contents": 0, "createdAt": "2026-10-13T17:02:11Z"]
    remote.state.withLock {
      $0.objects["catalog/manifest.json"] = Data(try! MirrorJSON.text(manifest).utf8)
      $0.objects["catalog/1.ndjson.gz"] = snapshot
    }
    let directory = try TemporaryDirectory()
    let (mirror, _) = try make(remote, directory)
    await mirror.catalog.pull()
    #expect(await !mirror.isServing("problem_catalog"))
    #expect(try await mirror.store.status().catalogReady == false)
    await mirror.stop()
  }

  @Test func pokesThatArriveDuringAPullCollapseIntoOneFollowUp() async throws {
    let remote = FakeRemote()
    remote.set("tasks", [["id": "t1", "revision": 1]])
    let directory = try TemporaryDirectory()
    let (mirror, _) = try make(remote, directory)
    await withTaskGroup(of: Void.self) { group in
      for _ in 0..<20 { group.addTask { await mirror.account.pull() } }
    }
    #expect(await mirror.isServing("tasks"))
    #expect(try await mirror.rows("tasks", filters: [RowFilter("id", "t1")])?.count == 1)
    await mirror.stop()
  }
}
