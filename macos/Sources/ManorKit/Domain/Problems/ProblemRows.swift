import Foundation

/// Folds stored rows into the library: the shared catalog, the account's custom problems, and its practice.
/// Parsing is hand-written rather than `Decodable`, because a library load parses ten thousand catalog rows.
public enum ProblemRows {
  /// One problem row of `problem_catalog` (`isCustom` false) or `leetcode_problems` (`isCustom` true).
  public static func record(_ row: Row, status: ProblemStatus = .unattempted, isCustom: Bool) throws -> ProblemRecord {
    guard let id = row["id"]?.string, !id.isEmpty else { throw ProblemLibraryError("A problem in your library has no id. Refresh the library.") }
    guard let name = row["name"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
      throw ProblemLibraryError("Problem \(id) has no name. Refresh the library.")
    }
    func labels(_ key: String) -> [String] {
      guard let values = row[key]?.array else { return [] }
      var seen = Set<String>()
      var result: [String] = []
      result.reserveCapacity(values.count)
      for value in values {
        guard let label = value.string, !label.isEmpty, seen.insert(label).inserted else { continue }
        result.append(label)
      }
      return result
    }
    func optionalText(_ key: String) -> String? {
      guard let value = row[key]?.string, !value.isEmpty else { return nil }
      return value
    }
    let url = optionalText("source_url").flatMap { $0.hasPrefix("http://") || $0.hasPrefix("https://") ? $0 : nil }
    return ProblemRecord(
      id: id, name: name, difficulty: row["difficulty"]?.string.flatMap(ProblemDifficulty.init(rawValue:)),
      kind: row["kind"]?.string.flatMap(ProblemKind.init(rawValue:)) ?? .other,
      topics: labels("topics"), companies: labels("companies"), tags: labels("tags"), collections: labels("collections"),
      sourceUrl: url, sourceType: row["source_type"]?.string.flatMap(ProblemSourceType.init(rawValue:)) ?? (isCustom ? .custom : .imported),
      externalKey: optionalText("external_key"), sourceMetadata: ProblemSourceMetadata.parse(row["source_metadata"]),
      canonicalProblemId: optionalText("canonical_problem_id"), sourceName: optionalText("source_name"),
      duplicateReason: optionalText("duplicate_reason"), contentAvailable: row["content_available"]?.bool ?? false,
      contentVersion: row["content_version"]?.int ?? 0, gradingVersion: row["grading_version"]?.int,
      revision: row["revision"]?.int ?? 1, status: status,
      createdAt: row["created_at"]?.string ?? "", updatedAt: row["updated_at"]?.string ?? "", isCustom: isCustom
    )
  }

  /// Every problem the account sees: the catalog and its own custom problems, which never share an id.
  public static func library(catalog: [Row], custom: [Row], practice: ProblemPractice) throws -> [ProblemRecord] {
    var records: [ProblemRecord] = []
    records.reserveCapacity(catalog.count + custom.count)
    for row in catalog { records.append(try record(row, isCustom: false)) }
    for row in custom { records.append(try record(row, isCustom: true)) }
    var seen = Set<String>()
    for index in records.indices {
      guard seen.insert(records[index].id).inserted else {
        throw ProblemLibraryError("Problem \(records[index].id) is both a catalog problem and a custom problem. Refresh the library.")
      }
      records[index].status = practice.status(of: records[index].id)
    }
    return records
  }

  public static func attempt(_ row: Row) throws -> ProblemAttempt {
    guard let id = row["id"]?.string, let problemId = row["problem_id"]?.string, let date = row["date"]?.string,
          ProblemSourceDate.validDay(date) else { throw ProblemLibraryError("An attempt in your library could not be read. Refresh the library.") }
    return ProblemAttempt(
      id: id, problemId: problemId, date: date, solution: row["solution"]?.string ?? "",
      createdAt: row["created_at"]?.string ?? "", updatedAt: row["updated_at"]?.string ?? "", revision: row["revision"]?.int ?? 1
    )
  }

