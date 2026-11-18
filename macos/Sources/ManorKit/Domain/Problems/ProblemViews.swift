import Foundation

/// The library's columns besides the problem name, in their canonical order.
public enum ProblemColumn: String, Sendable, CaseIterable, Hashable {
  case difficulty, kind, topics, companies, tags, collections, status, lastAsked

  public var label: String {
    switch self {
    case .difficulty: return "Difficulty"
    case .kind: return "Kind"
    case .topics: return "Topics"
    case .companies: return "Companies"
    case .tags: return "Interview"
    case .collections: return "Collections"
    case .status: return "Status"
    case .lastAsked: return "Last asked"
    }
  }

  /// Fixed widths in points; the problem column takes the rest of the row.
  public var width: CGFloat {
    switch self {
    case .difficulty: return 96
    case .kind: return 104
    case .topics: return 232
    case .companies: return 200
    case .tags: return 176
    case .collections: return 208
    case .status: return 120
    case .lastAsked: return 136
    }
  }

  /// The sort a header click applies, for the columns that have one.
  public var sortField: ProblemSort.Field? {
    switch self {
    case .difficulty: return .difficulty
    case .kind: return .kind
    case .lastAsked: return .lastAsked
    default: return nil
    }
  }

  /// Room for the row actions (solve history and the source link).
  public static let actionsWidth: CGFloat = 72
  public static let nameMinimum: CGFloat = 300
  /// Columns give way from the end of this list first, so status and difficulty stay longest.
  static let priority: [ProblemColumn] = [.status, .difficulty, .companies, .topics, .lastAsked, .tags, .kind, .collections]

  /// The chosen columns that fit beside a readable problem column, keeping the chosen order. The saved view
  /// keeps every chosen column; this only decides what the current width shows.
  public static func fitting(_ columns: [ProblemColumn], width: CGFloat) -> [ProblemColumn] {
    var kept = Set(columns)
    func total() -> CGFloat { kept.reduce(actionsWidth + nameMinimum) { $0 + $1.width } }
    for column in priority.reversed() {
      if total() <= width { break }
      kept.remove(column)
    }
    return columns.filter { kept.contains($0) }
  }

  /// How many whole chips fit in `available` points, leaving room for a "+N" counter of width `counter` whenever
  /// some chips are left out. Chips are never cut, so a chip that does not fit moves into the counter.
  public static func fittingChipCount(_ widths: [CGFloat], gap: CGFloat, counter: CGFloat, available: CGFloat) -> Int {
    func span(_ count: Int) -> CGFloat { widths.prefix(count).reduce(0, +) + gap * CGFloat(max(0, count - 1)) }
    if span(widths.count) <= available { return widths.count }
    var count = widths.count - 1
    while count > 0 {
      if span(count) + gap + counter <= available { return count }
      count -= 1
    }
    return 0
  }
}

public struct ProblemSort: Sendable, Hashable {
  public enum Field: String, Sendable, CaseIterable, Hashable {
    case name, difficulty, kind, createdAt, updatedAt, lastAsked
    public var label: String {
      switch self {
      case .name: return "Name"
      case .difficulty: return "Difficulty"
      case .kind: return "Kind"
      case .lastAsked: return "Last asked"
      case .createdAt: return "Created"
      case .updatedAt: return "Updated"
      }
    }
  }
  public enum Direction: String, Sendable, Hashable { case asc, desc }
  public var field: Field
  public var direction: Direction

  public init(_ field: Field, _ direction: Direction = .asc) {
    self.field = field
    self.direction = direction
  }
}

public enum ProblemGroupBy: String, Sendable, CaseIterable, Hashable {
  case topic, company, difficulty, kind, collection

  public var label: String {
    switch self {
    case .topic: return "Topic"
    case .company: return "Company"
    case .difficulty: return "Difficulty"
    case .kind: return "Kind"
    case .collection: return "Collection"
    }
  }

  /// The heading a problem falls under.
  public func label(for problem: ProblemRecord) -> String {
    switch self {
    case .topic: return ProblemTopics.categories(for: problem.topics).first ?? problem.topics.first ?? "No topic"
    case .company: return problem.companies.first ?? "No company"
    case .collection: return problem.collections.first ?? "No collection"
    case .difficulty: return problem.difficulty?.rawValue ?? "No difficulty"
    case .kind: return problem.kind.label
    }
  }
}

