import Foundation
import Testing
@testable import ManorKit

private let canonical = ProblemRecord(
  id: "main", name: "Add two integers", difficulty: .easy, kind: .coding, topics: ["Math"], companies: ["First company"],
  collections: ["Practice"], sourceUrl: "https://example.com/main", sourceType: .imported, externalKey: "main-source",
  sourceMetadata: ProblemSourceMetadata(lastAsked: ProblemSourceDate(value: "2026-10-01", precision: .day), reportCount: 3),
  sourceName: "Original sum title", contentAvailable: true, contentVersion: 2, revision: 4,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z"
)

private var alias: ProblemRecord {
  var record = canonical
  record.id = "retained"
  record.name = "Another source sum title"
  record.sourceName = "Earlier addition question"
  record.canonicalProblemId = "main"
  record.topics = ["Arithmetic"]
  record.companies = ["Second company"]
  record.tags = ["Reviewed"]
  record.collections = ["Interview"]
  record.contentVersion = 1
  record.sourceMetadata = ProblemSourceMetadata(
    lastAsked: ProblemSourceDate(value: "2026-09", precision: .month), reportCount: 2,
    snapshots: [ProblemSourceSnapshot(sourceUrl: "https://example.com/retained", snapshotDate: "2026-09-19")]
  )
  return record
}

private func solo(_ id: String, _ name: String, _ type: ProblemSourceType, _ key: String) -> ProblemRecord {
  var record = canonical
  record.id = id
  record.name = name
  record.sourceName = nil
  record.sourceType = type
  record.externalKey = key
  return record
}

@Suite("Problem groups")
struct ProblemGroupTests {
  @Test func projectsOneCanonicalRowWithUnionLabelsAndEvidence() throws {
    let groups = try ProblemGrouping.groups([canonical, alias])
    #expect(groups.count == 1)
    #expect(groups[0].sources.map(\.id) == ["main", "retained"])
    #expect(groups[0].problem.companies == ["First company", "Second company"])
    #expect(groups[0].problem.topics == ["Arithmetic", "Math"])
    let metadata = try #require(groups[0].problem.sourceMetadata)
    #expect(metadata.lastAsked == canonical.sourceMetadata?.lastAsked)
    #expect(metadata.reportCount == 3)
    #expect(metadata.snapshots == alias.sourceMetadata?.snapshots)
    #expect(groups[0].sources[1] == alias)
  }

  @Test func matchesAnOlderSourceDateAliasTitleAndAliasLabels() throws {
    let groups = try ProblemGrouping.groups([canonical, alias])
    var filters = ProblemFilters()
    filters.search = "Earlier addition"
    filters.companies = ["Second company"]
    filters.lastAskedSince = "2026-09-15"
    filters.lastAskedUntil = "2026-09-20"
    #expect(ProblemFiltering.filter(groups, filters, [ProblemSort(.lastAsked, .desc)]).map(\.id) == ["main"])
    filters.lastAskedSince = "2026-08-01"
    filters.lastAskedUntil = "2026-08-31"
    #expect(ProblemFiltering.filter(groups, filters, [ProblemSort(.name)]).isEmpty)
    let index = ProblemLibraryIndex(groups: groups)
    #expect(index.query(ProblemQuery(filters: filters)).matches == 0)
  }

  @Test func ordersSearchByRelevanceAndFindsALeetCodeNumber() throws {
    let groups = try ProblemGrouping.groups([
      solo("variant", "Cross-Array Two Sum", .imported, "a"), solo("report", "Two Sum", .imported, "b"), solo("stock", "Two Sum", .stock, "leetcode:1")
    ])
    var filters = ProblemFilters()
    filters.search = "two sum"
    #expect(ProblemFiltering.filter(groups, filters, [ProblemSort(.name)]).map(\.id) == ["stock", "report", "variant"])
    filters.search = "1"
    #expect(ProblemFiltering.filter(groups, filters, [ProblemSort(.name)]).map(\.id) == ["stock"])
    let index = ProblemLibraryIndex(groups: groups)
    #expect(index.query(ProblemQuery(filters: filters)).rows == [.problem(2)])
    #expect(index.groups[2].problem.title == "1. Two Sum")
  }