  public static func mistake(_ row: Row) throws -> ProblemMistake {
    guard let id = row["id"]?.string, let text = row["text"]?.string else {
      throw ProblemLibraryError("A mistakes note could not be read. Refresh the library.")
    }
    return ProblemMistake(
      id: id, text: text, createdAt: row["created_at"]?.string ?? "", updatedAt: row["updated_at"]?.string ?? "",
      revision: row["revision"]?.int ?? 1
    )
  }
}

/// What the account has done: problems with an attempt, and the practice status recorded for others.
public struct ProblemPractice: Sendable, Equatable {
  public var solved: Set<String>
  public var recorded: [String: ProblemStatus]

  public init(solved: Set<String> = [], recorded: [String: ProblemStatus] = [:]) {
    self.solved = solved
    self.recorded = recorded
  }

  /// From attempts and `problem_practice` rows, which record only `attempted` or `solved`.
  public init(attempts: [ProblemAttempt], practiceRows: [Row]) throws {
    solved = Set(attempts.map(\.problemId))
    var recorded: [String: ProblemStatus] = [:]
    for row in practiceRows {
      guard let id = row["problem_id"]?.string, !id.isEmpty,
            let status = row["status"]?.string.flatMap(ProblemStatus.init(rawValue:)), status != .unattempted else {
        throw ProblemLibraryError("A practice record could not be read. Refresh the library.")
      }
      recorded[id] = status
    }
    self.recorded = recorded
  }

  /// A problem's status is the account's own history on that exact problem: solved once it has an attempt,
  /// otherwise its recorded practice status, otherwise unattempted. A group shows its canonical problem's status.
  public func status(of problemId: String) -> ProblemStatus {
    if solved.contains(problemId) { return .solved }
    return recorded[problemId] ?? .unattempted
  }
}

/// Evidence tags: an interview round, role, technology, or employment type, written `Facet: value`.
public enum ProblemTagFacet: String, Sendable, CaseIterable, Hashable {
  case round = "Round", role = "Role", technology = "Technology", employment = "Employment", other = "Other"

  /// The facet and display label of a tag; unprefixed legacy tags stay visible under Other.
  public static func parse(_ tag: String) -> (facet: ProblemTagFacet, label: String) {
    for facet in [ProblemTagFacet.round, .role, .technology, .employment] where tag.hasPrefix("\(facet.rawValue): ") {
      return (facet, String(tag.dropFirst(facet.rawValue.count + 2)))
    }
    return (.other, tag)
  }

  /// Tags grouped by facet in a fixed order, keeping each group's given order.
  public static func groups(_ tags: [String]) -> [(facet: ProblemTagFacet, values: [(tag: String, label: String)])] {
    // Explicit loops: newer compilers fail to type-check the nested tuple-returning closures this replaced.
    var byFacet: [ProblemTagFacet: [(tag: String, label: String)]] = [:]
    for tag in tags {
      let parsed = parse(tag)
      byFacet[parsed.facet, default: []].append((tag: tag, label: parsed.label))
    }
    var result: [(facet: ProblemTagFacet, values: [(tag: String, label: String)])] = []
    for facet in allCases {
      if let values = byFacet[facet], !values.isEmpty { result.append((facet: facet, values: values)) }
    }
    return result
  }

  /// Tags in facet order, as table cells list them.
  public static func ordered(_ tags: [String]) -> [String] { groups(tags).flatMap { $0.values.map(\.tag) } }

  /// The filter key of a tag: its prefix before ": ", or empty. Values inside one key combine with OR.
  public static func filterKey(_ tag: String) -> Substring {
    guard let range = tag.range(of: ": ") else { return "" }
    return tag[..<range.lowerBound]
  }
}

/// Sorting attempts for a problem's history: newest date first, then newest record.
public enum ProblemAttempts {
  public static func history(_ attempts: [ProblemAttempt], for problemId: String) -> [ProblemAttempt] {
    attempts.filter { $0.problemId == problemId }.sorted {
      $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt
    }
  }
}
