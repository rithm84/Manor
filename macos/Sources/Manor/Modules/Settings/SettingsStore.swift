import AppKit
import Foundation
import ManorKit
import Observation

/// Settings state for one signed-in session: the profile, connections, and connected agents. Lives in the
/// page's `@State`, so switching modules and returning keeps the open section and any unsaved name.
@MainActor
@Observable
final class SettingsStore {
  enum Section: String, CaseIterable, Identifiable {
    case account, appearance, connections, alfred, shortcuts, about
    var id: String { rawValue }
    var title: String {
      switch self {
      case .account: return "Account"
      case .appearance: return "Appearance"
      case .connections: return "Connections"
      case .alfred: return "Alfred"
      case .shortcuts: return "Keyboard shortcuts"
      case .about: return "About"
      }
    }
    var systemImage: String {
      switch self {
      case .account: return "person.crop.circle"
      case .appearance: return "circle.lefthalf.filled"
      case .connections: return "link"
      case .alfred: return "sparkles"
      case .shortcuts: return "command"
      case .about: return "info.circle"
      }
    }
  }

  var section: Section = .account

  // Profile
  private(set) var profile: Row?
  var nameDraft = ""
  private(set) var savingProfile = false
  var profileError: String?
  private(set) var avatarURL: URL?
  private(set) var avatarBusy = false
  var avatarError: String?
  var signOutError: String?
  private(set) var signingOut = false

  // Connections
  private(set) var loadedConnections = false
  private(set) var calendarAccounts: [SettingsDomain.CalendarAccount] = []
  private(set) var calendars: [SettingsDomain.Calendar] = []
  private(set) var xStatus: SettingsDomain.XConnectionStatus?
  private(set) var courseFeed: SettingsDomain.CourseFeedStatus?
  var feedDraft = ""
  private(set) var busy = false
  var connectionError: String?
  var connectionNotice: String?

  // Agents
  private(set) var agents: [SettingsDomain.AgentConnection]?
  var agentError: String?
  private(set) var revoking: String?

  @ObservationIgnored private var watcher: Task<Void, Never>?
  @ObservationIgnored private var calendarPoll: Task<Void, Never>?
  @ObservationIgnored private(set) var context: AppContext?

  var integrations: SettingsIntegrations? { context.map { SettingsIntegrations(gateway: $0.gateway) } }

  func attach(_ context: AppContext) {
    guard self.context !== context else { return }
    self.context = context
    watcher?.cancel()
    watcher = Task { [weak self] in
      await self?.loadProfile()
      guard let stream = self?.context?.gateway.changes(of: ["profiles", "calendar_accounts", "calendars"]) else { return }
      for await tables in stream {
        guard let self else { return }
        if tables.contains("profiles") { await self.loadProfile() }
        if !tables.isDisjoint(with: ["calendar_accounts", "calendars"]) { await self.loadCalendars() }
      }
    }
  }

  deinit {
    watcher?.cancel()
    calendarPoll?.cancel()
  }

  // MARK: Profile

  var savedName: String { profile?["name"]?.string ?? context?.account.name ?? "" }
  var savedTimeZone: String { profile?["timezone"]?.string ?? context?.account.timezone ?? TimeZone.current.identifier }
  var nameDirty: Bool { nameDraft.trimmingCharacters(in: .whitespacesAndNewlines) != savedName }

  func loadProfile() async {
    guard let context else { return }
    do {
      let previousName = savedName
      profile = try await context.gateway.rows("profiles").first
      if nameDraft.isEmpty || nameDraft == previousName { nameDraft = savedName }
      await loadAvatar()
    } catch {
      profileError = error.localizedDescription
    }
  }

  private func loadAvatar() async {
    guard let context, !avatarBusy else { return }
    avatarURL = try? await AvatarService(gateway: context.gateway).currentURL(settings: profile?["settings"])
  }

  /// Saves the display name and time zone together; the settings object travels unchanged.
  func saveProfile(name: String? = nil, timezone: String? = nil) async {
    guard let context, !savingProfile else { return }
    let nextName = (name ?? nameDraft).trimmingCharacters(in: .whitespacesAndNewlines)
    if let problem = SettingsDomain.nameProblem(nextName) { profileError = problem; return }
    let nextZone = timezone ?? savedTimeZone
    savingProfile = true
    profileError = nil
    defer { savingProfile = false }
    do {
      let input = SettingsDomain.profileInput(name: nextName, timezone: nextZone, settings: profile?["settings"], revision: profile?.revision)
      let receipt = try await context.gateway.command("save_profile", input)
      if let record = receipt.record { profile = record }
      nameDraft = nextName
      context.session.updateAccount { account in
        account.name = nextName
        account.timezone = nextZone
      }
    } catch let error as ManorRequestError where error.isConflict {
      profileError = "Your profile changed on another device. Review it and save again."
      await loadProfile()
      nameDraft = savedName
    } catch {
      profileError = error.localizedDescription
    }
  }