  @Test func ungroupingRestoresRowsAndIncompleteOrNestedGroupsAreRefused() throws {
    var released = alias
    released.canonicalProblemId = nil
    #expect(try ProblemGrouping.groups([canonical, released]).count == 2)
    #expect(throws: ProblemLibraryError.self) { try ProblemGrouping.groups([alias]) }
    var nested = alias
    nested.id = "nested"
    nested.canonicalProblemId = alias.id
    #expect(throws: ProblemLibraryError.self) { try ProblemGrouping.groups([canonical, alias, nested]) }
  }
}

@Suite("Practice and rows")
struct ProblemPracticeTests {
  private func attempt(_ problemId: String, _ date: String = "2026-10-01", created: String = "2026-10-01T10:00:00Z") -> ProblemAttempt {
    ProblemAttempt(id: UUID().uuidString, problemId: problemId, date: date, solution: "x", createdAt: created, updatedAt: created, revision: 1)
  }

  @Test func statusComesFromAttemptsThenRecordedPracticeThenUnattempted() throws {
    let practice = try ProblemPractice(attempts: [attempt("a")], practiceRows: [["problem_id": "a", "status": "attempted"], ["problem_id": "b", "status": "attempted"]])
    #expect(practice.status(of: "a") == .solved)
    #expect(practice.status(of: "b") == .attempted)
    #expect(practice.status(of: "c") == .unattempted)
  }

  @Test func refusesAPracticeStatusTheAccountCannotRecord() {
    #expect(throws: ProblemLibraryError.self) { try ProblemPractice(attempts: [], practiceRows: [["problem_id": "a", "status": "unattempted"]]) }
  }

  @Test func historyOnARetainedSourceDoesNotCarryToItsGroup() throws {
    let practice = ProblemPractice(solved: ["retained"])
    let index = try ProblemLibraryIndex(records: [canonical, alias]).updating(practice: practice)
    #expect(index.groups[0].problem.status == .unattempted)
    #expect(index.groups[0].sources[1].status == .solved)
    #expect(index.facets.status[.unattempted] == 1)
  }

  @Test func listsCatalogBesideCustomAndRefusesSharedIds() throws {
    let catalog: [Row] = [["id": "c1", "name": "Catalog", "kind": "coding", "source_type": "stock", "external_key": "leetcode:7", "content_available": true, "content_version": 1, "revision": 1, "topics": ["Arrays"], "source_metadata": ["lastAsked": ["value": "2026-03", "precision": "month"]]]]
    let custom: [Row] = [["id": "u1", "name": "Mine", "kind": "behavioral", "source_type": "custom", "difficulty": "Hard", "content_version": 0, "revision": 2]]
    let records = try ProblemRows.library(catalog: catalog, custom: custom, practice: ProblemPractice(solved: ["u1"]))
    #expect(records.map(\.id) == ["c1", "u1"])
    #expect(records[0].title == "7. Catalog")
    #expect(records[0].sourceMetadata?.lastAsked?.bounds.through == "2026-03-31")
    #expect(records[1].isCustom && records[1].status == .solved && records[1].difficulty == .hard && records[1].kind == .behavioral)
    #expect(throws: ProblemLibraryError.self) { try ProblemRows.library(catalog: catalog, custom: [["id": "c1", "name": "Copy"]], practice: ProblemPractice()) }
  }

  @Test func historySortsNewestDateThenNewestRecord() {
    let older = attempt("p", "2026-09-01")
    let first = attempt("p", "2026-10-02", created: "2026-10-02T08:00:00Z")
    let second = attempt("p", "2026-10-02", created: "2026-10-02T09:00:00Z")
    let other = attempt("q", "2026-11-01")
    #expect(ProblemAttempts.history([older, first, other, second], for: "p").map(\.id) == [second.id, first.id, older.id])
  }
}

