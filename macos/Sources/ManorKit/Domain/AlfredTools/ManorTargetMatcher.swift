import Foundation

// Resolving what a request names ("the gym task", "Stripe") to one record. An ID or a single clear title match
// resolves; several matches or none come back as candidates so Alfred asks instead of guessing.

/// A record a reference can resolve to.
public struct ManorTargetCandidate: Sendable, Hashable {
  public let id: String
  /// The text references are matched against (a task title, a habit name, "Company Role").
  public let title: String
  /// A short distinguishing detail for listings ("due Nov 18", "OA").
  public let detail: String?

  public init(id: String, title: String, detail: String? = nil) {
    self.id = id
    self.title = title
    self.detail = detail
  }

  /// "Title (detail) [id]", the way candidate lists show it.
  public var listing: String {
    "\(title)\(detail.map { " (\($0))" } ?? "") [\(id)]"
  }
}

public enum ManorTargetMatch: Sendable, Equatable {
  case one(ManorTargetCandidate)
  /// Several records fit; ask which one.
  case ambiguous([ManorTargetCandidate])
  /// Nothing fits; the closest records, possibly none.
  case none(suggestions: [ManorTargetCandidate])
}

public enum ManorTargetMatcher {
  /// Most candidates a listing shows.
  public static let listLimit = 8

  /// Lowercased, accents removed, punctuation folded to spaces, runs of space collapsed.
  public static func normalize(_ text: String) -> String {
    let folded = text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    let mapped = folded.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
    return String(mapped).split(separator: " ").joined(separator: " ")
  }

  static func tokens(_ text: String) -> [String] { normalize(text).split(separator: " ").map(String.init) }

  /// Whether every word of `query` starts a word of `text` (so "inter prep" finds "Interview prep"), or the
  /// whole query appears in it.
  public static func contains(_ text: String, _ query: String) -> Bool {
    let haystack = normalize(text)
    let needle = normalize(query)
    guard !needle.isEmpty else { return true }
    if haystack.contains(needle) { return true }
    let words = haystack.split(separator: " ")
    return needle.split(separator: " ").allSatisfy { part in words.contains { $0.hasPrefix(part) } }
  }

  /// Resolves `reference` among `candidates`. An exact ID wins; then an exact title; then titles containing the
  /// reference. When several fit and exactly one satisfies `preferred` (a task due today, say), that one is chosen.
  public static func match(_ reference: String, in candidates: [ManorTargetCandidate], preferred: ((ManorTargetCandidate) -> Bool)? = nil) -> ManorTargetMatch {
    let trimmed = reference.trimmingCharacters(in: .whitespacesAndNewlines)
    if let byId = candidates.first(where: { $0.id.caseInsensitiveCompare(trimmed) == .orderedSame }) { return .one(byId) }
    let needle = normalize(trimmed)
    guard !needle.isEmpty else { return .none(suggestions: []) }

    let exact = candidates.filter { normalize($0.title) == needle }
    if !exact.isEmpty { return settle(exact, preferred: preferred) }
    let partial = candidates.filter { contains($0.title, trimmed) }
    if !partial.isEmpty { return settle(partial, preferred: preferred) }
    return .none(suggestions: suggestions(for: trimmed, in: candidates))
  }

  private static func settle(_ matches: [ManorTargetCandidate], preferred: ((ManorTargetCandidate) -> Bool)?) -> ManorTargetMatch {
    if matches.count == 1 { return .one(matches[0]) }
    if let preferred {
      let favored = matches.filter(preferred)
      if favored.count == 1 { return .one(favored[0]) }
    }
    return .ambiguous(Array(matches.prefix(listLimit)))
  }

  /// Candidates sharing the most word beginnings with the reference, best first.
  static func suggestions(for reference: String, in candidates: [ManorTargetCandidate]) -> [ManorTargetCandidate] {
    let wanted = tokens(reference).filter { $0.count >= 3 }
    guard !wanted.isEmpty else { return [] }
    let scored = candidates.compactMap { candidate -> (ManorTargetCandidate, Int)? in
      let words = tokens(candidate.title)
      let score = wanted.filter { part in words.contains { $0.hasPrefix(part) || part.hasPrefix($0) && $0.count >= 3 } }.count
      return score > 0 ? (candidate, score) : nil
    }
    return Array(scored.sorted { $0.1 > $1.1 }.map(\.0).prefix(listLimit / 2))
  }

  /// The message for a reference that didn't resolve to one record, listing candidates for the model to ask about.
  public static func problem(_ reference: String, kind: String, match: ManorTargetMatch) -> String? {
    switch match {
    case .one: return nil
    case .ambiguous(let candidates):
      return "Several \(kind)s match \"\(reference)\". Ask which one: " + candidates.map(\.listing).joined(separator: "; ")
    case .none(let suggestions):
      if suggestions.isEmpty { return "No \(kind) matches \"\(reference)\"." }
      return "No \(kind) matches \"\(reference)\". Closest: " + suggestions.map(\.listing).joined(separator: "; ")
    }
  }
}