  func uploadAvatar(_ jpeg: Data) async -> Bool {
    guard let context else { return false }
    avatarBusy = true
    avatarError = nil
    defer { avatarBusy = false }
    do {
      avatarURL = try await AvatarService(gateway: context.gateway).upload(jpeg: jpeg) ?? avatarURL
      return true
    } catch {
      avatarError = error.localizedDescription
      return false
    }
  }

  func signOut() async {
    guard let context, !signingOut else { return }
    signingOut = true
    signOutError = nil
    if let message = await context.session.signOut() { signOutError = message }
    signingOut = false
  }

  // MARK: Connections

  func loadConnections() async {
    guard let integrations else { return }
    await loadCalendars()
    do { xStatus = try await integrations.xStatus() } catch { connectionError = error.localizedDescription }
    do { courseFeed = try await integrations.courseFeedStatus() } catch { connectionError = error.localizedDescription }
    loadedConnections = true
  }

  func loadCalendars() async {
    guard let context else { return }
    do {
      calendarAccounts = SettingsDomain.calendarAccounts(from: try await context.gateway.rows("calendar_accounts"))
      calendars = SettingsDomain.calendars(from: try await context.gateway.rows("calendars"))
    } catch {
      connectionError = "Could not refresh calendars: \(error.localizedDescription)"
    }
  }

  func calendars(for account: SettingsDomain.CalendarAccount) -> [SettingsDomain.Calendar] {
    calendars.filter { $0.accountId == account.id }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
  }

  /// Runs one connection change, then refreshes what it touched.
  func run(_ action: @escaping (SettingsIntegrations) async throws -> Void) async {
    guard let integrations, !busy else { return }
    busy = true
    connectionError = nil
    defer { busy = false }
    do {
      try await action(integrations)
      await loadConnections()
    } catch {
      connectionError = error.localizedDescription
    }
  }

  func connect(provider: String) async {
    await run { [weak self] integrations in
      let url = try await integrations.connect(provider: provider)
      self?.connectionNotice = nil
      self?.context?.openExternal(url)
    }
  }

  /// Finishes a connection that came back from the provider on a `settings` deep link.
  func handleCallback(_ callback: SettingsDomain.ConnectionCallback) async {
    section = .connections
    switch callback {
    case .failure(let message):
      connectionError = message
    case .code(_, let code, let state):
      await run { integrations in try await integrations.completeConnection(code: code, state: state) }
      if connectionError == nil {
        connectionNotice = "Account connected. Your content will appear as it syncs."
        pollCalendars()
      }
    }
  }

  /// Calendars of a new account arrive from a background sync shortly after it connects.
  private func pollCalendars() {
    calendarPoll?.cancel()
    calendarPoll = Task { [weak self] in
      for _ in 0..<10 {
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled, let self else { return }
        await self.context?.gateway.afterServerWrite(tables: SettingsIntegrations.calendarTables)
        await self.loadCalendars()
      }
    }
  }

  func setCalendar(_ calendar: SettingsDomain.Calendar, enabled: Bool) async {
    if let index = calendars.firstIndex(of: calendar) { calendars[index].enabled = enabled }
    await run { integrations in try await integrations.setCalendar(calendar.id, account: calendar.accountId, enabled: enabled) }
    if connectionError != nil { await loadCalendars() }
  }

  func syncX() async {
    await run { [weak self] integrations in
      let added = try await integrations.syncX()
      self?.connectionNotice = SettingsDomain.syncSummary(added: added)
    }
  }

  func saveFeed() async {
    guard let link = SettingsDomain.validFeedLink(feedDraft) else {
      connectionError = "Paste the full calendar feed link, starting with https."
      return
    }
    await run { [weak self] integrations in
      let result = try await integrations.connectCourseFeed(link)
      self?.feedDraft = ""
      self?.connectionNotice = SettingsDomain.courseFeedConnected(host: result.host, count: result.count)
    }
  }

  func checkFeed() async {
    await run { [weak self] integrations in
      let result = try await integrations.checkCourseFeed()
      self?.connectionNotice = SettingsDomain.courseFeedChecked(total: result.total, from: Self.dayLabel(result.from), to: Self.dayLabel(result.to))
    }
  }

  private static func dayLabel(_ value: String) -> String {
    guard let date = LocalDate.date(from: String(value.prefix(10)), in: .gmt) else { return value }
    return DisplayDates.string(date, "MMM d", timeZone: .gmt)
  }

  // MARK: Agents

  func loadAgents() async {
    guard let context else { return }
    do {
      agents = try SettingsDomain.agentConnections(from: try await context.gateway.rpc("manor_list_mcp_clients"))
      agentError = nil
    } catch {
      agentError = error.localizedDescription
    }
  }

  func revoke(_ connection: SettingsDomain.AgentConnection) async {
    guard let context, revoking == nil else { return }
    revoking = connection.clientId
    agentError = nil
    defer { revoking = nil }
    do {
      try await context.gateway.rpc("manor_revoke_mcp_client", ["p_client_id": .string(connection.clientId)])
      await loadAgents()
    } catch {
      agentError = error.localizedDescription
    }
  }
}
