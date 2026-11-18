import AppKit
import ManorKit
import SwiftUI

/// Sectioned settings: the section list on the left and one section at a time on the right.
struct SettingsPage: View {
  @Environment(AppContext.self) private var context
  @State private var store = SettingsStore()

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Settings")
      HStack(alignment: .top, spacing: Space.s8) {
        nav
        ScrollView {
          content
            .frame(maxWidth: 640, alignment: .leading)
            .padding(.bottom, Space.s12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .id(store.section)
      }
      .padding(.horizontal, Space.s8)
    }
    .overlayPreferenceValue(SettingsDialogKey.self) { SettingsDialogHost(layers: $0) }
    .onAppear { store.attach(context) }
    .onChange(of: settingsLinkQuery, initial: true) { _, query in
      guard let query, let callback = SettingsDomain.connectionCallback(from: query) else { return }
      // The returned code is single use, so the link is cleared before it is spent.
      context.linkTarget = nil
      store.attach(context)
      Task { await store.handleCallback(callback) }
    }
    .onChange(of: settingsLinkSection, initial: true) { _, section in
      // A link that names a section (`manor://settings/connections`) opens it.
      guard let section else { return }
      context.linkTarget = nil
      store.section = section
    }
  }

  private var settingsLinkSection: SettingsStore.Section? {
    guard let target = context.linkTarget, target.route == .settings, target.query.isEmpty, let name = target.path.first else { return nil }
    return SettingsStore.Section(rawValue: name)
  }

  private var settingsLinkQuery: [String: String]? {
    guard let target = context.linkTarget, target.route == .settings else { return nil }
    return target.query
  }

  private var nav: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(SettingsStore.Section.allCases) { section in
        let selected = store.section == section
        Button { withAnimation(Motion.fast) { store.section = section } } label: {
          HStack(spacing: Space.s2) {
            Image(systemName: section.systemImage)
              .font(.system(size: 13, weight: .medium))
              .frame(width: 18)
            Text(section.title)
              .font(.ui(Typography.Size.body, weight: selected ? .semibold : .medium))
            Spacer(minLength: 0)
          }
          .foregroundStyle(selected ? Palette.ink : Palette.inkMuted)
          .padding(.horizontal, Space.s2)
          .frame(height: 30)
          .contentShape(Rectangle())
          .rowBackground(selected: selected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .frame(width: 184)
  }

  @ViewBuilder
  private var content: some View {
    switch store.section {
    case .account: SettingsAccountSection(store: store)
    case .appearance: SettingsAppearanceSection()
    case .connections: SettingsConnectionsSection(store: store)
    case .alfred: AlfredSettingsSection()
    case .shortcuts: SettingsShortcutsSection()
    case .about: SettingsAboutSection()
    }
  }
}

struct SettingsSectionTitle: View {
  let title: String
  var body: some View {
    Text(title).font(.display(Typography.Size.lg)).foregroundStyle(Palette.ink)
  }
}

// MARK: Appearance

struct SettingsAppearanceSection: View {
  @Environment(ThemeController.self) private var theme
  @Environment(AppModel.self) private var model
  @AppStorage("manor.sounds.enabled") private var sounds = true

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      SettingsSectionTitle(title: "Appearance")
      SettingsCard {
        SettingsRow("Theme", description: "Day and night is light from 6 AM to 6 PM.") {
          SegmentedTabs(ThemePreference.allCases.map { ($0, $0.label) }, selection: Binding(get: { theme.preference }, set: { theme.set($0) }))
        }
        SettingsRow("Sounds", description: "A soft tick when you check something off.") {
          Toggle("Completion sounds", isOn: $sounds).toggleStyle(.switch).labelsHidden().tint(Palette.primary)
        }
        SettingsRow("Sidebar", description: "Collapsed shows it when you point at the left edge.") {
          SegmentedTabs([(true, "Docked"), (false, "Collapsed")], selection: Binding(
            get: { model.sidebarDocked },
            set: { docked in if docked != model.sidebarDocked { model.toggleSidebar() } }
          ))
        }
      }
    }
  }
}

// MARK: Keyboard shortcuts

struct SettingsShortcutsSection: View {
  private struct Shortcut: Identifiable {
    let keys: [String]
    let label: String
    var id: String { keys.joined() + label }
  }

  private var groups: [(title: String, rows: [Shortcut])] {
    let pages = Route.modules.prefix(9).enumerated().map { index, route in Shortcut(keys: ["⌘", "\(index + 1)"], label: route.title) }
    return [
      ("Everywhere", [
        Shortcut(keys: ["⌘", "\\"], label: "Hide or dock the sidebar"),
        Shortcut(keys: ["⌘", "N"], label: "New task, habit, role, or note on Home, Tracking, Jobs, and Notes"),
        Shortcut(keys: ["⌘", ","], label: "Open Settings"),
        Shortcut(keys: ["Esc"], label: "Clear a search field, then close the topmost menu or dialog")
      ]),
      ("Pages", pages),
      ("Home", [
        Shortcut(keys: ["⌘", "Z"], label: "Undo the last completion or deletion"),
        Shortcut(keys: ["Return"], label: "Create or save the task in an open task dialog")
      ]),
      ("History views", [
        Shortcut(keys: ["←", "→"], label: "Previous or next month while the month stepper has focus"),
        Shortcut(keys: ["←", "→"], label: "Move a habit tile while its grip has focus")
      ]),
      ("Pomodoro", [
        Shortcut(keys: ["Space"], label: "Start, pause, or resume the timer"),
        Shortcut(keys: ["Return"], label: "Start a focus session from the label field")
      ]),
      ("Notes", [
        Shortcut(keys: ["⌘", "S"], label: "Save the open note now"),
        Shortcut(keys: ["⌘", "⇧", "F"], label: "Search notes")
      ])
    ]
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s5) {
      SettingsSectionTitle(title: "Keyboard shortcuts")
      ForEach(groups, id: \.title) { group in
        SettingsCard(group.title) {
          ForEach(group.rows) { row in
            HStack(spacing: Space.s4) {
              HStack(spacing: 3) { ForEach(row.keys, id: \.self) { KeyCap(key: $0) } }
                .frame(width: 96, alignment: .leading)
              Text(row.label).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody)
                .fixedSize(horizontal: false, vertical: true)
              Spacer(minLength: 0)
            }
            .padding(.vertical, Space.s2 + 2)
            .accessibilityElement(children: .combine)
          }
        }
      }
    }
  }
}

// MARK: About

struct SettingsAboutSection: View {
  @Environment(AppContext.self) private var context

  private var version: String {
    let info = Bundle.main.infoDictionary ?? [:]
    let short = info["CFBundleShortVersionString"] as? String
    return short ?? "Development build"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      SettingsSectionTitle(title: "About")
      SettingsCard {
        SettingsRow("Manor", description: context.gateway.config.environment == .staging ? "Staging" : nil) {
          Text(version).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted).tabular().textSelection(.enabled)
        }
      }
    }
  }
}
