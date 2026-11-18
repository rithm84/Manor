import Foundation

/// One worked example from a statement, as written for readers (`nums = [2,7,11,15], target = 9`).
public struct ProblemExample: Hashable, Sendable {
  public var input: String
  public var output: String
  public var explanation: String?
  public init(input: String, output: String, explanation: String?) { self.input = input; self.output = output; self.explanation = explanation }
}

/// A typed solving interface: a function, a design class, or a codec round trip. The workspace needs only what
/// labels the console's fields and which languages the interface offers; the judge owns the rest.
public struct ProblemInterface: Hashable, Sendable {
  public enum Kind: String, Hashable, Sendable { case function, `class`, codec }
  public var kind: Kind
  /// Function parameter names, in order.
  public var parameters: [String]
  /// The codec's encoded parameter.
  public var codecParameter: String?
  /// Languages the interface narrows to, when it does.
  public var languages: [ProblemLanguage]?

  public init(kind: Kind, parameters: [String] = [], codecParameter: String? = nil, languages: [ProblemLanguage]? = nil) {
    self.kind = kind; self.parameters = parameters; self.codecParameter = codecParameter; self.languages = languages
  }

  public init?(_ value: JSONValue?) {
    guard let value, let kind = value["kind"]?.string.flatMap(Kind.init(rawValue:)) else { return nil }
    self.kind = kind
    parameters = (value["params"]?.array ?? []).compactMap { $0["name"]?.string }
    codecParameter = value["encode"]?["param"]?["name"]?.string
    languages = value["languages"]?.array?.compactMap { $0.string.flatMap(ProblemLanguage.init(rawValue:)) }
  }
}

/// An immutable statement version: Markdown statement, examples, hints, the editorial, starter code, and the
/// optional typed interface.
public struct ProblemContent: Hashable, Sendable {
  public var problemId: String
  public var version: Int
  public var statementMarkdown: String
  public var examples: [ProblemExample]
  public var hints: [String]
  public var solutionMarkdown: String?
  public var starterCode: [ProblemLanguage: String]
  public var interface: ProblemInterface?

  public init(problemId: String, version: Int, statementMarkdown: String, examples: [ProblemExample] = [], hints: [String] = [], solutionMarkdown: String? = nil, starterCode: [ProblemLanguage: String] = [:], interface: ProblemInterface? = nil) {
    self.problemId = problemId; self.version = version; self.statementMarkdown = statementMarkdown; self.examples = examples
    self.hints = hints; self.solutionMarkdown = solutionMarkdown; self.starterCode = starterCode; self.interface = interface
  }

  /// From a `problem_content_versions` or `problem_catalog_content` row.
  public init(row: Row) throws {
    guard let problemId = row["problem_id"]?.string, let version = row["version"]?.int, let statement = row["statement_markdown"]?.string else {
      throw ProblemLibraryError("This problem's statement could not be read. Refresh the library.")
    }
    var starter: [ProblemLanguage: String] = [:]
    for (key, value) in row["starter_code"]?.object ?? [:] {
      if let language = ProblemLanguage(rawValue: key), let code = value.string { starter[language] = code }
    }
    self.init(
      problemId: problemId, version: version, statementMarkdown: statement,
      examples: (row["examples"]?.array ?? []).compactMap { example in
        guard let input = example["input"]?.string, let output = example["output"]?.string else { return nil }
        return ProblemExample(input: input, output: output, explanation: example["explanation"]?.string)
      },
      hints: (row["hints"]?.array ?? []).compactMap(\.string),
      solutionMarkdown: row["solution_markdown"]?.string,
      starterCode: starter, interface: ProblemInterface(row["interface"])
    )
  }

  /// Languages the editor offers: every language for a standard-input problem, otherwise those with starter code.
  public var languages: [ProblemLanguage] {
    guard interface != nil else { return ProblemLanguage.allCases }
    return ProblemLanguage.allCases.filter { starterCode[$0] != nil }
  }
}

/// An opened problem: the canonical problem of its group with the group's labels, its current statement, and
/// whether it can run and grade. `requested*` describe the exact problem asked for, which differs from the canonical
/// problem when it is a grouped source.
public struct ProblemDetail: Sendable {
  public var problem: ProblemRecord
  public var content: ProblemContent?
  public var canExecute: Bool
  public var gradingAvailable: Bool
  public var requestedId: String
  public var requestedProblem: ProblemRecord
  public var requestedContent: ProblemContent?
  public var sourceRecords: [ProblemRecord]

