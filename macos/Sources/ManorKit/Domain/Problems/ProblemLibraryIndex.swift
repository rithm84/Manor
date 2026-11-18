import Foundation

/// One choice in a filter menu, with how many problems carry it. A topic category holds its patterns as children.
public struct ProblemFacetOption: Sendable, Hashable, Identifiable {
  public var value: String
  public var label: String
  public var count: Int
  public var children: [ProblemFacetOption]
  public var id: String { value }

  public init(value: String, label: String, count: Int, children: [ProblemFacetOption] = []) {
    self.value = value
    self.label = label
    self.count = count
    self.children = children
  }
}

/// The evidence tags of one facet (Role, Technology, Employment, or other tags) for the advanced filters.
public struct ProblemTagSection: Sendable, Hashable, Identifiable {
  public var facet: ProblemTagFacet
  public var options: [ProblemFacetOption]
  public var id: String { facet.rawValue }
  public var title: String { facet == .other ? "Other tags" : facet.rawValue }
}

/// What the filter menus offer, counted over the whole library.
public struct ProblemFacets: Sendable {
  public var difficulty: [ProblemDifficulty: Int] = [:]
  public var status: [ProblemStatus: Int] = [:]
  public var topics: [ProblemFacetOption] = []
  public var companies: [ProblemFacetOption] = []
  public var collections: [ProblemFacetOption] = []
  /// Interview rounds (`Round: ...` tags); the bar filters them, the advanced dialog keeps the other facets.
  public var rounds: [ProblemFacetOption] = []
  public var roundTags: Set<String> = []
  public var tagSections: [ProblemTagSection] = []

  init() {}

  public static let empty = ProblemFacets()

  init(groups: [ProblemGroup]) {
    var patterns: [String: Int] = [:]
    var categories: [String: Int] = [:]
    var companies: [String: Int] = [:]
    var collections: [String: Int] = [:]
    var tags: [String: Int] = [:]
    for group in groups {
      let problem = group.problem
      if let difficulty = problem.difficulty { self.difficulty[difficulty, default: 0] += 1 }
      for topic in problem.topics { patterns[topic, default: 0] += 1 }
      for category in ProblemTopics.categories(for: problem.topics) { categories[category, default: 0] += 1 }
      for company in problem.companies { companies[company, default: 0] += 1 }
      for collection in problem.collections { collections[collection, default: 0] += 1 }
      for tag in problem.tags { tags[tag, default: 0] += 1 }
    }
    status = Self.statusCounts(groups)
    let known = Set(ProblemTopics.labels)
    let grouped = ProblemTopics.categories.compactMap { category -> ProblemFacetOption? in
      guard let count = categories[category.category] else { return nil }
      let children = category.topics.compactMap { topic in patterns[topic.label].map { ProblemFacetOption(value: topic.label, label: topic.label, count: $0) } }
      return ProblemFacetOption(value: category.category, label: category.category, count: count, children: children.count <= 1 ? [] : children)
    }
    topics = grouped + Self.byCount(patterns.filter { !known.contains($0.key) })
    self.companies = Self.byCount(companies)
    self.collections = Self.byCount(collections)
    let sortedTags = tags.keys.sorted { $0.localizedCompare($1) == .orderedAscending }
    var sections: [ProblemTagSection] = []
    for group in ProblemTagFacet.groups(sortedTags) {
      let options = group.values.map { ProblemFacetOption(value: $0.tag, label: $0.label, count: tags[$0.tag] ?? 0) }
      if group.facet == .round {
        rounds = options
        roundTags = Set(options.map(\.value))
      } else {
        sections.append(ProblemTagSection(facet: group.facet, options: options))
      }
    }
    tagSections = sections
  }

  static func statusCounts(_ groups: [ProblemGroup]) -> [ProblemStatus: Int] {
    var counts: [ProblemStatus: Int] = [:]
    for group in groups { counts[group.problem.status, default: 0] += 1 }
    return counts
  }

