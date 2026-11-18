import Foundation

/// One row of the library: a canonical problem shown once, with every retained source grouped under it.
public struct ProblemGroup: Sendable, Identifiable, Equatable {
  /// The canonical problem with the union of its sources' labels and their source evidence.
  public var problem: ProblemRecord
  /// Every member, the canonical problem included, as stored.
  public var sources: [ProblemRecord]
  public var id: String { problem.id }

  public init(problem: ProblemRecord, sources: [ProblemRecord]) {
    self.problem = problem
    self.sources = sources
  }
}

public enum ProblemGrouping {
  /// Projects raw identities into canonical rows. Each retained source names a canonical problem that must be
  /// present and itself canonical; otherwise the library is incomplete and refuses to guess.
  public static func groups(_ records: [ProblemRecord]) throws -> [ProblemGroup] {
    var byId: [String: Int] = [:]
    byId.reserveCapacity(records.count)
    for (index, record) in records.enumerated() { byId[record.id] = index }
    var members: [String: [Int]] = [:]
    for (index, record) in records.enumerated() where record.canonicalProblemId != nil {
      let canonicalId = record.canonicalId
      guard let canonical = byId[canonicalId], records[canonical].canonicalProblemId == nil else {
        throw ProblemLibraryError("The canonical problem for retained source \(record.id) is unavailable. Refresh your library before opening it.")
      }
      members[canonicalId, default: [canonical]].append(index)
    }
    return records.compactMap { canonical -> ProblemGroup? in
      guard canonical.canonicalProblemId == nil else { return nil }
      guard let indices = members[canonical.id] else { return ProblemGroup(problem: canonical, sources: [canonical]) }
      let sources = indices.map { records[$0] }
      var problem = canonical
      for property in ProblemLabelProperty.allCases {
        let union = Array(Set(sources.flatMap { $0.labels(property) })).sorted { $0.localizedCompare($1) == .orderedAscending }
        switch property {
        case .topics: problem.topics = union
        case .companies: problem.companies = union
        case .tags: problem.tags = union
        case .collections: problem.collections = union
        }
      }
      problem.sourceMetadata = groupMetadata(canonical: canonical, sources: sources)
      return ProblemGroup(problem: problem, sources: sources)
    }
  }

  /// Scalar report fields stay with the canonical source; shared evidence keeps every distinct snapshot and report,
  /// and the group's last-asked date is the newest of its sources.
  static func groupMetadata(canonical: ProblemRecord, sources: [ProblemRecord]) -> ProblemSourceMetadata? {
    let metadata = sources.compactMap(\.sourceMetadata)
    guard !metadata.isEmpty else { return nil }
    var latest: ProblemSourceDate?
    for asked in metadata.compactMap(\.lastAsked) where latest == nil || asked.bounds.from > latest!.bounds.from { latest = asked }
    var result = canonical.sourceMetadata ?? ProblemSourceMetadata()
    if let latest { result.lastAsked = latest }
    let snapshots = distinct(metadata.flatMap { $0.snapshots ?? [] })
    if !snapshots.isEmpty { result.snapshots = snapshots }
    let reports = distinct(metadata.flatMap { $0.companyReports ?? [] })
    if !reports.isEmpty { result.companyReports = reports }
    return result
  }

  private static func distinct<T: Hashable>(_ values: [T]) -> [T] {
    var seen = Set<T>()
    return values.filter { seen.insert($0).inserted }
  }
}

/// The library's filtering and ordering rules, written plainly. `ProblemLibraryIndex` answers the same
/// questions over precomputed keys; tests hold the two to the same results.
public enum ProblemFiltering {
  /// Search relevance: a LeetCode number or exact title first (the LeetCode problem ahead of same-titled imports),
  /// then title prefixes, title words, title text, and finally other labels.
  public static func searchRank(_ problem: ProblemRecord, _ search: String) -> Int {
    searchRank(name: problem.name.lowercased(), externalKey: problem.externalKey, stock: problem.sourceType == .stock, search)
  }

  static func searchRank(name: String, externalKey: String?, stock: Bool, _ search: String) -> Int {
    if externalKey == "leetcode:\(search)" { return 0 }
    if name == search { return stock ? 0 : 1 }
    if name.hasPrefix(search) { return 2 }
    if name.contains(" " + search) { return 3 }
    return name.contains(search) ? 4 : 5
  }

