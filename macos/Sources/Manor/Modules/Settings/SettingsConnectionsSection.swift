import ManorKit
import SwiftUI

/// Google Calendar accounts and their calendars, X bookmarks, the course calendar feed, and connected agents.
struct SettingsConnectionsSection: View {
  @Environment(AppContext.self) private var context
  @Bindable var store: SettingsStore
  @State private var confirm: Confirmation?

  enum Confirmation: Identifiable {
    case calendar(SettingsDomain.CalendarAccount)
    case x
    case feed
    case agent(SettingsDomain.AgentConnection)
    var id: String {
      switch self {
      case .calendar(let account): return "calendar-\(account.id)"
      case .x: return "x"
      case .feed: return "feed"
      case .agent(let agent): return "agent-\(agent.clientId)"
      }
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      SettingsSectionTitle(title: "Connections")
      if let error = store.connectionError {
        SettingsNotice(text: error, failed: true) { store.connectionError = nil }
      } else if let notice = store.connectionNotice {
        SettingsNotice(text: notice) { store.connectionNotice = nil }
      }
      if !store.loadedConnections {
        HStack(spacing: Space.s2) {
          ProgressView().controlSize(.small)
          Text("Loading connections").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        .padding(.vertical, Space.s4)
      } else {
        googleCard
        xCard
        feedCard
      }
      agentsSection.padding(.top, Space.s4)
    }
    .animation(Motion.base, value: store.loadedConnections)
    .task { await store.loadConnections() }
    .task { await store.loadAgents() }
    // The settings column scrolls and clips, so its dialogs are drawn by the page over the whole window area.
    .settingsDialogs(open: confirm != nil) {
      Color.clear.manorDialog(item: $confirm, width: 440) { item in confirmation(item) }
    }
  }

  // MARK: Google Calendar