/// Filters combine with AND; values within one property, or within one tag facet such as Round, combine with OR.
public struct ProblemFilters: Sendable, Hashable {
  public var search: String = ""
  public var kinds: [ProblemKind] = []
  public var difficulties: [ProblemDifficulty] = []
  /// Topic categories or patterns; a category matches any of its patterns.
  public var topics: [String] = []
  public var companies: [String] = []
  public var tags: [String] = []
  public var collections: [String] = []
  public var sourceTypes: [ProblemSourceType] = []
  public var hasContent: Bool?
  public var statuses: [ProblemStatus] = []
  /// `YYYY-MM-DD` bounds on the reported last-asked date. Undated problems are excluded while either is set.
  public var lastAskedSince: String?
  public var lastAskedUntil: String?

  public init() {}

  public static let empty = ProblemFilters()

  /// Everything except the search cleared.
  public var clearingAll: ProblemFilters {
    var next = ProblemFilters()
    next.search = search
    return next
  }

  public var invalidDateRange: Bool {
    guard let since = lastAskedSince, let until = lastAskedUntil else { return false }
    return since > until
  }

  /// The stored JSON shape (camelCase keys, as the web app saves it).
  public var json: JSONValue {
    .object([
      "search": .string(search), "kinds": .array(kinds.map { .string($0.rawValue) }),
      "difficulties": .array(difficulties.map { .string($0.rawValue) }), "topics": .array(topics.map(JSONValue.string)),
      "companies": .array(companies.map(JSONValue.string)), "tags": .array(tags.map(JSONValue.string)),
      "collections": .array(collections.map(JSONValue.string)), "sourceTypes": .array(sourceTypes.map { .string($0.rawValue) }),
      "hasContent": .from(hasContent), "statuses": .array(statuses.map { .string($0.rawValue) }),
      "lastAskedSince": .from(lastAskedSince), "lastAskedUntil": .from(lastAskedUntil)
    ])
  }

  public init(json: JSONValue?) {
    let object = json?.object ?? [:]
    func strings(_ key: String) -> [String] { object[key]?.array?.compactMap(\.string) ?? [] }
    search = object["search"]?.string ?? ""
    kinds = strings("kinds").compactMap(ProblemKind.init(rawValue:))
    difficulties = strings("difficulties").compactMap(ProblemDifficulty.init(rawValue:))
    topics = strings("topics")
    companies = strings("companies")
    tags = strings("tags")
    collections = strings("collections")
    sourceTypes = strings("sourceTypes").compactMap(ProblemSourceType.init(rawValue:))
    hasContent = object["hasContent"]?.bool
    statuses = strings("statuses").compactMap(ProblemStatus.init(rawValue:))
    lastAskedSince = object["lastAskedSince"]?.string.flatMap { ProblemSourceDate.validDay($0) ? $0 : nil }
    lastAskedUntil = object["lastAskedUntil"]?.string.flatMap { ProblemSourceDate.validDay($0) ? $0 : nil }
  }
}

/// Everything a saved view preserves: filters, sort, grouping, and visible columns.
public struct ProblemViewSettings: Sendable, Hashable {
  public var filters: ProblemFilters
  public var sort: [ProblemSort]
  public var groupBy: ProblemGroupBy?
  public var visibleColumns: [ProblemColumn]

  public init(filters: ProblemFilters = .empty, sort: [ProblemSort] = [ProblemSort(.name)], groupBy: ProblemGroupBy? = nil,
              visibleColumns: [ProblemColumn] = ProblemViewSettings.defaultColumns) {
    self.filters = filters
    self.sort = sort
    self.groupBy = groupBy
    self.visibleColumns = visibleColumns
  }

  public static let defaultColumns: [ProblemColumn] = [.difficulty, .lastAsked, .topics, .companies, .collections, .status]
  public static let initial = ProblemViewSettings()
}

public struct ProblemSavedView: Sendable, Identifiable, Hashable {
  public var id: String
  public var name: String
  public var settings: ProblemViewSettings
  public var revision: Int

  public init(id: String, name: String, settings: ProblemViewSettings, revision: Int) {
    self.id = id
    self.name = name
    self.settings = settings
    self.revision = revision
  }

  /// A `saved_problem_views` row.
  public static func parse(_ row: Row) throws -> ProblemSavedView {
    guard let id = row["id"]?.string, let name = row["name"]?.string else {
      throw ProblemLibraryError("A saved view could not be read. Refresh the library.")
    }
    let sort = (row["sort"]?.array ?? []).compactMap { item -> ProblemSort? in
      guard let field = item["field"]?.string.flatMap(ProblemSort.Field.init(rawValue:)),
            let direction = item["direction"]?.string.flatMap(ProblemSort.Direction.init(rawValue:)) else { return nil }
      return ProblemSort(field, direction)
    }
    let columns = (row["visible_columns"]?.array ?? []).compactMap { $0.string.flatMap(ProblemColumn.init(rawValue:)) }
    return ProblemSavedView(
      id: id, name: name,
      settings: ProblemViewSettings(
        filters: ProblemFilters(json: row["filters"]), sort: sort.isEmpty ? [ProblemSort(.name)] : sort,
        groupBy: row["group_by"]?.string.flatMap(ProblemGroupBy.init(rawValue:)),
        visibleColumns: columns.isEmpty ? ProblemViewSettings.defaultColumns : columns
      ),
      revision: row["revision"]?.int ?? 1
    )
  }
}

