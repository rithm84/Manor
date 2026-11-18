import ManorKit
import SwiftUI

struct SidebarView: View {
  /// A floating panel (glass, or the hover overlay) starts below the window buttons, so its content sits near its top.
  var floating = false
  @Environment(AppModel.self) private var model
  @Environment(AppContext.self) private var context

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: Space.s2) {
        ManorLogo(width: 22)
        Text("Manor").font(.display(Typography.Size.lg)).foregroundStyle(Palette.ink)
        Spacer()
        IconButton("sidebar.left", label: model.sidebarDocked ? "Hide sidebar" : "Dock sidebar", size: 26) { model.toggleSidebar() }
      }
      .padding(.leading, Space.s3)
      .padding(.trailing, Space.s2)
      // Clears the window buttons; in full screen they are hidden, so the brand moves up.
      // Inside the glass panel the brand sits near its top edge; the solid sidebar clears the window buttons.
      .padding(.top, model.isFullScreen || floating ? Space.s3 : 38)
      .animation(Motion.base, value: model.isFullScreen)
      .padding(.bottom, Space.s4)

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
    let selected = context.route == route
    return Button { context.navigate(to: route) } label: {
      HStack(spacing: Space.s2 + 2) {
        Image(systemName: route.systemImage)
          .font(.system(size: 13, weight: selected ? .semibold : .regular))
          .frame(width: 18)
          .foregroundStyle(selected ? Palette.primary : Palette.inkMuted)
        Text(route.title)
          .font(.ui(Typography.Size.body, weight: selected ? .semibold : .regular))
          .foregroundStyle(selected ? Palette.ink : Palette.inkBody)
        Spacer(minLength: 0)
        if route == .pomodoro, let badge = context.pomodoroBadge {
          Text(badge.text)
            .font(.ui(Typography.Size.xs, weight: .semibold)).tabular()
            .foregroundStyle(badge.paused ? Palette.inkMuted : Palette.primary)
            .padding(.horizontal, 6).frame(height: 20)
            .background(Capsule().fill(badge.paused ? Palette.surfaceSoft : Palette.primaryTint))
            .accessibilityLabel("\(badge.text) \(badge.paused ? "paused" : "remaining")")
        }
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .contentShape(Rectangle())
      .rowBackground(selected: selected)
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
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
      .rowBackground()
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .accessibilityLabel("Account")
  }
}