  /// Most-used values first, so the common choices lead long lists.
  static func byCount(_ counts: [String: Int]) -> [ProblemFacetOption] {
    counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key.localizedCompare($1.key) == .orderedAscending }
      .map { ProblemFacetOption(value: $0.key, label: $0.key, count: $0.value) }
  }
}

/// The library's sort, filters, and grouping together.
public struct ProblemQuery: Sendable, Hashable {
  public var filters: ProblemFilters
  public var sort: [ProblemSort]
  public var groupBy: ProblemGroupBy?

  public init(filters: ProblemFilters = .empty, sort: [ProblemSort] = [ProblemSort(.name)], groupBy: ProblemGroupBy? = nil) {
    self.filters = filters
    self.sort = sort
    self.groupBy = groupBy
  }

  public init(_ settings: ProblemViewSettings) {
    self.init(filters: settings.filters, sort: settings.sort, groupBy: settings.groupBy)
  }
}

/// One line of the library table: a group heading or a problem (an index into `ProblemLibraryIndex.groups`).
public enum ProblemListRow: Sendable, Hashable {
  case header(label: String, count: Int)
  case problem(Int)
}

public struct ProblemQueryResult: Sendable, Equatable {
  public var rows: [ProblemListRow]
  /// How many problems matched, headings excluded.
  public var matches: Int
  public static let empty = ProblemQueryResult(rows: [], matches: 0)
}

/// The library prepared for instant querying: canonical groups, lowercased search text, and precomputed sort keys.
/// Building it takes tens of milliseconds for ten thousand problems, so the page builds it off the main thread;
/// a query then filters and sorts integers and bytes.
public final class ProblemLibraryIndex: Sendable {
  public let groups: [ProblemGroup]
  public let facets: ProblemFacets
  /// Every problem the library holds, canonical and retained, by id.
  private let memberGroup: [String: Int]
  private let haystacks: [[UInt8]]
  private let names: [String]
  private let nameRank: [Int32]
  private let kindRank: [Int32]
  private let createdRank: [Int32]
  private let updatedRank: [Int32]
  /// The rank of the earliest day of each group's last-asked date, or -1 when it has none.
  private let askedRank: [Int32]
  private let idRank: [Int32]
  private let askedBounds: [[Bounds]]

  private struct Bounds: Sendable { let from: String; let through: String }

  public convenience init(records: [ProblemRecord]) throws {
    self.init(groups: try ProblemGrouping.groups(records))
  }

  public init(groups: [ProblemGroup]) {
    self.groups = groups
    facets = ProblemFacets(groups: groups)
    var members: [String: Int] = [:]
    for (index, group) in groups.enumerated() { for source in group.sources { members[source.id] = index } }
    memberGroup = members
    haystacks = groups.map { Array(ProblemFiltering.haystack($0).utf8) }
    names = groups.map { $0.problem.name.lowercased() }
    nameRank = Self.ranks(groups.map(\.problem.name)) { $0.localizedStandardCompare($1) }
    kindRank = groups.map { Int32(ProblemKind.allCases.map(\.rawValue).sorted().firstIndex(of: $0.problem.kind.rawValue) ?? 0) }
    createdRank = Self.ranks(groups.map(\.problem.createdAt)) { $0 == $1 ? .orderedSame : $0 < $1 ? .orderedAscending : .orderedDescending }
    updatedRank = Self.ranks(groups.map(\.problem.updatedAt)) { $0 == $1 ? .orderedSame : $0 < $1 ? .orderedAscending : .orderedDescending }
    let asked = groups.map { $0.problem.sourceMetadata?.lastAsked?.bounds.from }
    let askedOrder = Self.ranks(asked.map { $0 ?? "" }) { $0 == $1 ? .orderedSame : $0 < $1 ? .orderedAscending : .orderedDescending }
    askedRank = zip(asked, askedOrder).map { $0 == nil ? -1 : $1 }
    idRank = Self.ranks(groups.map(\.problem.id)) { $0 == $1 ? .orderedSame : $0 < $1 ? .orderedAscending : .orderedDescending }
    askedBounds = groups.map { group in group.sources.compactMap { $0.sourceMetadata?.lastAsked.map { Bounds(from: $0.bounds.from, through: $0.bounds.through) } } }
  }

