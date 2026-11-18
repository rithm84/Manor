import Alfred
import Foundation
import ManorKit

/// In-app Alfred's hands in Manor: the tool catalog from ManorKit, run against the signed-in account. Writes go
/// through `manor_command` with the inputs the pages send, so every page, the mirror, and other devices see them
/// like any other edit. Explicit requests execute directly; a reference that names several records (or none)
/// fails with the candidates so Alfred asks instead of guessing.
@MainActor
final class ManorAlfredToolbox: AlfredToolbox {
  let context: AppContext
  let tools: [AlfredTool]
  /// Habit check-offs run through the same service the Tracking page uses, so they carry its revisions. The
  /// service asks for today off the main actor, so it reads the account's zone captured for this call.
  var habits: HabitsService {
    let zone = context.timeZone
    return HabitsService(gateway: context.gateway, today: { LocalDate.string(from: Date(), in: zone) })
  }

  init(context: AppContext) {
    self.context = context
    tools = ManorToolCatalog.all.map {
      AlfredTool(name: $0.name.rawValue, description: $0.description, parameters: $0.parameters, confirmation: Self.confirmation(for: $0.name))
    }
  }

  /// Tools without an inverse ask first, so a misread request can't end something by surprise.
  static func confirmation(for tool: ManorToolName) -> AlfredToolConfirmation? {
    switch tool {
    case .stopPomodoro: AlfredToolConfirmation(question: "End the current Pomodoro session? The time so far is kept.", action: "End session")
    default: nil
    }
  }

  var gateway: Gateway { context.gateway }
  var today: String { context.today }

  // MARK: Calls

  func call(_ name: String, arguments: [String: Any]) async -> AlfredToolResult {
    guard let tool = ManorToolName(rawValue: name) else { return .failed("Manor has no tool named \(name).") }
    do {
      switch tool {
      case .findTasks: return try await findTasks(arguments)
      case .createTask: return try await createTask(arguments)
      case .setTasksDone: return try await setTasksDone(arguments)
      case .rescheduleTasks: return try await rescheduleTasks(arguments)
      case .setTaskPriority: return try await setTaskPriority(arguments)
      case .logHabit: return try await logHabit(arguments)
      case .logDailyRatings: return try await logDailyRatings(arguments)
      case .startPomodoro: return try await startPomodoro(arguments)
      case .pausePomodoro: return try await pausePomodoro()
      case .resumePomodoro: return try await resumePomodoro()
      case .stopPomodoro: return try await stopPomodoro()
      case .findRoles: return try await findRoles(arguments)
      case .moveRoleStage: return try await moveRoleStage(arguments)
      case .markOADone: return try await markOADone(arguments)
      case .createNote: return try await createNote(arguments)
      case .appendToCurrentNote: return try await appendToCurrentNote(arguments)
      case .openPage: return try openPage(arguments)
      }
    } catch let error as ManorToolArgumentError {
      return .failed(error.message)
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  private func openPage(_ arguments: [String: Any]) throws -> AlfredToolResult {
    let args = try ManorOpenPageArgs.parse(arguments)
    guard let route = Route(rawValue: args.page) else { throw ManorToolArgumentError("Manor has no \(args.page) page") }
    let previous = context.route
    if previous == route { return .done("Already on \(route.title)") }
    context.navigate(to: route)
    return .done("Opened \(route.title)", undo: { [weak self] in
      guard let self else { throw Self.closed }
      self.context.navigate(to: previous)
      return "Went back to \(previous.title)"
    })
  }

  // MARK: Snapshot

  static let snapshotLimit = 4000

  func snapshot() async -> AlfredAppSnapshot {
    let route = context.route
    var lines = ["Today is \(TaskDates.longDayLabel(today)), \(today), in the account time zone (\(context.timeZone.identifier))."]
    switch route {
    case .home: lines += await homeSnapshot()
    case .tracking: lines += await trackingSnapshot()
    case .pomodoro: lines += await pomodoroSnapshot()
    case .jobs: lines += await jobsSnapshot()
    case .notes: lines += notesSnapshot()
    default: break
    }
    return AlfredAppSnapshot(page: route.title, details: Self.capped(lines))
  }

  /// Joins lines and keeps the text within the snapshot budget, ending on a whole line.
  static func capped(_ lines: [String]) -> String {
    var text = ""
    for line in lines {
      if text.count + line.count + 1 > snapshotLimit - 40 {
        text += "(more not shown)"
        break
      }
      text += line + "\n"
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  // MARK: Shared helpers

  static let closed = ManorToolArgumentError("Alfred's Manor tools are no longer available.")

  /// “Title” for one record, or "3 tasks" for several.
  static func count(_ titles: [String], noun: String) -> String {
    titles.count == 1 ? "\u{201C}\(titles[0])\u{201D}" : "\(titles.count) \(noun)s"
  }

  static func quoted(_ text: String) -> String { "\u{201C}\(text)\u{201D}" }

  /// Fails the call with a reference's candidates unless it resolved to one record.
  static func resolved(_ reference: String, kind: String, _ match: ManorTargetMatch) throws -> ManorTargetCandidate {
    if case .one(let candidate) = match { return candidate }
    throw ManorToolArgumentError(ManorTargetMatcher.problem(reference, kind: kind, match: match) ?? "No \(kind) matches \"\(reference)\".")
  }
}