/// The exact command inputs the library sends through `manor_command`.
public enum ProblemCommands {
  private static func checkLabels(_ values: [String], limit: Int, _ name: String) throws {
    if values.count > limit { throw ProblemLibraryError("A view can filter at most \(limit) \(name).") }
    if values.contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty || $0.count > 100 }) {
      throw ProblemLibraryError("One of the \(name) in this view is not a valid label.")
    }
  }

  /// `save_problem_view`. `expectedRevision` is 0 for a new view.
  public static func saveView(id: String, expectedRevision: Int, name: String, settings: ProblemViewSettings) throws -> JSONObject {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw ProblemLibraryError("Give the view a name.") }
    guard trimmed.count <= 120 else { throw ProblemLibraryError("View names can be up to 120 characters.") }
    let filters = settings.filters
    guard filters.search.count <= 500 else { throw ProblemLibraryError("The search is too long to save in a view.") }
    try checkLabels(filters.topics, limit: 100, "topics")
    try checkLabels(filters.companies, limit: 100, "companies")
    try checkLabels(filters.tags, limit: 100, "tags")
    try checkLabels(filters.collections, limit: 100, "collections")
    guard !filters.invalidDateRange else { throw ProblemLibraryError("The start date must be on or before the end date.") }
    guard (1...5).contains(settings.sort.count) else { throw ProblemLibraryError("A view sorts by one to five fields.") }
    guard (1...8).contains(settings.visibleColumns.count) else { throw ProblemLibraryError("A view shows at least one column.") }
    return [
      "id": .string(id), "expected_revision": .number(Double(expectedRevision)), "name": .string(trimmed),
      "filters": filters.json,
      "sort": .array(settings.sort.map { .object(["field": .string($0.field.rawValue), "direction": .string($0.direction.rawValue)]) }),
      "group_by": .from(settings.groupBy?.rawValue),
      "visible_columns": .array(settings.visibleColumns.map { .string($0.rawValue) })
    ]
  }

  public static func deleteView(id: String, expectedRevision: Int) -> JSONObject {
    ["id": .string(id), "expected_revision": .number(Double(expectedRevision))]
  }

  /// `create_attempt`: a new dated solve or review with its exact source.
  public static func createAttempt(id: String, problemId: String, date: String, solution: String) throws -> JSONObject {
    try checkAttempt(date: date, solution: solution)
    return ["id": .string(id), "expected_revision": 0, "problem_id": .string(problemId), "date": .string(date), "solution": .string(solution)]
  }

  /// `update_attempt`.
  public static func updateAttempt(id: String, expectedRevision: Int, date: String, solution: String) throws -> JSONObject {
    try checkAttempt(date: date, solution: solution)
    return ["id": .string(id), "expected_revision": .number(Double(expectedRevision)), "date": .string(date), "solution": .string(solution)]
  }

  public static func deleteAttempt(id: String, expectedRevision: Int) -> JSONObject {
    ["id": .string(id), "expected_revision": .number(Double(expectedRevision))]
  }

  /// The solution is kept exactly as pasted; only an empty one is refused.
  public static func checkAttempt(date: String, solution: String) throws {
    guard ProblemSourceDate.validDay(date) else { throw ProblemLibraryError("Choose a real date for this attempt.") }
    guard !solution.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ProblemLibraryError("Paste the solution you used.") }
  }

  /// A mistakes note's text: trimmed, not empty, and at most 2,000 characters.
  public static func mistakeText(_ text: String) throws -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw ProblemLibraryError("Write something to save.") }
    guard trimmed.unicodeScalars.count <= ProblemMistake.maxLength else { throw ProblemLibraryError("Notes can be up to 2,000 characters.") }
    return trimmed
  }

  /// `save_mistake`, creating (revision 0) or editing a note.
  public static func saveMistake(id: String, expectedRevision: Int, text: String) throws -> JSONObject {
    ["id": .string(id), "expected_revision": .number(Double(expectedRevision)), "text": .string(try mistakeText(text))]
  }

  public static func deleteMistake(id: String, expectedRevision: Int) -> JSONObject {
    ["id": .string(id), "expected_revision": .number(Double(expectedRevision))]
  }
}
