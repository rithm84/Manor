import Foundation

/// The Jobs reads and commands, with the exact inputs the backend commands expect.
@MainActor
public struct JobsService {
  public let gateway: Gateway
  public init(gateway: Gateway) { self.gateway = gateway }

  /// The tables the Jobs page shows; reload when any of them changes.
  public static let tables: Set<String> = ["job_roles", "job_stage_transitions", "job_listings", "resumes"]

  /// Live roles and their stage history. Trashed roles and their transitions are left out.
  public func load(today: String) async throws -> JobsState {
    async let roleRows = gateway.rows("job_roles")
    async let transitionRows = gateway.rows("job_stage_transitions")
    let liveRows: [Row] = try await roleRows.filter { row in row["deleted_at"]?.isNull ?? true }
    let roles: [JobRole] = try liveRows.map { try JobRole(row: $0) }
    let ids = Set(roles.map(\.id))
    let history: [Row] = try await transitionRows
    let transitions: [JobStageTransition] = try history.map { try JobStageTransition(row: $0) }.filter { ids.contains($0.roleId) }
    return JobsState(today: today, roles: roles, transitions: transitions)
  }

  /// Creates a role. Returns its id.
  @discardableResult
  public func createRole(_ fields: JobRoleFields) async throws -> String {
    let fields = try fields.validated()
    let id = UUID().uuidString.lowercased()
    var input = fields.commandInput
    input["id"] = .string(id)
    input["expected_revision"] = 0
    try await gateway.command("create_application", input)
    return id
  }

  /// Saves the whole schema at once; a stage change records a transition on the server.
  public func updateRole(id: String, fields: JobRoleFields, expectedRevision: Int) async throws {
    let fields = try fields.validated()
    var input = fields.commandInput
    input["id"] = .string(id)
    input["expected_revision"] = .number(Double(expectedRevision))
    try await gateway.command("update_application", input)
  }

  /// Moves a role without touching its other fields.
  public func setStage(id: String, stage: JobStage, expectedRevision: Int) async throws {
    try await gateway.command("change_application_stage", [
      "id": .string(id), "stage": .string(stage.rawValue), "expected_revision": .number(Double(expectedRevision))
    ])
  }

  /// Moves a role to Trash. Returns the trashed record's revision, which `restoreRole` needs.
  @discardableResult
  public func trashRole(id: String, expectedRevision: Int) async throws -> Int? {
    let receipt = try await gateway.command("trash_application", ["id": .string(id), "expected_revision": .number(Double(expectedRevision))])
    return receipt.record?.revision
  }

  /// Brings a role back from Trash within its seven days.
  public func restoreRole(id: String, expectedRevision: Int) async throws {
    try await gateway.command("restore_application", ["id": .string(id), "expected_revision": .number(Double(expectedRevision))])
  }

  /// The open catalog, newest first, with each listing marked when a live role already uses its link.
  public func feed() async throws -> JobFeedPage {
    async let listingRows = gateway.rows("job_listings", where: [RowFilter("active", true)])
    async let roleRows = gateway.rows("job_roles")
    let roles: [Row] = try await roleRows
    let rows: [Row] = try await listingRows
    var addedLinks = Set<String>()
    for role in roles where role["deleted_at"]?.isNull ?? true {
      if let link = role["link"]?.string { addedLinks.insert(link) }
    }
    var listings: [JobListing] = []
    listings.reserveCapacity(rows.count)
    for row in rows {
      guard var listing = JobListing(row: row, added: false) else { continue }
      listing.added = addedLinks.contains(listing.url)
      listings.append(listing)
    }
    listings.sort { (left: JobListing, right: JobListing) -> Bool in
      if left.posted != right.posted { return left.posted > right.posted }
      return left.company < right.company
    }
    return JobFeedPage(listings: listings)
  }

  /// Adds one catalog listing to the pipeline as a To apply role, keeping its locations and cycle.
  public func addListing(_ listingId: String) async throws {
    let trimmed = listingId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw JobValidationError("listing", "Choose a listing to add.") }
    try await gateway.command("add_job_listing", ["listing_id": .string(trimmed)])
  }
}
