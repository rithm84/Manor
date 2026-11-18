import Observation
import SwiftUI

// MARK: Centered dialogs

/// Object details are centered dialogs over the page: never sheets, drawers, or side panels. The page
/// dims behind a backdrop, Escape and a backdrop click dismiss, and the panel springs in.
public struct ManorDialog<Panel: View>: ViewModifier {
  @Binding var isPresented: Bool
  let width: CGFloat
  let onDismiss: (() -> Void)?
  @ViewBuilder let panel: () -> Panel

  public func body(content: Content) -> some View {
    // The page behind an open dialog is inert: Tab stays inside the panel instead of walking the page.
    content.disabled(isPresented).overlay {
      ZStack {
        if isPresented {
          Palette.overlayBackdrop
            .ignoresSafeArea()
            .transition(.opacity)
            .onTapGesture { dismiss() }
            .accessibilityHidden(true)
          GeometryReader { space in
            CappedHeight(cap: min(720, space.size.height - Space.s8 * 2)) { panel() }
              .frame(width: min(width, space.size.width - Space.s8 * 2))
            .background(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).fill(Palette.surfaceCard))
            .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
            .shadow(color: .black.opacity(0.14), radius: 30, y: 14)
            .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
          .transition(.scale(scale: 0.96).combined(with: .opacity))
          .onExitCommand { dismiss() }
          .accessibilityAddTraits(.isModal)
          .onAppear { DialogPresence.shared.openCount += 1 }
          .onDisappear { DialogPresence.shared.openCount -= 1 }
        }
      }
      .animation(Motion.panel, value: isPresented)
    }
  }

  private func dismiss() {
    if let onDismiss { onDismiss() } else { isPresented = false }
  }
}

public extension View {
  /// Presents a centered dialog. `onDismiss` replaces the default close (for example to commit a draft first).
  func manorDialog<Panel: View>(isPresented: Binding<Bool>, width: CGFloat = 560, onDismiss: (() -> Void)? = nil, @ViewBuilder panel: @escaping () -> Panel) -> some View {
    modifier(ManorDialog(isPresented: isPresented, width: width, onDismiss: onDismiss, panel: panel))
  }

  /// Presents a centered dialog for an optional item.
  func manorDialog<Item, Panel: View>(item: Binding<Item?>, width: CGFloat = 560, onDismiss: (() -> Void)? = nil, @ViewBuilder panel: @escaping (Item) -> Panel) -> some View {
    let presented = Binding<Bool>(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })
    return modifier(ManorDialog(isPresented: presented, width: width, onDismiss: onDismiss) {
      if let value = item.wrappedValue { panel(value) }
    })
  }
}

/// How many centered dialogs are open anywhere in the window. App-wide shortcuts (Space for Pomodoro)
/// stay out of the way while one is.
@MainActor
@Observable
public final class DialogPresence {
  public static let shared = DialogPresence()
  public fileprivate(set) var openCount = 0
  public var isAnyOpen: Bool { openCount > 0 }
}

public extension View {
  /// For a module's own centered dialog host: counts it as an open dialog so the window's chrome (the sidebar,
  /// app-wide shortcuts) stays out of the way while it shows.
  func countsAsOpenDialog(_ open: Bool) -> some View {
    // The initial call reports the same value twice; later calls only real changes.
    onChange(of: open, initial: true) { was, now in
      if was == now {
        if now { DialogPresence.shared.openCount += 1 }
      } else {
        DialogPresence.shared.openCount += now ? 1 : -1
      }
    }
    .onDisappear { if open { DialogPresence.shared.openCount -= 1 } }
  }
}

/// Sizes a dialog panel to its content's ideal height, capped so it never outgrows the window; content
/// taller than the cap scrolls inside the panel.
struct CappedHeight: SwiftUI.Layout {
  let cap: CGFloat
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let content = subviews.first else { return .zero }
    let ideal = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    return CGSize(width: proposal.width ?? ideal.width, height: min(ideal.height, max(cap, 120)))
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
  }
}

/// A dialog's standard anatomy: title row with close, scrolling body, footer actions.
public struct DialogPanel<Body: View, Footer: View>: View {
  let title: String
  let onClose: () -> Void
  @ViewBuilder let content: () -> Body
  @ViewBuilder let footer: () -> Footer

  public init(_ title: String, onClose: @escaping () -> Void, @ViewBuilder content: @escaping () -> Body, @ViewBuilder footer: @escaping () -> Footer) {
    self.title = title
    self.onClose = onClose
    self.content = content
    self.footer = footer
  }

