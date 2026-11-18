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
      .background(WindowDragRegion())
      .padding(.trailing, Space.s2)
      .padding(.bottom, Space.s2)

      // The brand, then a breath of space before the modules.
      HStack(spacing: Space.s2) {
        ManorLogo(width: 30)
        Text("Manor").font(.display(Typography.Size.title, weight: .semibold)).tracking(-0.3).foregroundStyle(Palette.ink)
      }
      .padding(.horizontal, Space.s4)
      .padding(.bottom, Space.s6)
      .accessibilityElement(children: .combine)
      .accessibilityLabel("Manor")

      VStack(spacing: 3) {
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
          .frame(width: 24, height: 24)
          .background(Circle().fill(Palette.primary))
        Text(context.account.name).font(.ui(Typography.Size.md)).foregroundStyle(Palette.inkBody).lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 36)
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
      HStack(spacing: Space.s3) {
        Image(systemName: route.systemImage)
          .font(.system(size: 17, weight: .regular))
          .foregroundStyle(Palette.primary)
          .frame(width: 24)
        Text(route.title)
          .font(.ui(Typography.Size.md, weight: selected ? .semibold : .regular))
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
      .frame(height: 36)
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
  @Environment(\.colorSchemeContrast) private var contrast

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: Radius.control + 2, style: .continuous)
    // Increase Contrast swaps the translucent pill for the solid selected surface with an edge.
    let increased = contrast == .increased
    content
      .background(shape.fill(selected ? (increased ? Palette.surfaceSelected : Palette.sidebarSelection)
                                      : hovering ? Palette.sidebarRowHover : .clear))
      .overlay { if selected && increased { shape.strokeBorder(Palette.hairlineStrong, lineWidth: 1) } }
      .onHover { hovering = $0 }
      .animation(Motion.fast, value: hovering)
  }
}