  public init(problem: ProblemRecord, content: ProblemContent?, canExecute: Bool, gradingAvailable: Bool, requestedId: String, requestedProblem: ProblemRecord, requestedContent: ProblemContent?, sourceRecords: [ProblemRecord]) {
    self.problem = problem; self.content = content; self.canExecute = canExecute; self.gradingAvailable = gradingAvailable
    self.requestedId = requestedId; self.requestedProblem = requestedProblem; self.requestedContent = requestedContent; self.sourceRecords = sourceRecords
  }

  /// Composes a detail from stored rows, as `problemCatalogFold.problemDetail` does: a group shows its canonical
  /// problem with every member's labels, grades when the canonical problem has a current testset, and runs supplied
  /// input for custom coding problems with a statement.
  public static func compose(requested: Row, members: [Row], content: Row?, requestedContent: Row?, practice: ProblemPractice, isCustom: @escaping (Row) -> Bool) throws -> ProblemDetail {
    guard let requestedId = requested["id"]?.string else { throw ProblemLibraryError("This problem could not be read. Refresh the library.") }
    let canonicalId = requested["canonical_problem_id"]?.string ?? requestedId
    let sorted = members.sorted { ($0["id"]?.string ?? "") < ($1["id"]?.string ?? "") }
    guard let canonicalRow = sorted.first(where: { $0["id"]?.string == canonicalId }) else {
      throw ProblemLibraryError("This problem's group is not in your library yet. Refresh the library and open it again.")
    }
    func record(_ row: Row) throws -> ProblemRecord {
      let custom = isCustom(row)
      let id = row["id"]?.string ?? ""
      return try ProblemRows.record(row, status: practice.status(of: id), isCustom: custom)
    }
    let sources = try sorted.map(record)
    var problem = try record(canonicalRow)
    if sorted.count > 1 {
      func union(_ property: ProblemLabelProperty) -> [String] {
        Array(Set(sources.flatMap { $0.labels(property) })).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
      }
      problem.topics = union(.topics); problem.companies = union(.companies); problem.tags = union(.tags); problem.collections = union(.collections)
    }
    let parsedContent = try content.map(ProblemContent.init(row:))
    let grading = problem.kind == .coding && canonicalRow["grading_version"]?.int != nil
    return ProblemDetail(
      problem: problem, content: parsedContent, canExecute: grading || (problem.kind == .coding && problem.sourceType == .custom && parsedContent != nil),
      gradingAvailable: grading, requestedId: requestedId, requestedProblem: try record(requested),
      requestedContent: try requestedContent.map(ProblemContent.init(row:)), sourceRecords: sources
    )
  }
}

/// Opens a problem: composed from the local mirror when it holds the problem and its current statement, otherwise
/// from `manor_problem_query('read_problem')`, which answers while the mirror is still filling or behind.
@MainActor
public final class ProblemDetailLoader {
  private let gateway: Gateway
  public init(gateway: Gateway) { self.gateway = gateway }

  public func load(_ id: String) async throws -> ProblemDetail {
    if let composed = try? await composeFromStore(id) { return composed }
    return try await readFromServer(id)
  }

  /// Signals that the mirror cannot answer, which sends the open to the server.
  private struct NotServing: Error {}

  private func stored(_ mirror: LocalMirror, _ table: String, key: String) async throws -> Row? {
    guard case .row(let row) = try await mirror.row(table, key: key) else { throw NotServing() }
    return row
  }

  private func storedRows(_ mirror: LocalMirror, _ table: String, _ filters: [RowFilter]) async throws -> [Row] {
    guard let rows = try await mirror.rows(table, filters: filters) else { throw NotServing() }
    return rows
  }

  /// A catalog row is stored as a lean index row plus its source evidence under `problem_catalog_detail`, which
  /// exists only in the mirror; an open problem rejoins them. Custom rows are stored whole.
  private func wholeRow(_ mirror: LocalMirror, _ row: Row, catalog: Bool) async throws -> Row {
    guard catalog, let id = row["id"]?.string else { return row }
    return try CatalogRows.join(row, detail: try await stored(mirror, "problem_catalog_detail", key: id))
  }