@Suite("Attempts and mistakes inputs")
struct ProblemInputTests {
  @Test func preservesPastedSourceExactly() throws {
    let source = "def solve():\n    return 1  # keep   \n\n\t\n"
    let input = try ProblemCommands.createAttempt(id: "a", problemId: "p", date: "2026-02-28", solution: source)
    #expect(input["solution"] == .string(source))
    #expect(input["expected_revision"] == 0)
    #expect(input["problem_id"] == "p")
    let update = try ProblemCommands.updateAttempt(id: "a", expectedRevision: 3, date: "2026-03-01", solution: source)
    #expect(update["expected_revision"] == 3)
  }

  @Test func rejectsBlankSolutionsAndInvalidDates() {
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.createAttempt(id: "a", problemId: "p", date: "2026-02-30", solution: "x") }
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.createAttempt(id: "a", problemId: "p", date: "2026-2-1", solution: "x") }
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.createAttempt(id: "a", problemId: "p", date: "2026-02-01", solution: " \n ") }
  }

  @Test func mistakesAreTrimmedAndLimitedTo2000Characters() throws {
    #expect(try ProblemCommands.mistakeText("  off by one  \n") == "off by one")
    #expect(try ProblemCommands.mistakeText(String(repeating: "a", count: 2000)).count == 2000)
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.mistakeText(String(repeating: "a", count: 2001)) }
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.mistakeText("   ") }
    #expect(try ProblemCommands.saveMistake(id: "n", expectedRevision: 0, text: " x ")["text"] == "x")
  }
}

@Suite("Saved views")
struct ProblemSavedViewTests {
  @Test func savesTheWebShapeAndReadsItBack() throws {
    var settings = ProblemViewSettings.initial
    settings.filters.topics = ["Sliding Window"]
    settings.filters.tags = ["Round: Onsite"]
    settings.filters.hasContent = true
    settings.filters.lastAskedSince = "2026-01-01"
    settings.sort = [ProblemSort(.lastAsked, .desc)]
    settings.groupBy = .company
    settings.visibleColumns = [.status, .difficulty]
    let input = try ProblemCommands.saveView(id: "v", expectedRevision: 0, name: "  Onsite prep ", settings: settings)
    #expect(input["name"] == "Onsite prep")
    #expect(input["filters"]?["sourceTypes"] == .array([]))
    #expect(input["filters"]?["lastAskedUntil"] == .null)
    #expect(input["group_by"] == "company")
    var row: Row = input
    row["revision"] = 2
    let view = try ProblemSavedView.parse(row)
    #expect(view.settings == settings)
    #expect(view.settings.filters == settings.filters)
    #expect(view.settings.sort == settings.sort && view.settings.groupBy == .company && view.settings.visibleColumns == [.status, .difficulty])
    #expect(view.revision == 2 && view.name == "Onsite prep")
  }

  @Test func refusesAnUnnamedViewOrABackwardsDateRange() {
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.saveView(id: "v", expectedRevision: 0, name: "  ", settings: .initial) }
    var settings = ProblemViewSettings.initial
    settings.filters.lastAskedSince = "2026-05-01"
    settings.filters.lastAskedUntil = "2026-04-01"
    #expect(throws: ProblemLibraryError.self) { try ProblemCommands.saveView(id: "v", expectedRevision: 0, name: "x", settings: settings) }
  }
}

@Suite("Columns and chips")
struct ProblemColumnTests {
  @Test func keepsEveryChosenColumnWhenTheRowFits() {
    let columns: [ProblemColumn] = [.collections, .difficulty, .status]
    #expect(ProblemColumn.fitting(columns, width: 2000) == columns)
  }

  @Test func dropsCollectionsThenLastAskedThenTopicsKeepingStatusAndDifficulty() {
    let columns: [ProblemColumn] = [.difficulty, .lastAsked, .topics, .companies, .collections, .status]
    let all = columns.reduce(ProblemColumn.actionsWidth + ProblemColumn.nameMinimum) { $0 + $1.width }
    #expect(ProblemColumn.fitting(columns, width: all - 1) == [.difficulty, .lastAsked, .topics, .companies, .status])
    #expect(ProblemColumn.fitting(columns, width: all - ProblemColumn.collections.width - 1) == [.difficulty, .topics, .companies, .status])
    #expect(ProblemColumn.fitting(columns, width: 500) == [.status])
    #expect(ProblemColumn.fitting(columns, width: 400).isEmpty)
  }

