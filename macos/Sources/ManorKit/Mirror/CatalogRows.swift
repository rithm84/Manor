import Foundation

/// How a catalog problem is stored: the index row the library reads, and the source evidence only an open
/// problem shows.
///
/// Company reports and source snapshots are about two thirds of the catalog's metadata bytes, and the library
/// reads every index row on each load. The index row therefore keeps `source_metadata` without them, except for
/// the single latest report, which the library's recency column shows for a problem without an asked date. The
/// full lists live in `problem_catalog_detail` under the problem id and rejoin the row when the problem opens.
public enum CatalogRows {
  public struct Parts: Sendable, Equatable {
    public let index: MirrorRow
    /// Nil when the problem has no reports or snapshots, so there is nothing to keep apart.
    public let detail: MirrorRow?
  }

  private static let detailFields = ["companyReports", "snapshots"]
  /// Shorter windows rank first among reports of the same snapshot, because they say more about recency.
  static let windowOrder: [String: Int] = ["30d": 0, "3m": 1, "6m": 2, "1y": 3, "older_than_6m": 4, "all": 5]

  private static func metadata(of row: Row) throws -> Row? {
    switch row["source_metadata"] {
    case nil, .null?: return nil
    case .object(let metadata)?: return metadata
    default: throw MirrorError("Catalog problem \(row["id"]?.string ?? "?") has source_metadata that is not an object")
    }
  }

  private static func list(_ metadata: Row, _ field: String, _ id: String) throws -> [JSONValue]? {
    guard let value = metadata[field] else { return nil }
    guard case .array(let list) = value else { throw MirrorError("Catalog problem \(id) has source_metadata.\(field) that is not a list") }
    return list
  }

  /// The report a problem's recency reads when it has no asked date: the newest snapshot, then the shortest window.
  static func latestReport(_ reports: [JSONValue], id: String) throws -> JSONValue? {
    var latest: (date: String, window: Int, report: JSONValue)?
    for report in reports {
      guard let date = report["snapshotDate"]?.string, date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
            let window = report["window"]?.string.flatMap({ windowOrder[$0] }) else {
        throw MirrorError("Catalog problem \(id) has a company report without a snapshot date and window")
      }
      if let current = latest, !(date > current.date || (date == current.date && window < current.window)) { continue }
      latest = (date, window, report)
    }
    return latest?.report
  }

  /// Splits a `problem_catalog` row read from Postgres or a snapshot into its stored index row and detail row.
  public static func split(_ row: Row) throws -> Parts {
    let key = try MirrorTables.rowKey("problem_catalog", row)
    let revision = MirrorTables.revision(of: row)
    let metadata = try metadata(of: row)
    let reports = try metadata.flatMap { try list($0, "companyReports", key) }
    let snapshots = try metadata.flatMap { try list($0, "snapshots", key) }
    guard var rest = metadata, reports != nil || snapshots != nil else {
      return Parts(index: MirrorRow(key: key, data: row, revision: revision), detail: nil)
    }
    rest["companyReports"] = nil
    rest["snapshots"] = nil
    if let latest = try latestReport(reports ?? [], id: key) { rest["companyReports"] = .array([latest]) }
    var detail: Row = [:]
    if let reports { detail["companyReports"] = .array(reports) }
    if let snapshots { detail["snapshots"] = .array(snapshots) }
    var index = row
    index["source_metadata"] = .object(rest)
    return Parts(index: MirrorRow(key: key, data: index, revision: revision), detail: MirrorRow(key: key, data: detail, revision: revision))
  }

  /// The full `problem_catalog` row: the stored index row with its detail lists put back. An index row that kept
  /// a latest report always has a detail row, because a pull writes the detail before the index; one without it
  /// means the copy is broken, so this throws rather than present one report as the whole list.
  public static func join(_ index: Row, detail: Row?) throws -> Row {
    let metadata = try metadata(of: index)
    guard let detail else {
      if metadata?["companyReports"] != nil {
        throw MirrorError("The local copy of catalog problem \(index["id"]?.string ?? "?") lost its company reports; sign out and in again to rebuild it")
      }
      return index
    }
    var restored = metadata ?? [:]
    restored["companyReports"] = nil
    for field in detailFields { if let value = detail[field] { restored[field] = value } }
    var row = index
    row["source_metadata"] = .object(restored)
    return row
  }
}