  public var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(title).font(.dialogTitle).foregroundStyle(Palette.ink)
        Spacer()
        IconButton("xmark", label: "Close", action: onClose)
      }
      .padding(.horizontal, Space.s5)
      .padding(.top, Space.s4)
      .padding(.bottom, Space.s3)
      ScrollView { content().padding(.horizontal, Space.s5).padding(.bottom, Space.s4) }
        .scrollBounceBehavior(.basedOnSize)
      Divider().overlay(Palette.hairline)
      HStack(spacing: Space.s2) { footer() }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, Space.s5)
        .padding(.vertical, Space.s3)
    }
  }
}

public extension DialogPanel where Footer == EmptyView {
  init(_ title: String, onClose: @escaping () -> Void, @ViewBuilder content: @escaping () -> Body) {
    self.init(title, onClose: onClose, content: content, footer: { EmptyView() })
  }
}

/// A short confirmation dialog for destructive or irreversible actions.
public struct ConfirmPanel: View {
  let title: String
  let message: String
  let confirmLabel: String
  let destructive: Bool
  let onCancel: () -> Void
  let onConfirm: () -> Void

  public init(title: String, message: String, confirmLabel: String, destructive: Bool = true, onCancel: @escaping () -> Void, onConfirm: @escaping () -> Void) {
    self.title = title
    self.message = message
    self.confirmLabel = confirmLabel
    self.destructive = destructive
    self.onCancel = onCancel
    self.onConfirm = onConfirm
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      Text(title).font(.dialogTitle).foregroundStyle(Palette.ink)
      Text(message).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody).fixedSize(horizontal: false, vertical: true)
      HStack(spacing: Space.s2) {
        Spacer()
        Button("Cancel", action: onCancel).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
        Button(confirmLabel, action: onConfirm).buttonStyle(destructive ? .danger : .primary).keyboardShortcut(.defaultAction)
      }
      .padding(.top, Space.s2)
    }
    .padding(Space.s5)
  }
}

// MARK: Page anatomy

/// The title row at the top of a module page: title, optional subtitle, and trailing controls.
public struct PageHeader<Trailing: View>: View {
  let title: String
  let subtitle: String?
  @ViewBuilder let trailing: () -> Trailing

  public init(_ title: String, subtitle: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing) {
    self.title = title
    self.subtitle = subtitle
    self.trailing = trailing
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.display(Typography.Size.displayMD)).tracking(-0.4).foregroundStyle(Palette.ink)
        if let subtitle { Text(subtitle).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular() }
      }
      Spacer(minLength: Space.s4)
      HStack(spacing: Space.s2) { trailing() }
    }
    .padding(.horizontal, Space.s8)
    .padding(.top, Space.s6)
    .padding(.bottom, Space.s4)
  }
}

public extension PageHeader where Trailing == EmptyView {
  init(_ title: String, subtitle: String? = nil) { self.init(title, subtitle: subtitle) { EmptyView() } }
}

/// A designed empty state: a quiet symbol, a human sentence, and the one action that fills the space.
public struct EmptyState<Action: View>: View {
  let systemImage: String
  let title: String
  let message: String?
  @ViewBuilder let action: () -> Action

  public init(systemImage: String, title: String, message: String? = nil, @ViewBuilder action: @escaping () -> Action) {
    self.systemImage = systemImage
    self.title = title
    self.message = message
    self.action = action
  }

  public var body: some View {
    VStack(spacing: Space.s3) {
      Image(systemName: systemImage).font(.system(size: 26, weight: .light)).foregroundStyle(Palette.inkMuted)
      Text(title).font(.display(Typography.Size.lg)).foregroundStyle(Palette.ink)
      if let message {
        Text(message).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted).multilineTextAlignment(.center).frame(maxWidth: 340)
      }
      action().padding(.top, Space.s1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(Space.s8)
  }
}

public extension EmptyState where Action == EmptyView {
  init(systemImage: String, title: String, message: String? = nil) {
    self.init(systemImage: systemImage, title: title, message: message) { EmptyView() }
  }
}

/// An inline error with a retry, for loads that failed.
public struct ErrorBanner: View {
  let message: String
  let retry: (() -> Void)?
  public init(_ message: String, retry: (() -> Void)? = nil) {
    self.message = message
    self.retry = retry
  }
  public var body: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.overdueError)
      Text(message).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(3)
      Spacer()
      if let retry { Button("Try again", action: retry).buttonStyle(.manor(.secondary, size: .small)) }
    }
    .padding(Space.s3)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
  }
}

/// A hairline divider in the theme's role color.
public struct Hairline: View {
  public init() {}
  public var body: some View { Rectangle().fill(Palette.hairline).frame(height: 1) }
}
