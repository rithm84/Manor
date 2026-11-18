import Alfred
import Foundation
import ManorKit

// Pomodoro: the session commands the Pomodoro store sends. The store watches `pomodoro_sessions`, so the timer,
// the sidebar countdown, and completion pick up a change made here at once.

extension ManorAlfredToolbox {
  struct PomodoroData {
    var sessions: [PomodoroSession]
    var settings: PomodoroSettings
    var active: PomodoroSession? { Pomodoro.activeSession(sessions) }
  }

  func loadPomodoro() async throws -> PomodoroData {
    async let sessionRows = gateway.rows("pomodoro_sessions")
    async let profileRows = gateway.rows("profiles")
    let (rows, profiles) = try await (sessionRows, profileRows)
    let settings = try PomodoroSettings(stored: profiles.first?["settings"]?["pomodoro"])
    let sessions = try rows.map(PomodoroSession.init(row:)).sorted { $0.startedAt > $1.startedAt }
    return PomodoroData(sessions: sessions, settings: settings)
  }

  static func sessionName(_ session: PomodoroSession) -> String {
    let name = session.kind == .focus ? "focus session" : session.kind.label.lowercased()
    return session.label.map { "\(name) \(quoted($0))" } ?? name
  }

  static func minutesText(_ seconds: Int) -> String {
    let minutes = max(1, Int((Double(seconds) / 60).rounded()))
    return "\(minutes) minute\(minutes == 1 ? "" : "s")"
  }

  func startPomodoro(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorPomodoroStartArgs.parse(arguments)
    let data = try await loadPomodoro()
    if let active = data.active {
      let clock = Pomodoro.clock(active, at: Date())
      throw ManorToolArgumentError("A \(Self.sessionName(active)) is already \(active.status == .paused ? "paused" : "running") with \(Pomodoro.formatClock(clock.remainingSeconds)) left. Stop it before starting another.")
    }
    let id = UUID().uuidString.lowercased()
    let planned = args.minutes.map { $0 * 60 } ?? data.settings.plannedSeconds(args.kind)
    let label = args.kind == .focus ? args.label : nil
    try await gateway.command("start_pomodoro_session", PomodoroCommands.start(id: id, kind: args.kind, plannedSeconds: planned, label: label))
    let length = "\(planned / 60)-minute"
    let summary = args.kind == .focus
      ? "Started a \(length) focus session\(label.map { " for \(Self.quoted($0))" } ?? "")"
      : "Started a \(length) \(args.kind.label.lowercased())"
    return .done(summary, output: "\(summary). Session [\(id)].", undo: { [weak self] in
      guard let self else { throw Self.closed }
      guard let session = try await self.loadPomodoro().sessions.first(where: { $0.id == id }) else { return "That session was already removed" }
      try await self.gateway.command("delete_pomodoro_session", PomodoroCommands.session(session))
      return "Removed the \(Self.sessionName(session))"
    })
  }

  func pausePomodoro() async throws -> AlfredToolResult {
    let data = try await loadPomodoro()
    guard let active = data.active else { throw ManorToolArgumentError("No Pomodoro session is running.") }
    guard active.status == .running else { return .done("The \(Self.sessionName(active)) is already paused") }
    try await gateway.command("pause_pomodoro_session", PomodoroCommands.session(active))
    let left = Pomodoro.formatClock(Pomodoro.clock(active, at: Date()).remainingSeconds)
    let id = active.id
    return .done("Paused the \(Self.sessionName(active)) with \(left) left", undo: { [weak self] in
      guard let self else { throw Self.closed }
      guard let session = try await self.loadPomodoro().sessions.first(where: { $0.id == id }), session.status == .paused else {
        return "The session isn't paused anymore"
      }
      try await self.gateway.command("resume_pomodoro_session", PomodoroCommands.session(session))
      return "Resumed the \(Self.sessionName(session))"
    })
  }

  func resumePomodoro() async throws -> AlfredToolResult {
    let data = try await loadPomodoro()
    guard let active = data.active else { throw ManorToolArgumentError("No Pomodoro session is paused.") }
    guard active.status == .paused else { return .done("The \(Self.sessionName(active)) is already running") }
    try await gateway.command("resume_pomodoro_session", PomodoroCommands.session(active))
    let id = active.id
    return .done("Resumed the \(Self.sessionName(active))", undo: { [weak self] in
      guard let self else { throw Self.closed }
      guard let session = try await self.loadPomodoro().sessions.first(where: { $0.id == id }), session.status == .running else {
        return "The session isn't running anymore"
      }
      try await self.gateway.command("pause_pomodoro_session", PomodoroCommands.session(session))
      return "Paused the \(Self.sessionName(session))"
    })
  }

  /// Stops early: the focused time is kept and the session reads as stopped. There's no inverse.
  func stopPomodoro() async throws -> AlfredToolResult {
    let data = try await loadPomodoro()
    guard let active = data.active else { throw ManorToolArgumentError("No Pomodoro session is running.") }
    try await gateway.command("end_pomodoro_session", PomodoroCommands.end(active, completed: false))
    let focused = Pomodoro.clock(active, at: Date()).elapsedSeconds
    return .done("Stopped the \(Self.sessionName(active)) after \(Self.minutesText(focused))")
  }

  // MARK: Snapshot

  func pomodoroSnapshot() async -> [String] {
    do {
      let data = try await loadPomodoro()
      let completed = Pomodoro.completedFocus(data.sessions, on: today)
      var lines: [String] = []
      if let active = data.active {
        let clock = Pomodoro.clock(active, at: Date())
        lines.append("Timer: \(active.kind.label)\(active.label.map { " \(Self.quoted($0))" } ?? ""), \(active.status == .paused ? "paused" : "running"), \(Pomodoro.formatClock(clock.remainingSeconds)) left of \(Self.minutesText(active.plannedSeconds)). Session [\(active.id)].")
      } else {
        lines.append("Timer: idle. Focus is \(data.settings.focusMinutes) minutes, short break \(data.settings.shortBreakMinutes), long break \(data.settings.longBreakMinutes).")
      }
      lines.append("Completed focus sessions today: \(completed).")
      return lines
    } catch {
      return ["The timer couldn't be read: \(error.localizedDescription)"]
    }
  }
}
