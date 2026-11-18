import Foundation

/// One posting in the shared SimplifyJobs catalog. A listing joins the pipeline only when you add it.
public struct JobListing: Identifiable, Equatable, Hashable, Sendable {
  public let id: String
  public let company: String
  public let role: String
  public let locations: String
  public let url: String
  /// `YYYY-MM-DD`.
  public let posted: String
  /// Hiring cycle, for example "Summer 2027"; empty when the source omits it.
  public let term: String
  /// The source's own bucket; empty when the source omits it.
  public let category: String
  /// True once a tracked role uses this listing's link.
  public var added: Bool
  /// Separate requisitions this row stands for (same company, role, location, and cycle).
  public let openings: Int
  /// Lowercased company, role, and locations, computed once so search never re-folds text per keystroke.
  public let searchKey: String
  let companyKey: String
  let locationKey: String

  public init(id: String, company: String, role: String, locations: String, url: String, posted: String, term: String,
              category: String, added: Bool, openings: Int = 1) {
    self.id = id
    self.company = company
    self.role = role
    self.locations = locations
    self.url = url
    self.posted = posted
    self.term = term
    self.category = category
    self.added = added
    self.openings = openings
    self.companyKey = company.lowercased()
    self.locationKey = locations.lowercased()
    self.searchKey = "\(companyKey)\n\(role.lowercased())\n\(locationKey)"
  }

  /// A listing from a `job_listings` row, or nil when the row is inactive or incomplete.
  public init?(row: Row, added: Bool) {
    guard row["active"]?.bool != false, let id = row["id"]?.string, let company = row["company"]?.string,
          let role = row["role"]?.string, let url = row["url"]?.string, let posted = row["posted"]?.string else { return nil }
    let openings = row["openings"]?.int ?? 1
    self.init(id: id, company: company, role: role, locations: row["locations"]?.string ?? "", url: url,
              posted: String(posted.prefix(10)), term: row["term"]?.string ?? "", category: row["category"]?.string ?? "",
              added: added, openings: max(1, openings))
  }

  /// Case-insensitive match of the search box against company, role, and locations.
  public func matches(search: String) -> Bool {
    let needle = JobListing.searchNeedle(search)
    return needle.isEmpty || searchKey.contains(needle)
  }

  /// The normalized form of typed search text, to compare against `searchKey`.
  public static func searchNeedle(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }
}

/// The browsable catalog with its filter vocabulary.
public struct JobFeedPage: Equatable, Sendable {
  public var listings: [JobListing]
  /// Distinct hiring cycles, newest first.
  public let terms: [String]
  /// Distinct categories, alphabetical.
  public let categories: [String]

  public init(listings: [JobListing]) {
    self.listings = listings
    self.terms = Array(Set(listings.map(\.term).filter { !$0.isEmpty })).sorted().reversed()
    self.categories = Array(Set(listings.map(\.category).filter { !$0.isEmpty })).sorted()
  }
}

// MARK: Browse filters

/// The properties a Browse filter rule can test.
public enum BrowseFilterProperty: String, CaseIterable, Sendable, Hashable, Identifiable {
  case term, category, company, location, posted, added
  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .term: return "Hiring cycle"
    case .category: return "Category"
    case .company: return "Company"
    case .location: return "Location"
    case .posted: return "Posted"
    case .added: return "Pipeline"
    }
  }

  /// The properties offered for a feed. Cycle and category appear only when the feed has values for them.
  public static func available(terms: [String], categories: [String]) -> [BrowseFilterProperty] {
    allCases.filter { property in
      switch property {
      case .term: return !terms.isEmpty
      case .category: return !categories.isEmpty
      default: return true
      }
    }
  }
}

public enum PostedFilterOperator: String, CaseIterable, Sendable, Hashable, Identifiable {
  case before, on, after, within
  public var id: String { rawValue }
  public var label: String {
    switch self {
    case .before: return "Before"
    case .on: return "On"
    case .after: return "After"
    case .within: return "Within range"
    }
  }
}

