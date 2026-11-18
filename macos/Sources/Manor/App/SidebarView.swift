import ManorKit
import SwiftUI

struct SidebarView: View {
  /// A floating panel (glass, or the hover overlay) is inset from the window's top edge, so its first row sits at its top.
  var floating = false
  @Environment(AppModel.self) private var model
  @Environment(AppContext.self) private var context

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // The window buttons sit in this row, as in the system sidebar; the toggle lines up with them.
      HStack {
        Spacer()
        IconButton("sidebar.left", label: model.sidebarDocked ? "Hide sidebar" : "Dock sidebar", size: 26) { model.toggleSidebar() }
      }
      // The window buttons are centered in the 52-point toolbar band; the floating panel starts 8 pt down.
      .frame(height: WindowChromeMetrics.toolbarHeight - (floating || GlassSupport.isActive ? Space.s2 * 2 : 0))
      .padding(.trailing, Space.s2)
      .padding(.bottom, Space.s3)

      VStack(spacing: 2) {
        ForEach(Route.modules) { route in item(route) }
      }
      .padding(.horizontal, Space.s2)

      Spacer(minLength: Space.s4)

      if case .ready(let version, _) = model.updater.state {
        Button { Task { await model.restartToUpdate() } } label: {
          HStack(spacing: Space.s2) {
            Image(systemName: "arrow.down.circle.fill").foregroundStyle(Palette.primary)
            VStack(alignment: .leading, spacing: 0) {
              Text("Update ready").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
              Text("Restart for \(version)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
            }
            Spacer(minLength: 0)
          }
          .padding(Space.s2)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.primaryTint.opacity(0.6)))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Space.s2)
        .padding(.bottom, Space.s2)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
      }

      VStack(spacing: 2) {
        item(.settings)
        accountRow
      }
      .padding(.horizontal, Space.s2)
      .padding(.bottom, Space.s3)
    }
    .frame(maxHeight: .infinity)
    // On macOS 26 the panel's glass is the background; earlier systems get the solid sidebar fill.
    .background(GlassSupport.isActive ? Color.clear : Palette.sidebarBackground)
  }

  private func item(_ route: Route) -> some View {
    SidebarRow(route: route, selected: context.route == route, badge: route == .pomodoro ? context.pomodoroBadge : nil) {
      context.navigate(to: route)
    }
  }

  private var accountRow: some View {
    Menu {
      Text(context.account.email)
      Divider()
      Button("Settings") { context.navigate(to: .settings) }
      Button("Sign out") {
        Task {
          if let message = await context.session.signOut() { context.toasts.show(message) }
        }
      }
    } label: {
      HStack(spacing: Space.s2) {
        Text(String(context.account.name.prefix(1)).uppercased())
          .font(.ui(Typography.Size.xs, weight: .semibold))
          .foregroundStyle(Palette.onPrimary)
          .frame(width: 22, height: 22)
          .background(Circle().fill(Palette.primary))
        Text(context.account.name).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody).lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 34)
      .contentShape(Rectangle())
      .modifier(SidebarRowFill(selected: false))
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .accessibilityLabel("Account")
  }
}

/// A sidebar row in the system sidebar's anatomy: an accent-tinted symbol, the title, and a neutral pill when
/// selected (hovered rows get a quieter one).
private struct SidebarRow: View {
  let route: Route
  let selected: Bool
  let badge: (text: String, paused: Bool)?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: Space.s2 + 2) {
        Image(systemName: route.systemImage)
          .font(.system(size: 15, weight: .regular))
          .foregroundStyle(Palette.primary)
          .frame(width: 22)
        Text(route.title)
          .font(.ui(Typography.Size.body, weight: selected ? .semibold : .regular))
          .foregroundStyle(Palette.ink)
        Spacer(minLength: 0)
        if let badge {
          Text(badge.text)
            .font(.ui(Typography.Size.xs, weight: .semibold)).tabular()
            .foregroundStyle(badge.paused ? Palette.inkMuted : Palette.primary)
            .padding(.horizontal, 6).frame(height: 20)
            .background(Capsule().fill(badge.paused ? Palette.surfaceSoft : Palette.primaryTint))
            .accessibilityLabel("\(badge.text) \(badge.paused ? "paused" : "remaining")")
        }
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 32)
      .contentShape(Rectangle())
      .modifier(SidebarRowFill(selected: selected))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

private struct SidebarRowFill: ViewModifier {
  let selected: Bool
  @State private var hovering = false

  func body(content: Content) -> some View {
    content
      .background(
        RoundedRectangle(cornerRadius: Radius.control + 2, style: .continuous)
          .fill(selected ? Palette.sidebarSelection : hovering ? Palette.sidebarRowHover : .clear)
      )
      .onHover { hovering = $0 }
      .animation(Motion.fast, value: hovering)
  }
}