  @Test func showsEveryChipThatFitsWholeAndLeavesRoomForTheCounter() {
    #expect(ProblemColumn.fittingChipCount([40, 40], gap: 4, counter: 20, available: 84) == 2)
    #expect(ProblemColumn.fittingChipCount([40, 40, 40], gap: 4, counter: 20, available: 100) == 1)
    #expect(ProblemColumn.fittingChipCount([120], gap: 4, counter: 20, available: 100) == 0)
  }
}

@Suite("Source dates")
struct ProblemSourceDateTests {
  @Test func keepsReportedPrecisionAsAnInterval() {
    #expect(ProblemSourceDate(value: "2024", precision: .year).bounds == ("2024-01-01", "2024-12-31"))
    #expect(ProblemSourceDate(value: "2024-02", precision: .month).bounds == ("2024-02-01", "2024-02-29"))
    #expect(ProblemSourceDate(value: "2024-02-03", precision: .day).bounds == ("2024-02-03", "2024-02-03"))
    #expect(ProblemSourceDate(value: "2024-02-03T23:30:00-05:00", precision: .instant).bounds == ("2024-02-04", "2024-02-04"))
    #expect(ProblemDateLabels.label(ProblemSourceDate(value: "2024-02", precision: .month)) == "Feb 2024")
    #expect(ProblemDateLabels.label(ProblemSourceDate(value: "2024-02-03", precision: .day)) == "Feb 3, 2024")
  }

  @Test func dropsDatesThatAreInvalidAtTheirPrecision() {
    #expect(ProblemSourceDate.parse(["value": "2024-13", "precision": "month"]) == nil)
    #expect(ProblemSourceDate.parse(["value": "2024-02-03T10:00:00", "precision": "instant"]) == nil)
    #expect(ProblemSourceDate.parse(["value": "2024", "precision": "year"]) != nil)
  }

  @Test func latestReportPrefersNewestSnapshotThenShortestWindow() {
    let reports = [
      ProblemCompanyReport(company: "A", window: .all, snapshotDate: "2026-05-01", sourceUrl: "https://a"),
      ProblemCompanyReport(company: "B", window: .months3, snapshotDate: "2026-05-01", sourceUrl: "https://b"),
      ProblemCompanyReport(company: "C", window: .days30, snapshotDate: "2026-04-01", sourceUrl: "https://c")
    ]
    #expect(ProblemSourceMetadata.latestReport(reports)?.company == "B")
  }
}

@Suite("Topic vocabulary")
struct ProblemTopicTests {
  @Test func categoriesSelectTheirPatternsAndUnknownLabelsSelectThemselves() {
    #expect(ProblemTopics.filterPatterns("Sliding Window") == ["Sliding window: fixed", "Sliding window: variable", "Monotonic queue"])
    #expect(ProblemTopics.filterPatterns("Greedy") == ["Greedy"])
    #expect(ProblemTopics.filterPatterns("Enumeration") == ["Enumeration"])
    #expect(ProblemTopics.categories(for: ["Heaps", "Arrays", "Unknown"]) == ["Arrays & Hashing", "Heap / Priority Queue"])
    #expect(ProblemTopics.labels.count == Set(ProblemTopics.labels).count)
  }
}