  private var googleCard: some View {
    let total = store.calendars.count
    let atLimit = total >= SettingsDomain.calendarLimit
    // A card is headed by its service only when its rows do not already name it.
    return SettingsCard(store.calendarAccounts.isEmpty ? nil : "Google Calendar") {
      SettingsRow("Google Calendar", description: store.calendarAccounts.isEmpty
        ? "See your calendars on Home. Your events stay in Google Calendar."
        : "\(SettingsDomain.calendarUsage(total)). Hidden calendars count too.") {
        Button(store.calendarAccounts.isEmpty ? "Connect Google" : "Connect another account") {
          Task { await store.connect(provider: "google") }
        }
        .buttonStyle(.manor(.secondary, size: .small))
        .disabled(store.busy || atLimit)
        .help(atLimit ? "You have reached the twelve-calendar limit." : "Opens Google in your browser")
      }
      ForEach(store.calendarAccounts) { account in
        VStack(alignment: .leading, spacing: 0) {
          SettingsRow(account.email, description: "Connected Google account") {
            Button("Disconnect") { confirm = .calendar(account) }
              .buttonStyle(.manor(.ghost, size: .small))
              .disabled(store.busy)
          }
          let calendars = store.calendars(for: account)
          if calendars.isEmpty {
            HStack(spacing: Space.s2) {
              ProgressView().controlSize(.mini)
              Text("Your calendars appear here as they sync.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
            }
            .padding(.bottom, Space.s3)
          } else {
            VStack(spacing: 0) {
              ForEach(calendars) { calendar in calendarRow(calendar) }
            }
            .padding(.bottom, Space.s2)
          }
        }
      }
    }
  }

  private func calendarRow(_ calendar: SettingsDomain.Calendar) -> some View {
    HStack(spacing: Space.s3) {
      Circle()
        .fill(Self.color(hex: calendar.color) ?? Palette.primary)
        .frame(width: 10, height: 10)
        .opacity(calendar.enabled ? 1 : 0.35)
      Text(calendar.name)
        .font(.ui(Typography.Size.body))
        .foregroundStyle(calendar.enabled ? Palette.ink : Palette.inkMuted)
        .lineLimit(1)
      Spacer()
      Toggle("Show \(calendar.name) on Home", isOn: Binding(
        get: { calendar.enabled },
        set: { enabled in Task { await store.setCalendar(calendar, enabled: enabled) } }
      ))
      .toggleStyle(.switch)
      .controlSize(.small)
      .labelsHidden()
      .tint(Palette.primary)
      .disabled(store.busy)
      .help(calendar.enabled ? "Shown on Home" : "Hidden from Home")
    }
    .padding(.leading, Space.s3)
    .frame(minHeight: 34)
  }

  static func color(hex: String?) -> Color? {
    guard var text = hex?.trimmingCharacters(in: .whitespaces), text.hasPrefix("#") else { return nil }
    text.removeFirst()
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
    return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
  }

  // MARK: X bookmarks

  private var xCard: some View {
    SettingsCard(store.xStatus?.connected == true ? "X bookmarks" : nil) {
      if let status = store.xStatus, status.connected {
        SettingsRow("Connected as @\(status.username ?? "x")", description: "Your bookmarked posts arrive in Bookmarks.") {
          Button("Disconnect") { confirm = .x }
            .buttonStyle(.manor(.ghost, size: .small))
            .disabled(store.busy)
        }
        SettingsRow("Sync bookmarks", description: "Bookmarks are kept even if you disconnect.") {
          Button { Task { await store.syncX() } } label: {
            HStack(spacing: 6) {
              if store.busy { ProgressView().controlSize(.mini) }
              Text("Sync now")
            }
          }
          .buttonStyle(.manor(.secondary, size: .small))
          .disabled(store.busy)
        }
      } else {
        SettingsRow("X bookmarks", description: "Bring your bookmarked posts into your knowledge base.") {
          Button("Connect X") { Task { await store.connect(provider: "x") } }
            .buttonStyle(.manor(.secondary, size: .small))
            .disabled(store.busy)
            .help("Opens X in your browser")
        }
      }
    }
  }

  // MARK: Course calendar

  private var feedCard: some View {
    SettingsCard(store.courseFeed?.connected == true ? "Course calendar" : nil) {
      if let feed = store.courseFeed, feed.connected {
        SettingsRow(feed.host ?? "Course calendar", description: SettingsDomain.courseFeedSummary(feed, timeZone: context.timeZone)) {
          HStack(spacing: Space.s1) {
            Button("Check now") { Task { await store.checkFeed() } }
              .buttonStyle(.manor(.secondary, size: .small))
            Button("Disconnect") { confirm = .feed }
              .buttonStyle(.manor(.ghost, size: .small))
          }
          .disabled(store.busy)
        }
      } else {
        VStack(alignment: .leading, spacing: Space.s3) {
          SettingsRow("Course calendar", description: "Paste the calendar feed link from Canvas (Calendar, then Calendar feed). Your agent reads what is due from it; nothing is imported.")
          HStack(spacing: Space.s2) {
            TextField("https://canvas.example.edu/feeds/calendars/user_….ics", text: $store.feedDraft)
              .textFieldStyle(.manor)
              .onSubmit { Task { await store.saveFeed() } }
              .accessibilityLabel("Course calendar feed link")
            Button("Save") { Task { await store.saveFeed() } }
              .buttonStyle(.manor(.primary, size: .small))
              .disabled(store.busy || store.feedDraft.trimmingCharacters(in: .whitespaces).isEmpty)
          }
          .padding(.bottom, Space.s4)
        }
      }
    }
  }

  // MARK: Agents

  private var agentsSection: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      VStack(alignment: .leading, spacing: 2) {
        SettingsSectionTitle(title: "Connected agents")
        Text("Agents you connect to Manor appear here. Removing access takes effect immediately.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      if let error = store.agentError {
        ErrorBanner(error) { Task { await store.loadAgents() } }
      }
      if let agents = store.agents {
        if agents.isEmpty {
          SettingsCard {
            SettingsRow("No connected agents", description: "When an agent asks for access, you approve it here in Manor.")
          }
        } else {
          SettingsCard {
            ForEach(agents) { agent in
              SettingsRow(agent.canWrite ? "Read and edit access" : "Read access", description: agentDescription(agent)) {
                Button(store.revoking == agent.clientId ? "Removing" : "Remove access") { confirm = .agent(agent) }
                  .buttonStyle(.manor(.ghost, size: .small))
                  .disabled(store.revoking != nil)
              }
            }
          }
        }
      } else if store.agentError == nil {
        HStack(spacing: Space.s2) {
          ProgressView().controlSize(.small)
          Text("Loading agents").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
      }
    }
  }

  private func agentDescription(_ agent: SettingsDomain.AgentConnection) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = context.timeZone
    formatter.dateFormat = "MMM d, yyyy"
    return "Connected \(formatter.string(from: agent.authorizedAt)) · Connection \(agent.clientId.prefix(8))"
  }

  // MARK: Confirmations

  @ViewBuilder
  private func confirmation(_ item: Confirmation) -> some View {
    switch item {
    case .calendar(let account):
      ConfirmPanel(
        title: "Disconnect \(account.email)?",
        message: "Its calendars leave Home. You can connect the account again at any time.",
        confirmLabel: "Disconnect", onCancel: { confirm = nil },
        onConfirm: { confirm = nil; Task { await store.run { try await $0.disconnectCalendar(account: account.id) } } }
      )
    case .x:
      ConfirmPanel(
        title: "Disconnect X?",
        message: "New bookmarks stop arriving. The ones already saved stay in Bookmarks.",
        confirmLabel: "Disconnect", onCancel: { confirm = nil },
        onConfirm: { confirm = nil; Task { await store.run { try await $0.disconnectX() } } }
      )
    case .feed:
      ConfirmPanel(
        title: "Disconnect the course calendar?",
        message: "Your agent stops reading what is due. Paste the feed link again to reconnect.",
        confirmLabel: "Disconnect", onCancel: { confirm = nil },
        onConfirm: { confirm = nil; Task { await store.run { try await $0.disconnectCourseFeed() } } }
      )
    case .agent(let agent):
      ConfirmPanel(
        title: "Remove this agent's access?",
        message: "It can no longer read or change your Manor account. Connect it again from the agent when you need it.",
        confirmLabel: "Remove access", onCancel: { confirm = nil },
        onConfirm: { confirm = nil; Task { await store.revoke(agent) } }
      )
    }
  }
}
