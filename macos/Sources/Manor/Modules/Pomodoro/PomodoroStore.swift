import AppKit
import Foundation
import ManorKit
import Observation

/// Where the timer stands, as the stage draws it.
enum PomodoroPhase: Equatable { case idle, running, paused, ended }

/// The Pomodoro clock for the whole app: loads sessions and preferences, ticks on the second while a
/// session runs, records completion the moment the plan runs out (the server holds the clock), chimes,
/// offers or auto-starts the next step, and keeps the sidebar countdown current, whichever page is open.
@MainActor
@Observable
final class PomodoroStore {
  private(set) var sessions: [PomodoroSession] = []
  private(set) var settings = PomodoroSettings.defaults
  private(set) var today = ""
  private(set) var loaded = false
  var error: String?
  /// Whether a write is in flight.
  private(set) var busy = false
  /// The instant the clock last ticked. Only the stage reads it, so a tick redraws the ring and nothing else.
  private(set) var now = Date()
  /// The session whose time just ran out, held until the next step is chosen or another session starts.
  private(set) var ended: PomodoroSession?
  /// The label typed before starting, kept across module switches and used by the Space shortcut.
  var draftLabel = ""
  /// Open Pomodoro dialogs; Space leaves the timer alone while one is up.
  var openDialogs = 0

  @ObservationIgnored private var settingsRevision = 0
  @ObservationIgnored private weak var context: AppContext?
  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var tail: Task<Void, Never>?
  @ObservationIgnored private var completing: String?
  @ObservationIgnored private var autoStarted: String?
  @ObservationIgnored private var autoStart: Task<Void, Never>?
  @ObservationIgnored private var inFlight = 0

  var active: PomodoroSession? { Pomodoro.activeSession(sessions) }
  var timeZone: TimeZone { context?.timeZone ?? .current }

  var clock: PomodoroClock? { active.map { Pomodoro.clock($0, at: now) } }

  var phase: PomodoroPhase {
    if let active { return active.status == .paused ? .paused : .running }
    return ended == nil ? .idle : .ended
  }

  /// What the ended session leads to; focus when nothing ended.
  var next: PomodoroKind {
    guard let ended else { return .focus }
    return Pomodoro.nextKind(after: ended, sessions: sessions, settings: settings)
  }

  var completedToday: Int { Pomodoro.completedFocus(sessions, on: today) }

  // MARK: Lifecycle

  func run(context: AppContext) async {
    self.context = context
    await load()
    let changes = context.gateway.changes(of: ["pomodoro_sessions", "profiles"])
    await withTaskGroup(of: Void.self) { group in
      group.addTask { @MainActor [weak self] in
        for await _ in changes { await self?.load() }
      }
      group.addTask { @MainActor [weak self] in
        // A Mac waking from sleep resumes mid-session; tick at once rather than on the next second.
        for await _ in NSWorkspace.shared.notificationCenter.notifications(named: NSWorkspace.didWakeNotification) {
          self?.tick()
        }
      }
    }
    stop()
  }

  func stop() {
    ticker?.cancel()
    ticker = nil
    autoStart?.cancel()
    context?.pomodoroBadge = nil
  }

  func load() async {
    guard let context else { return }
    do {
      async let sessionRows = context.gateway.rows("pomodoro_sessions")
      async let profileRows = context.gateway.rows("profiles")
      let (rows, profiles) = try await (sessionRows, profileRows)
      guard profiles.count == 1, let profile = profiles.first else {
        throw ManorRequestError(operation: "Read profiles", code: "profile", detail: "The account profile is missing. Complete account setup before opening Manor.")
      }
      let parsed = try rows.map(PomodoroSession.init(row:)).sorted { $0.startedAt > $1.startedAt }
      settings = try PomodoroSettings(stored: profile["settings"]?["pomodoro"])
      settingsRevision = profile.revision ?? 0
      sessions = parsed
      today = context.today
      loaded = true
      error = nil
      // A session started elsewhere clears the finished stage.
      if active != nil, ended != nil { ended = nil }
      updateTicker()
    } catch {
      self.error = error.localizedDescription
      if !loaded { loaded = true }
    }
  }

  // MARK: Clock