@Suite("Library index")
struct ProblemLibraryIndexTests {
  /// A varied library: every kind, difficulty, status, label family, and recency precision.
  private func library() throws -> [ProblemGroup] {
    var records: [ProblemRecord] = []
    let topics = ["Arrays", "Hash tables", "Sliding window: variable", "Heaps", "Greedy", "Legacy label", "DP: 1D", "Binary search"]
    let companies = ["Google", "Meta", "Stripe", "Amazon"]
    let dates: [ProblemSourceDate?] = [nil, .init(value: "2025", precision: .year), .init(value: "2025-06", precision: .month), .init(value: "2025-06-15", precision: .day), .init(value: "2025-06-30T22:00:00-04:00", precision: .instant)]
    for number in 0..<120 {
      var record = ProblemRecord(
        id: String(format: "p%03d", (number * 37) % 120), name: ["Two Sum", "Merge Intervals", "LRU Cache", "Top K Frequent", "Jump Game"][number % 5] + " \(number % 13)",
        difficulty: number % 7 == 0 ? nil : ProblemDifficulty.allCases[number % 3], kind: ProblemKind.allCases[number % 4],
        topics: [topics[number % topics.count], topics[(number * 3) % topics.count]].reduce(into: []) { if !$0.contains($1) { $0.append($1) } },
        companies: number % 4 == 0 ? [] : [companies[number % 4]], tags: number % 3 == 0 ? ["Round: Onsite", "Role: Backend"] : number % 5 == 0 ? ["Round: Phone screen"] : [],
        collections: number % 6 == 0 ? ["Blind 75"] : [], sourceType: ProblemSourceType.allCases[number % 3], externalKey: number % 3 == 0 ? "leetcode:\(number)" : nil,
        sourceMetadata: dates[number % 5].map { ProblemSourceMetadata(lastAsked: $0) }, contentAvailable: number % 2 == 0,
        status: ProblemStatus.allCases[number % 3], createdAt: "2026-0\(number % 9 + 1)-01T00:00:00Z", updatedAt: "2026-10-\(10 + number % 20)T00:00:00Z"
      )
      if number % 17 == 5 { record.canonicalProblemId = String(format: "p%03d", ((number - 1) * 37) % 120) }
      records.append(record)
    }
    let canonicalIds = Set(records.filter { $0.canonicalProblemId == nil }.map(\.id))
    records = records.map { record in
      guard let parent = record.canonicalProblemId, !canonicalIds.contains(parent) else { return record }
      var copy = record
      copy.canonicalProblemId = nil
      return copy
    }
    return try ProblemGrouping.groups(records)
  }

  @Test func answersEveryQueryLikeThePlainRules() throws {
    let groups = try library()
    let index = ProblemLibraryIndex(groups: groups)
    var queries: [ProblemQuery] = [ProblemQuery()]
    var filters = ProblemFilters()
    filters.search = "two"
    queries.append(ProblemQuery(filters: filters, sort: [ProblemSort(.difficulty, .desc)]))
    filters = ProblemFilters()
    filters.topics = ["Sliding Window", "Heaps"]
    filters.difficulties = [.medium, .hard]
    queries.append(ProblemQuery(filters: filters, sort: [ProblemSort(.lastAsked, .desc), ProblemSort(.name)]))
    filters = ProblemFilters()
    filters.tags = ["Round: Onsite", "Round: Phone screen", "Role: Backend"]
    filters.statuses = [.solved, .attempted]
    queries.append(ProblemQuery(filters: filters, sort: [ProblemSort(.kind), ProblemSort(.createdAt, .desc)]))
    filters = ProblemFilters()
    filters.lastAskedSince = "2025-06-20"
    filters.hasContent = true
    filters.sourceTypes = [.stock, .imported]
    queries.append(ProblemQuery(filters: filters, sort: [ProblemSort(.lastAsked)]))
    filters = ProblemFilters()
    filters.search = "1"
    filters.companies = ["Google", "Meta"]
    filters.kinds = [.coding, .behavioral]
    queries.append(ProblemQuery(filters: filters, sort: [ProblemSort(.updatedAt, .desc)]))
    for query in queries {
      let expected = ProblemFiltering.filter(groups, query.filters, query.sort).map(\.id)
      let actual = index.query(query).rows.compactMap { row -> String? in
        if case .problem(let i) = row { return index.groups[i].id }
        return nil
      }
      #expect(actual == expected, "query \(query)")
    }
  }

  @Test func groupsUnderHeadingsWithCountsInLabelOrder() throws {
    let index = ProblemLibraryIndex(groups: try library())
    let result = index.query(ProblemQuery(groupBy: .difficulty))
    var headings: [(String, Int)] = []
    var sizes: [Int] = []
    for row in result.rows {
      switch row {
      case .header(let label, let count):
        headings.append((label, count))
        sizes.append(0)
      case .problem(let i):
        sizes[sizes.count - 1] += 1
        let label = ProblemGroupBy.difficulty.label(for: index.groups[i].problem)
        #expect(label == headings.last?.0)
      }
    }
    #expect(headings.map(\.0) == ["Easy", "Hard", "Medium", "No difficulty"])
    #expect(headings.map(\.1) == sizes)
    #expect(sizes.reduce(0, +) == result.matches)
  }

