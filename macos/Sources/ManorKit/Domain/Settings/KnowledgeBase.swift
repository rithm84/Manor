import Foundation

/// Knowledge base entries: X bookmarks and captures supplied by an agent, as the Bookmarks page shows them.
public enum KnowledgeBase {
  public enum Source: String, Sendable { case xBookmark = "x_bookmark", capture }
  public enum Status: String, Sendable { case pending, normalized, failed }

  public struct Entry: Hashable, Sendable, Identifiable {
    public let id: String
    public let source: Source
    public let url: String?
    public let title: String?
    public let author: String?
    public let summary: String?
    public let contentMd: String?
    public var status: Status
    public var error: String?
    public let capturedAt: Date
    public let revision: Int
    /// The X post's own address when the entry points at a linked article.
    public let postUrl: String?

    public init(id: String, source: Source, url: String?, title: String?, author: String?, summary: String?, contentMd: String?,
                status: Status, error: String?, capturedAt: Date, revision: Int, postUrl: String? = nil) {
      self.id = id
      self.source = source
      self.url = url
      self.title = title
      self.author = author
      self.summary = summary
      self.contentMd = contentMd
      self.status = status
      self.error = error
      self.capturedAt = capturedAt
      self.revision = revision
      self.postUrl = postUrl
    }
  }

  /// Live entries from `kb_entries` rows; removed entries and rows of unknown shape are left out.
  public static func entries(from rows: [Row]) -> [Entry] {
    rows.compactMap { row in
      guard row["deleted_at"].map({ $0.isNull }) ?? true,
            let id = row["id"]?.string,
            let source = row["source"]?.string.flatMap(Source.init(rawValue:)),
            let status = row["status"]?.string.flatMap(Status.init(rawValue:)),
            let captured = row["captured_at"]?.string.flatMap(SettingsDomain.parseTimestamp) else { return nil }
      let raw = row["raw"]
      return Entry(
        id: id, source: source, url: row["url"]?.string, title: row["title"]?.string, author: row["author"]?.string,
        summary: row["summary"]?.string, contentMd: row["content_md"]?.string, status: status, error: row["error"]?.string,
        capturedAt: captured, revision: row["revision"]?.int ?? 1, postUrl: raw?["post_url"]?.string
      )
    }
  }

  /// Newest sync first, and within one sync the order the source returned, so X bookmarks read in the order
  /// you bookmarked them. Entries saved in the same second belong to one batch and keep their arrival order.
  public static func ordered(_ entries: [Entry]) -> [Entry] {
    entries.enumerated().sorted { lhs, rhs in
      let left = lhs.element.capturedAt.timeIntervalSince1970.rounded(.down)
      let right = rhs.element.capturedAt.timeIntervalSince1970.rounded(.down)
      if left != right { return left > right }
      if lhs.element.capturedAt != rhs.element.capturedAt { return lhs.element.capturedAt < rhs.element.capturedAt }
      return lhs.offset < rhs.offset
    }
    .map(\.element)
  }

  /// The source's host without `www.`; nil when absent or unparsable.
  public static func host(_ url: String?) -> String? {
    guard let url, let parsed = URL(string: url), let host = parsed.host(), !host.isEmpty, parsed.scheme != nil else { return nil }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  /// The saved title, else the host while it is still saving, else a plain label.
  public static func title(_ entry: Entry) -> String {
    if let title = entry.title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
    if let host = host(entry.url) { return host }
    return entry.source == .capture ? "Screen capture" : "Bookmark"
  }

  /// Only https links open from the list.
  public static func isSecureLink(_ value: String?) -> Bool {
    guard let value, let url = URL(string: value) else { return false }
    return url.scheme?.lowercased() == "https" && url.host() != nil
  }

  /// Clock time for today's entries, a short date otherwise, and the year only when it differs.
  public static func timeLabel(_ date: Date, now: Date, timeZone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = timeZone
    if calendar.isDate(date, inSameDayAs: now) {
      formatter.dateFormat = "h:mm a"
    } else if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
      formatter.dateFormat = "MMM d"
    } else {
      formatter.dateFormat = "MMM d, yyyy"
    }
    return formatter.string(from: date)
  }

  public static func hasPending(_ entries: [Entry]) -> Bool { entries.contains { $0.status == .pending } }

  /// Search over title, author, summary, and link. An empty query matches everything.
  public static func matches(_ entry: Entry, query: String) -> Bool {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if needle.isEmpty { return true }
    let haystack = [entry.title, entry.author, entry.summary, entry.url].compactMap { $0 }.joined(separator: " ").lowercased()
    return haystack.contains(needle)
  }
}