  private func updateTicker() {
    let running = active?.status == .running
    if running, ticker == nil {
      ticker = Task { @MainActor [weak self] in
        while !Task.isCancelled {
          // Land on the boundary the clock digits change on.
          let fraction = Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1)
          try? await Task.sleep(for: .milliseconds(Int((1 - fraction) * 1000) + 5))
          guard !Task.isCancelled else { return }
          self?.tick()
        }
      }
    } else if !running {
      ticker?.cancel()
      ticker = nil
    }
    tick()
  }

  /// Advances the clock, refreshes the sidebar countdown, and completes a session whose plan ran out.
  func tick() {
    now = Date()
    if context?.today != today, let day = context?.today { today = day }
    let badge: (text: String, paused: Bool)?
    if let active, let clock {
      badge = (Pomodoro.formatClock(clock.remainingSeconds), active.status == .paused)
      if active.status == .running, clock.due { complete(active) }
    } else {
      badge = nil
    }
    if context?.pomodoroBadge?.text != badge?.text || context?.pomodoroBadge?.paused != badge?.paused {
      context?.pomodoroBadge = badge
    }
  }

  private func complete(_ session: PomodoroSession) {
    guard completing != session.id, let context else { return }
    completing = session.id
    let id = session.id
    let kind = session.kind
    Task { @MainActor in
      do {
        try await self.serialized {
          guard let current = self.sessions.first(where: { $0.id == id }), current.isActive else { return }
          _ = try await context.gateway.command("end_pomodoro_session", PomodoroCommands.end(current, completed: true))
          await self.load()
        }
        if let finished = self.sessions.first(where: { $0.id == id }), finished.isFinished {
          self.ended = finished
          PomodoroSound.playChime(kind == .focus ? .focus : .rest)
          self.scheduleAutoStart()
        }
      } catch {
        // The server's clock may be a moment behind; try again shortly rather than giving up.
        try? await Task.sleep(for: .seconds(3))
        self.completing = nil
        self.tick()
      }
    }
  }

  /// Preferences can start the next session on their own once the finished ring has had its beat.
  private func scheduleAutoStart() {
    guard let ended, active == nil, autoStarted != ended.id else { return }
    let next = self.next
    guard next == .focus ? settings.autoStartFocus : settings.autoStartBreaks else { return }
    autoStarted = ended.id
    autoStart?.cancel()
    autoStart = Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(1200))
      guard !Task.isCancelled, self.ended?.id == ended.id, self.active == nil else { return }
      if await self.start(next, label: nil, failure: "Could not start the next session") { self.ended = nil }
    }
  }

  // MARK: Actions

  func acknowledge() {
    autoStart?.cancel()
    ended = nil
  }

  /// Starts a session. Only one runs or is paused at a time.
  @discardableResult
  func start(_ kind: PomodoroKind, label: String?, failure: String = "Could not start the session") async -> Bool {
    await write(failure) {
      if self.active != nil { throw PomodoroValidationError("A session is already in progress") }
      let label = try parsePomodoroLabel(label)
      return ("start_pomodoro_session", PomodoroCommands.start(id: UUID().uuidString.lowercased(), kind: kind, plannedSeconds: self.settings.plannedSeconds(kind), label: label))
    }
  }

  func startFocusFromDraft() {
    let label = draftLabel
    acknowledge()
    Task {
      if await start(.focus, label: label) { draftLabel = "" }
    }
  }

  func startNext() {
    let next = self.next
    acknowledge()
    Task { await start(next, label: nil) }
  }

  func pause() { sessionWrite("pause_pomodoro_session", failure: "Could not pause") { PomodoroCommands.session($0) } }
  func resume() { sessionWrite("resume_pomodoro_session", failure: "Could not resume") { PomodoroCommands.session($0) } }
  func stopEarly() { sessionWrite("end_pomodoro_session", failure: "Could not stop the session") { PomodoroCommands.end($0, completed: false) } }

  func relabel(_ id: String, label: String?) {
    Task {
      await write("Could not save the label") {
        let parsed = try parsePomodoroLabel(label)
        return ("update_pomodoro_session", PomodoroCommands.relabel(try self.session(id), label: parsed))
      }
    }
  }

  func remove(_ id: String) {
    Task {
      await write("Could not delete the session") { ("delete_pomodoro_session", PomodoroCommands.session(try self.session(id))) }
    }
  }

  func saveSettings(_ draft: PomodoroSettings) async -> Bool {
    let patch = PomodoroSettingsPatch(from: settings, to: draft)
    if patch.isEmpty { return true }
    return await write("Could not save preferences") {
      ("save_pomodoro_settings", PomodoroCommands.saveSettings(try patch.row(), profileRevision: self.settingsRevision))
    }
  }

  /// Space: start focus when idle, pause or resume a session, or take the offered next step.
  func toggleFromKeyboard() {
    guard !busy else { return }
    switch phase {
    case .running: pause()
    case .paused: resume()
    case .idle: startFocusFromDraft()
    case .ended: startNext()
    }
  }

  private func sessionWrite(_ operation: String, failure: String, input: @escaping (PomodoroSession) -> JSONObject) {
    guard let id = active?.id else { return }
    Task { await write(failure) { (operation, input(try self.session(id))) } }
  }

  private func session(_ id: String) throws -> PomodoroSession {
    guard let session = sessions.first(where: { $0.id == id }) else { throw PomodoroValidationError("This session is no longer available") }
    return session
  }

  /// Runs a command after every earlier write; its input is built when it runs, from the revision the write
  /// before it committed. A failure shows on the page.
  @discardableResult
  private func write(_ failure: String, _ input: @escaping () throws -> (String, JSONObject)) async -> Bool {
    guard let context else { return false }
    inFlight += 1
    busy = true
    defer {
      inFlight -= 1
      busy = inFlight > 0
    }
    do {
      try await serialized {
        let (operation, payload) = try input()
        _ = try await context.gateway.command(operation, payload)
        await self.load()
      }
      error = nil
      return true
    } catch {
      self.error = "\(failure): \(error.localizedDescription)"
      return false
    }
  }

  private func serialized(_ work: @escaping @MainActor () async throws -> Void) async throws {
    let previous = tail
    let task = Task { @MainActor () throws -> Void in
      await previous?.value
      try await work()
    }
    tail = Task { _ = try? await task.value }
    try await task.value
  }

  #if DEBUG
  /// Seeds the store for previews and design snapshots; never called by the app.
  func preview(sessions: [PomodoroSession], settings: PomodoroSettings = .defaults, today: String, now: Date, ended: PomodoroSession? = nil) {
    self.sessions = sessions.sorted { $0.startedAt > $1.startedAt }
    self.settings = settings
    self.today = today
    self.now = now
    self.ended = ended
    loaded = true
  }
  #endif
}