  private init(copying index: ProblemLibraryIndex, groups: [ProblemGroup]) {
    self.groups = groups
    var facets = index.facets
    facets.status = ProblemFacets.statusCounts(groups)
    self.facets = facets
    memberGroup = index.memberGroup
    haystacks = index.haystacks
    names = index.names
    nameRank = index.nameRank
    kindRank = index.kindRank
    createdRank = index.createdRank
    updatedRank = index.updatedRank
    askedRank = index.askedRank
    idRank = index.idRank
    askedBounds = index.askedBounds
  }

  /// The same library with practice applied again, reusing every other precomputed key.
  public func updating(practice: ProblemPractice) -> ProblemLibraryIndex {
    let next = groups.map { group -> ProblemGroup in
      var group = group
      group.problem.status = practice.status(of: group.problem.id)
      for index in group.sources.indices { group.sources[index].status = practice.status(of: group.sources[index].id) }
      return group
    }
    return ProblemLibraryIndex(copying: self, groups: next)
  }

  /// The group a problem belongs to, by the id of its canonical problem or any retained source.
  public func group(containing id: String) -> ProblemGroup? { memberGroup[id].map { groups[$0] } }

  public var count: Int { groups.count }

  /// Dense ranks under `order`, so equal values share a rank.
  private static func ranks(_ values: [String], _ order: (String, String) -> ComparisonResult) -> [Int32] {
    let sorted = values.indices.sorted { order(values[$0], values[$1]) == .orderedAscending }
    var ranks = [Int32](repeating: 0, count: values.count)
    var rank: Int32 = 0
    for (position, index) in sorted.enumerated() {
      if position > 0 && order(values[sorted[position - 1]], values[index]) != .orderedSame { rank += 1 }
      ranks[index] = rank
    }
    return ranks
  }

  private static func contains(_ haystack: [UInt8], _ needle: [UInt8]) -> Bool {
    guard haystack.count >= needle.count else { return false }
    return haystack.withUnsafeBytes { hay in
      needle.withUnsafeBytes { pattern in memmem(hay.baseAddress, hay.count, pattern.baseAddress, pattern.count) != nil }
    }
  }

  /// The filters prepared once per query.
  private struct Matcher {
    let kinds: Set<ProblemKind>
    let difficulties: Set<ProblemDifficulty>
    let topicPatterns: Set<String>
    let companies: Set<String>
    let tagGroups: [Set<String>]
    let collections: Set<String>
    let sourceTypes: Set<ProblemSourceType>
    let statuses: Set<ProblemStatus>
    let hasContent: Bool?

    init(_ filters: ProblemFilters) {
      kinds = Set(filters.kinds)
      difficulties = Set(filters.difficulties)
      topicPatterns = Set(filters.topics.flatMap(ProblemTopics.filterPatterns))
      companies = Set(filters.companies)
      var keys: [Substring: Set<String>] = [:]
      for tag in filters.tags { keys[ProblemTagFacet.filterKey(tag), default: []].insert(tag) }
      tagGroups = Array(keys.values)
      collections = Set(filters.collections)
      sourceTypes = Set(filters.sourceTypes)
      statuses = Set(filters.statuses)
      hasContent = filters.hasContent
    }

    func matches(_ problem: ProblemRecord) -> Bool {
      if !kinds.isEmpty && !kinds.contains(problem.kind) { return false }
      if !difficulties.isEmpty && !(problem.difficulty.map(difficulties.contains) ?? false) { return false }
      if !topicPatterns.isEmpty && !problem.topics.contains(where: topicPatterns.contains) { return false }
      if !companies.isEmpty && !problem.companies.contains(where: companies.contains) { return false }
      for group in tagGroups where !problem.tags.contains(where: group.contains) { return false }
      if !collections.isEmpty && !problem.collections.contains(where: collections.contains) { return false }
      if !sourceTypes.isEmpty && !sourceTypes.contains(problem.sourceType) { return false }
      if !statuses.isEmpty && !statuses.contains(problem.status) { return false }
      if let hasContent, problem.contentAvailable != hasContent { return false }
      return true
    }
  }

