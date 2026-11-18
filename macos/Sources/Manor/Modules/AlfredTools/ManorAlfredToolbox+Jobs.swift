import Alfred
import Foundation
import ManorKit

// Jobs: finding roles, stage moves, and Mark OA done, saved the way the role dialog and card menu save them
// (`update_application` with the whole schema). A stage move sets the stage's date only when the request gave one.

extension ManorAlfredToolbox {
  var jobs: JobsService { JobsService(gateway: gateway) }

  func roleName(_ role: JobRole) -> String {
    role.role.isEmpty ? role.company : "\(role.company) \(role.role)"
  }

  func roleCandidate(_ role: JobRole) -> ManorTargetCandidate {
    ManorTargetCandidate(id: role.id, title: roleName(role), detail: role.stage.label)
  }

  func roleLine(_ role: JobRole) -> String {
    var parts = ["[\(role.id)] \(role.company)", role.role, role.stage.label]
    for field in [JobDateField.appliedDate, .oaDueDate, .oaCompletedDate, .interview1Date, .interview2Date, .interview3Date, .decisionDate] {
      if let date = role.fields[date: field] { parts.append("\(field.label.lowercased()) \(date)") }
    }
    return parts.filter { !$0.isEmpty }.joined(separator: ", ")
  }

  func resolveRole(_ reference: String, in state: JobsState) throws -> JobRole {
    let candidates = state.roles.map(roleCandidate)
    let decided: Set<JobStage> = [.offer, .rejected]
    let open = Set(state.roles.filter { !decided.contains($0.stage) }.map(\.id))
    let match = try Self.resolved(reference, kind: "role", ManorTargetMatcher.match(reference, in: candidates, preferred: { open.contains($0.id) }))
    guard let role = state.role(match.id) else { throw ManorToolArgumentError("That role is no longer available.") }
    return role
  }

  /// Saves a role's whole schema at its current revision.
  func saveRole(_ id: String, fields: JobRoleFields) async throws {
    guard let current = try await jobs.load(today: today).role(id) else { throw ManorToolArgumentError("That role is no longer in the pipeline.") }
    try await jobs.updateRole(id: id, fields: fields, expectedRevision: current.revision)
  }

  func findRoles(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let query = try ManorRoleQuery.parse(arguments)
    let result = query.run(try await jobs.load(today: today).roles)
    guard result.total > 0 else { return .found("No roles match.") }
    let header = result.total > result.roles.count ? "\(result.roles.count) of \(result.total) matching roles:" : "\(result.total) matching role\(result.total == 1 ? "" : "s"):"
    return .found(([header] + result.roles.map(roleLine)).joined(separator: "\n"))
  }

  func moveRoleStage(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorMoveRoleArgs.parse(arguments, today: today)
    let state = try await jobs.load(today: today)
    let role = try resolveRole(args.role, in: state)
    let next = args.applied(to: role.fields)
    let name = roleName(role)
    if next == role.fields { return .done("\(name) is already at \(args.stage.label)") }
    try await jobs.updateRole(id: role.id, fields: next, expectedRevision: role.revision)
    var summary = role.stage == args.stage ? "Updated \(name)" : "Moved \(name) to \(args.stage.label)"
    if let date = args.date { summary += ", \(args.stage.dateField.label.lowercased()) \(TaskDates.dayLabel(date))" }
    let previous = role.fields
    let id = role.id
    return .done(summary, output: "\(summary). [\(role.id)] was at \(role.stage.label).", undo: { [weak self] in
      guard let self else { throw Self.closed }
      try await self.saveRole(id, fields: previous)
      return previous.stage == args.stage ? "Put \(name) back" : "Moved \(name) back to \(previous.stage.label)"
    })
  }

  func markOADone(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorMarkOADoneArgs.parse(arguments, today: today)
    let state = try await jobs.load(today: today)
    let role = try resolveRole(args.role, in: state)
    let name = roleName(role)
    guard role.stage == .oa else {
      throw ManorToolArgumentError("\(name) is at \(role.stage.label), not OA. Ask whether to move it to OA first.")
    }
    if let done = role.fields.oaCompletedDate { return .done("\(name)'s OA was already marked done on \(TaskDates.dayLabel(done))") }
    var fields = role.fields
    fields.oaCompletedDate = args.date
    try await jobs.updateRole(id: role.id, fields: fields, expectedRevision: role.revision)
    let id = role.id
    return .done("Marked the \(name) OA done", output: "Marked the OA for [\(role.id)] \(name) done on \(args.date).", undo: { [weak self] in
      guard let self else { throw Self.closed }
      guard var current = try await self.jobs.load(today: self.today).role(id)?.fields else { return "That role is no longer in the pipeline" }
      current.oaCompletedDate = nil
      try await self.saveRole(id, fields: current)
      return "Marked the \(name) OA not done"
    })
  }

  // MARK: Snapshot

  /// Roles still in progress, grouped by stage in board order.
  func jobsSnapshot() async -> [String] {
    do {
      let roles = try await jobs.load(today: today).roles
      let active = roles.filter { $0.stage != .offer && $0.stage != .rejected }
      let decided = roles.count - active.count
      guard !active.isEmpty else { return ["No roles in progress. \(decided) decided."] }
      var lines = ["Roles in progress (\(active.count)), \(decided) decided:"]
      var shown = 0
      for stage in JobStage.allCases where stage != .offer && stage != .rejected {
        let atStage = active.filter { $0.stage == stage }.sorted { $0.company.localizedCaseInsensitiveCompare($1.company) == .orderedAscending }
        guard !atStage.isEmpty else { continue }
        let room = max(3, 40 - shown)
        let listed = atStage.prefix(room).map { role -> String in
          var text = "[\(role.id)] \(roleName(role))"
          if stage == .oa, let due = role.fields.oaDueDate { text += " (OA due \(due)\(role.fields.oaCompletedDate == nil ? "" : ", done"))" }
          return text
        }
        shown += listed.count
        let more = atStage.count > listed.count ? "; and \(atStage.count - listed.count) more" : ""
        lines.append("\(stage.label): " + listed.joined(separator: "; ") + more)
      }
      return lines
    } catch {
      return ["Roles couldn't be read: \(error.localizedDescription)"]
    }
  }
}
