import SwiftUI

/// A pop-up menu choice that shows a checkmark beside the current value, as macOS menus do. Choosing the
/// current value again keeps it.
public struct CheckedMenuItem: View {
  let title: String
  let selected: Bool
  let action: () -> Void

  public init(_ title: String, selected: Bool, action: @escaping () -> Void) {
    self.title = title
    self.selected = selected
    self.action = action
  }

  @Environment(\.manorMenuRows) private var inManorMenu

  public var body: some View {
    if inManorMenu {
      // In Manor's own menu (a popover), the row carries the checkmark itself.
      Button(action: action) {
        HStack(spacing: Space.s2) {
          Text(title).font(.ui(Typography.Size.sm, weight: selected ? .semibold : .regular))
          Spacer(minLength: Space.s3)
          Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.primary)
            .opacity(selected ? 1 : 0)
        }
      }
      .accessibilityAddTraits(selected ? .isSelected : [])
    } else {
      Toggle(title, isOn: Binding(get: { selected }, set: { _ in action() }))
    }
  }
}

private struct ManorMenuRowsKey: EnvironmentKey { static let defaultValue = false }

public extension EnvironmentValues {
  /// Inside a Manor menu popover: buttons render as menu rows that close the menu when chosen.
  var manorMenuRows: Bool {
    get { self[ManorMenuRowsKey.self] }
    set { self[ManorMenuRowsKey.self] = newValue }
  }
}

/// A menu row in Manor's popover menus: the hover fill of the pickers' rows, and choosing it closes the menu.
public struct ManorMenuRowStyle: PrimitiveButtonStyle {
  public init() {}
  public func makeBody(configuration: Configuration) -> some View { Row(configuration: configuration) }

  private struct Row: View {
    let configuration: Configuration
    @Environment(\.manorPopover) private var popover
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
      configuration.label
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(!isEnabled ? Palette.inkMuted : configuration.role == .destructive ? Palette.overdueError : Palette.ink)
        .lineLimit(1)
        .padding(.horizontal, Space.s2)
        .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(hovering && isEnabled ? Palette.surfaceHover : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .focusEffectDisabled()
        .onTapGesture {
          guard isEnabled else { return }
          configuration.trigger()
          popover?.close()
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if isEnabled { configuration.trigger(); popover?.close() } }
    }
  }
}

/// The body of a Manor menu popover: rows (buttons, checked items, dividers) on the popover surface, scrolling past
/// a comfortable height.
public struct ManorMenuList<Content: View>: View {
  @ViewBuilder let content: () -> Content
  @Environment(\.manorPopover) private var popover
  public init(@ViewBuilder content: @escaping () -> Content) { self.content = content }

  public var body: some View {
    ManorPopoverSurface {
      ScrollView {
        VStack(alignment: .leading, spacing: 1) { content() }
          .padding(Space.s1)
      }
      .scrollBounceBehavior(.basedOnSize)
      .frame(minWidth: max(180, popover?.minimumWidth ?? 0), maxHeight: 340)
    }
    .buttonStyle(ManorMenuRowStyle())
    .environment(\.manorMenuRows, true)
  }
}

/// A button that opens a Manor menu: Manor's popover in place of the system menu, so menus match the pickers in
/// both themes. Use it like `Menu { items } label: { label }`.
public struct ManorMenuButton<Content: View, Label: View>: View {
  @ViewBuilder let content: () -> Content
  @ViewBuilder let label: () -> Label
  @State private var open = false

  public init(@ViewBuilder content: @escaping () -> Content, @ViewBuilder label: @escaping () -> Label) {
    self.content = content
    self.label = label
  }

  public var body: some View {
    Button { open.toggle() } label: { label() }
      .buttonStyle(.plain)
      .manorPopover(isPresented: $open) { ManorMenuList(content: content) }
  }
}