  private func composeFromStore(_ id: String) async throws -> ProblemDetail? {
    guard let mirror = gateway.localMirror else { return nil }
    do {
      var catalogIds = Set<String>()
      let requested: Row
      if let row = try await stored(mirror, "problem_catalog", key: id) {
        requested = try await wholeRow(mirror, row, catalog: true)
        catalogIds.insert(id)
      } else if let row = try await stored(mirror, "leetcode_problems", key: id) {
        requested = row
      } else {
        // A problem the mirror has not pulled yet may still exist; the server says whether it does.
        return nil
      }
      let canonicalId = requested["canonical_problem_id"]?.string ?? id
      var members: [Row] = []
      var seen = Set<String>()
      for (table, catalog) in [("problem_catalog", true), ("leetcode_problems", false)] {
        let canonical = try await stored(mirror, table, key: canonicalId).map { [$0] } ?? []
        let grouped = try await storedRows(mirror, table, [RowFilter("canonical_problem_id", .string(canonicalId))])
        for member in canonical + grouped {
          guard let memberId = member["id"]?.string, seen.insert(memberId).inserted else { continue }
          if catalog { catalogIds.insert(memberId) }
          members.append(memberId == id ? requested : try await wholeRow(mirror, member, catalog: catalog))
        }
      }
      guard members.contains(where: { $0["id"]?.string == id }), let canonical = members.first(where: { $0["id"]?.string == canonicalId }) else { return nil }
      let isCatalog = catalogIds
      func isCustom(_ row: Row) -> Bool { !isCatalog.contains(row["id"]?.string ?? "") }
      /// The row's current statement: `.some(nil)` when it has none, nil when the mirror is behind.
      func content(of row: Row) async throws -> Row?? {
        let version = row["content_version"]?.int ?? 0
        guard row["content_available"]?.bool == true, version > 0, let problemId = row["id"]?.string else { return .some(nil) }
        let statement = isCustom(row)
          ? try await storedRows(mirror, "problem_content_versions", [RowFilter("problem_id", .string(problemId)), RowFilter("version", .number(Double(version)))]).first
          : try await stored(mirror, "problem_catalog_content", key: problemId)
        // A pull that has applied the problem but not yet its new statement leaves the copy briefly behind.
        guard let statement, statement["version"]?.int == version else { return nil }
        return .some(statement)
      }
      guard let canonicalContent = try await content(of: canonical) else { return nil }
      var requestedContent: Row? = canonicalContent
      if id != canonicalId {
        guard let own = try await content(of: requested) else { return nil }
        requestedContent = own
      }
      let practiceState = try await practice()
      return try ProblemDetail.compose(requested: requested, members: members, content: canonicalContent, requestedContent: requestedContent, practice: practiceState, isCustom: isCustom)
    } catch is NotServing {
      return nil
    }
  }

  private func practice() async throws -> ProblemPractice {
    let attempts = try await gateway.rows("leetcode_attempts").compactMap { try? ProblemRows.attempt($0) }
    return try ProblemPractice(attempts: attempts, practiceRows: try await gateway.rows("problem_practice"))
  }

  private func readFromServer(_ id: String) async throws -> ProblemDetail {
    let data = try await gateway.rpc("manor_problem_query", ["p_query": "read_problem", "p_input": ["id": .string(id)]])
    guard let problem = data["problem"]?.object, let requested = data["requested_problem"]?.object else {
      throw ProblemLibraryError("This problem could not be found. It may have been removed.")
    }
    let attempts = try await gateway.rows("leetcode_attempts").compactMap { try? ProblemRows.attempt($0) }
    let solved = Set(attempts.map(\.problemId))
    func record(_ row: Row) throws -> ProblemRecord {
      let custom = row["user_id"].map { !$0.isNull } ?? false
      var parsed = try ProblemRows.record(row, isCustom: custom)
      parsed.status = solved.contains(parsed.id) ? .solved : row["status"]?.string.flatMap(ProblemStatus.init(rawValue:)) ?? .unattempted
      return parsed
    }
    let sources = try (data["source_records"]?.array ?? []).compactMap(\.object).map(record)
    return ProblemDetail(
      problem: try record(problem), content: try data["content"]?.object.map(ProblemContent.init(row:)),
      canExecute: data["can_execute"]?.bool ?? false, gradingAvailable: data["grading_available"]?.bool ?? false,
      requestedId: data["requested_id"]?.string ?? id, requestedProblem: try record(requested),
      requestedContent: try data["requested_content"]?.object.map(ProblemContent.init(row:)), sourceRecords: sources
    )
  }
}