  /// Whether a problem passes every filter except search and recency, which `groups` applies across sources.
  public static func matches(_ problem: ProblemRecord, _ filters: ProblemFilters) -> Bool {
    func overlaps(_ actual: [String], _ selected: [String]) -> Bool { selected.isEmpty || selected.contains(where: actual.contains) }
    if !filters.kinds.isEmpty && !filters.kinds.contains(problem.kind) { return false }
    if !filters.difficulties.isEmpty && !(problem.difficulty.map(filters.difficulties.contains) ?? false) { return false }
    if !filters.topics.isEmpty && !filters.topics.contains(where: { value in ProblemTopics.filterPatterns(value).contains(where: problem.topics.contains) }) { return false }
    if !overlaps(problem.companies, filters.companies) { return false }
    if !filters.tags.isEmpty {
      var keys: [Substring: [String]] = [:]
      for tag in filters.tags { keys[ProblemTagFacet.filterKey(tag), default: []].append(tag) }
      if !keys.values.allSatisfy({ overlaps(problem.tags, $0) }) { return false }
    }
    if !overlaps(problem.collections, filters.collections) { return false }
    if !filters.sourceTypes.isEmpty && !filters.sourceTypes.contains(problem.sourceType) { return false }
    if !filters.statuses.isEmpty && !filters.statuses.contains(problem.status) { return false }
    if let hasContent = filters.hasContent, problem.contentAvailable != hasContent { return false }
    return true
  }

  /// A group's recency matches when any retained source was asked within the range, even if the newest report falls outside it.
  public static func askedWithin(_ sources: [ProblemRecord], since: String?, until: String?) -> Bool {
    if since == nil && until == nil { return true }
    return sources.contains { source in
      guard let asked = source.sourceMetadata?.lastAsked else { return false }
      let bounds = asked.bounds
      return (since.map { bounds.through >= $0 } ?? true) && (until.map { bounds.from <= $0 } ?? true)
    }
  }

  /// The search text of a group: its titles, topics, companies, and tags, and every source's names.
  public static func haystack(_ group: ProblemGroup) -> String {
    ([group.problem.name] + group.problem.topics + group.problem.companies + group.problem.tags
      + group.sources.flatMap { [$0.name, $0.sourceName ?? ""] }).joined(separator: " ").lowercased()
  }

  /// The ordering of the chosen sort, then id. Returns nil when the rule list leaves the two equal.
  static func compare(_ left: ProblemRecord, _ right: ProblemRecord, _ sort: [ProblemSort]) -> Bool {
    for rule in sort {
      if rule.field == .lastAsked {
        let leftDate = left.sourceMetadata?.lastAsked
        let rightDate = right.sourceMetadata?.lastAsked
        guard let leftDate, let rightDate else {
          if (leftDate == nil) != (rightDate == nil) { return rightDate == nil }
          continue
        }
        let (a, b) = (leftDate.bounds.from, rightDate.bounds.from)
        if a != b { return rule.direction == .asc ? a < b : a > b }
        continue
      }
      let order: ComparisonResult
      switch rule.field {
      case .difficulty:
        let a = left.difficulty?.order ?? 3
        let b = right.difficulty?.order ?? 3
        order = a == b ? .orderedSame : a < b ? .orderedAscending : .orderedDescending
      case .name: order = left.name.localizedStandardCompare(right.name)
      case .kind: order = left.kind.rawValue == right.kind.rawValue ? .orderedSame : left.kind.rawValue < right.kind.rawValue ? .orderedAscending : .orderedDescending
      case .createdAt: order = left.createdAt == right.createdAt ? .orderedSame : left.createdAt < right.createdAt ? .orderedAscending : .orderedDescending
      case .updatedAt: order = left.updatedAt == right.updatedAt ? .orderedSame : left.updatedAt < right.updatedAt ? .orderedAscending : .orderedDescending
      case .lastAsked: order = .orderedSame
      }
      if order != .orderedSame { return rule.direction == .asc ? order == .orderedAscending : order == .orderedDescending }
    }
    return left.id < right.id
  }

  /// The groups that pass the filters, as their canonical problems, ordered by search relevance while searching,
  /// then by the chosen sort.
  public static func filter(_ groups: [ProblemGroup], _ filters: ProblemFilters, _ sort: [ProblemSort]) -> [ProblemRecord] {
    let search = filters.search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let candidates = groups.filter { group in
      if !search.isEmpty && group.problem.externalKey != "leetcode:\(search)" && !haystack(group).contains(search) { return false }
      return askedWithin(group.sources, since: filters.lastAskedSince, until: filters.lastAskedUntil) && matches(group.problem, filters)
    }.map(\.problem)
    return candidates.sorted { left, right in
      if !search.isEmpty {
        let (a, b) = (searchRank(left, search), searchRank(right, search))
        if a != b { return a < b }
      }
      return compare(left, right, sort)
    }
  }
}