  @Test func countsFacetsOverTheLibrary() throws {
    let index = ProblemLibraryIndex(groups: try library())
    let facets = index.facets
    #expect(facets.rounds.map(\.label).sorted() == ["Onsite", "Phone screen"])
    #expect(facets.tagSections.map(\.facet) == [.role])
    let sliding = try #require(facets.topics.first { $0.value == "Sliding Window" })
    #expect(sliding.children.isEmpty)
    #expect(facets.topics.last?.value == "Legacy label")
    #expect(facets.companies.first.map { $0.count >= facets.companies.last!.count } == true)
  }
}

@Suite("Library performance")
struct ProblemLibraryPerformanceTests {
  /// Ten thousand catalog-shaped problems, built from rows the way a library load builds them.
  @Test func indexesAndQueriesTenThousandProblemsQuickly() throws {
    let topics = ProblemTopics.labels
    let companies = (0..<400).map { "Company \($0)" }
    let rows: [Row] = (0..<10_000).map { number in
      [
        "id": .string("problem-\(number)"), "name": .string("Problem number \(number) with a longer title"),
        "difficulty": .string(["Easy", "Medium", "Hard"][number % 3]), "kind": "coding", "source_type": .string(number % 4 == 0 ? "stock" : "imported"),
        "external_key": .string("leetcode:\(number)"), "content_available": .bool(number % 2 == 0), "content_version": 1, "revision": 1,
        "topics": .array([.string(topics[number % topics.count]), .string(topics[(number * 7) % topics.count])]),
        "companies": .array((0..<(number % 6)).map { .string(companies[(number + $0 * 31) % companies.count]) }),
        "tags": number % 3 == 0 ? ["Round: Onsite", "Role: Backend"] : [],
        "collections": number % 10 == 0 ? ["Blind 75"] : [],
        "source_metadata": .object(["lastAsked": .object(["value": .string("2025-\(String(format: "%02d", number % 12 + 1))"), "precision": "month"])]),
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-02-01T00:00:00Z"
      ]
    }
    let clock = ContinuousClock()
    let before = footprint()
    var index: ProblemLibraryIndex?
    var records: [ProblemRecord] = []
    var groups: [ProblemGroup] = []
    let parse = try clock.measure { records = try ProblemRows.library(catalog: rows, custom: [], practice: ProblemPractice()) }
    let grouping = try clock.measure { groups = try ProblemGrouping.groups(records) }
    let indexing = clock.measure { index = ProblemLibraryIndex(groups: groups) }
    let build = parse + grouping + indexing
    records = []
    groups = []
    let held = footprint() - before
    let library = try #require(index)
    var filters = ProblemFilters()
    filters.search = "number 12"
    filters.difficulties = [.medium, .hard]
    filters.topics = ["Graphs", "Sliding Window"]
    var result = ProblemQueryResult.empty
    let all = clock.measure { result = library.query(ProblemQuery(sort: [ProblemSort(.name)])) }
    #expect(result.matches == 10_000)
    let filtered = clock.measure { result = library.query(ProblemQuery(filters: filters, sort: [ProblemSort(.lastAsked, .desc)], groupBy: .topic)) }
    let practice = clock.measure { _ = library.updating(practice: ProblemPractice(solved: Set((0..<500).map { "problem-\($0)" }))) }
    print("problems-library perf: footprint +\(held / 1_048_576) MB (rows still alive), parse \(parse), group \(grouping), index \(indexing), total \(build), query all \(all), filtered+grouped \(filtered), practice update \(practice)")
    #expect(all < .milliseconds(250))
    #expect(filtered < .milliseconds(250))
  }
}

/// The process's physical footprint in bytes.
private func footprint() -> Int {
  var info = task_vm_info_data_t()
  var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
  let result = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
  }
  return result == KERN_SUCCESS ? Int(info.phys_footprint) : 0
}