/// Whether a listing is already in the pipeline.
public enum AddedFilterValue: String, CaseIterable, Sendable, Hashable, Identifiable {
  case added
  case notAdded = "not_added"
  public var id: String { rawValue }
  public var label: String { self == .added ? "In pipeline" : "Not added" }
}

/// One AND-combined rule over the catalog.
public struct BrowseFilterRule: Identifiable, Equatable, Hashable, Sendable {
  public enum Condition: Equatable, Hashable, Sendable {
    case term(String)
    case category(String)
    case company(String)
    case location(String)
    case added(AddedFilterValue)
    case posted(PostedFilterOperator, from: String, to: String)
  }

  public let id: UUID
  public var condition: Condition

  public init(id: UUID = UUID(), condition: Condition) {
    self.id = id
    self.condition = condition
  }

  public var property: BrowseFilterProperty {
    switch condition {
    case .term: return .term
    case .category: return .category
    case .company: return .company
    case .location: return .location
    case .added: return .added
    case .posted: return .posted
    }
  }

  /// A new rule seeded from the feed's vocabulary and today. Cycle and category need at least one value.
  public static func make(_ property: BrowseFilterProperty, today: String, terms: [String], categories: [String], id: UUID = UUID()) throws -> BrowseFilterRule {
    switch property {
    case .term:
      guard let first = terms.first else { throw JobValidationError("term", "The listings have no hiring cycles to filter by.") }
      return BrowseFilterRule(id: id, condition: .term(first))
    case .category:
      guard let first = categories.first else { throw JobValidationError("category", "The listings have no categories to filter by.") }
      return BrowseFilterRule(id: id, condition: .category(first))
    case .company: return BrowseFilterRule(id: id, condition: .company(""))
    case .location: return BrowseFilterRule(id: id, condition: .location(""))
    case .added: return BrowseFilterRule(id: id, condition: .added(.notAdded))
    case .posted: return BrowseFilterRule(id: id, condition: .posted(.on, from: today, to: today))
    }
  }

  /// The rule switched to another property, keeping its identity.
  public func changingProperty(to property: BrowseFilterProperty, today: String, terms: [String], categories: [String]) throws -> BrowseFilterRule {
    try Self.make(property, today: today, terms: terms, categories: categories, id: id)
  }

  /// A posted rule with a new operator, carrying the chosen date across. A range starts and ends on it.
  public func changingOperator(to op: PostedFilterOperator, today: String) -> BrowseFilterRule {
    guard case .posted(_, let from, _) = condition else { return self }
    let date = from.isEmpty ? today : from
    return BrowseFilterRule(id: id, condition: .posted(op, from: date, to: date))
  }

  /// An empty text rule matches everything, so a just-added rule never blanks the table.
  public func matches(_ listing: JobListing) -> Bool {
    func contains(_ haystack: String, _ needle: String) -> Bool {
      let trimmed = JobListing.searchNeedle(needle)
      return trimmed.isEmpty || haystack.contains(trimmed)
    }
    switch condition {
    case .term(let value): return listing.term == value
    case .category(let value): return listing.category == value
    case .company(let value): return contains(listing.companyKey, value)
    case .location(let value): return contains(listing.locationKey, value)
    case .added(let value): return listing.added == (value == .added)
    case .posted(let op, let from, let to):
      switch op {
      case .before: return listing.posted < from
      case .on: return listing.posted == from
      case .after: return listing.posted > from
      case .within: return listing.posted >= from && listing.posted <= to
      }
    }
  }
}

public extension Array where Element == BrowseFilterRule {
  /// The listings every rule accepts.
  func filter(_ listings: [JobListing]) -> [JobListing] {
    isEmpty ? listings : listings.filter { listing in allSatisfy { $0.matches(listing) } }
  }

  /// The listings every rule and the search text accept, in one pass with the needle folded once.
  func filter(_ listings: [JobListing], search: String) -> [JobListing] {
    let needle = JobListing.searchNeedle(search)
    if isEmpty && needle.isEmpty { return listings }
    return listings.filter { listing in
      (needle.isEmpty || listing.searchKey.contains(needle)) && allSatisfy { $0.matches(listing) }
    }
  }
}