  /// The rows the table shows for a query. Safe to call from any thread.
  public func query(_ query: ProblemQuery) -> ProblemQueryResult {
    let filters = query.filters
    let search = filters.search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let needle = Array(search.utf8)
    let leetCodeKey = "leetcode:\(search)"
    let matcher = Matcher(filters)
    let since = filters.lastAskedSince
    let until = filters.lastAskedUntil
    var matched: [Int] = []
    matched.reserveCapacity(groups.count)
    for index in groups.indices {
      let problem = groups[index].problem
      if !needle.isEmpty && problem.externalKey != leetCodeKey && !Self.contains(haystacks[index], needle) { continue }
      if since != nil || until != nil {
        let hit = askedBounds[index].contains { bounds in
          (since.map { bounds.through >= $0 } ?? true) && (until.map { bounds.from <= $0 } ?? true)
        }
        if !hit { continue }
      }
      if !matcher.matches(problem) { continue }
      matched.append(index)
    }

    var relevance: [Int8] = []
    if !search.isEmpty {
      relevance = [Int8](repeating: 5, count: groups.count)
      for index in matched {
        let problem = groups[index].problem
        relevance[index] = Int8(ProblemFiltering.searchRank(name: names[index], externalKey: problem.externalKey, stock: problem.sourceType == .stock, search))
      }
    }
    let rules = query.sort
    func before(_ a: Int, _ b: Int) -> Bool {
      if !relevance.isEmpty && relevance[a] != relevance[b] { return relevance[a] < relevance[b] }
      for rule in rules {
        let ascending = rule.direction == .asc
        let left: Int32
        let right: Int32
        switch rule.field {
        case .lastAsked:
          let (x, y) = (askedRank[a], askedRank[b])
          if x < 0 || y < 0 {
            if (x < 0) != (y < 0) { return y < 0 }
            continue
          }
          left = x; right = y
        case .difficulty:
          left = Int32(groups[a].problem.difficulty?.order ?? 3)
          right = Int32(groups[b].problem.difficulty?.order ?? 3)
        case .name: left = nameRank[a]; right = nameRank[b]
        case .kind: left = kindRank[a]; right = kindRank[b]
        case .createdAt: left = createdRank[a]; right = createdRank[b]
        case .updatedAt: left = updatedRank[a]; right = updatedRank[b]
        }
        if left != right { return ascending ? left < right : left > right }
      }
      return idRank[a] < idRank[b]
    }

    guard let groupBy = query.groupBy else {
      matched.sort(by: before)
      return ProblemQueryResult(rows: matched.map(ProblemListRow.problem), matches: matched.count)
    }
    var labels: [Int: String] = [:]
    for index in matched { labels[index] = groupBy.label(for: groups[index].problem) }
    let distinct = Array(Set(labels.values)).sorted { $0.localizedCompare($1) == .orderedAscending }
    let labelRank = Dictionary(uniqueKeysWithValues: distinct.enumerated().map { ($1, $0) })
    matched.sort { a, b in
      let (x, y) = (labelRank[labels[a]!]!, labelRank[labels[b]!]!)
      return x != y ? x < y : before(a, b)
    }
    var counts: [String: Int] = [:]
    for index in matched { counts[labels[index]!, default: 0] += 1 }
    var rows: [ProblemListRow] = []
    rows.reserveCapacity(matched.count + distinct.count)
    var current: String?
    for index in matched {
      let label = labels[index]!
      if label != current {
        rows.append(.header(label: label, count: counts[label] ?? 0))
        current = label
      }
      rows.append(.problem(index))
    }
    return ProblemQueryResult(rows: rows, matches: matched.count)
  }
}
