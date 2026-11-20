import SwiftUI

// MARK: Buttons

/// Manor's button family. `.primary` is the one main action in a region; `.secondary` is a bordered
/// neutral; `.ghost` is a quiet toolbar or row action; `.danger` confirms destruction; `.apple` is the Sign in with
/// Apple button, solid black in light mode and white in dark as Apple's guidelines ask.
public struct ManorButtonStyle: ButtonStyle {
  public enum Kind { case primary, secondary, ghost, danger, apple }
  public enum Size { case regular, small }
  let kind: Kind
  let size: Size

  public init(_ kind: Kind = .secondary, size: Size = .regular) {
    self.kind = kind
    self.size = size
  }

  public func makeBody(configuration: Configuration) -> some View {
    ManorButtonBody(configuration: configuration, kind: kind, size: size)
  }

  private struct ManorButtonBody: View {
    let configuration: Configuration
    let kind: Kind
    let size: Size
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
      configuration.label
        .font(.ui(size == .small ? Typography.Size.sm : Typography.Size.body, weight: .medium))
        .foregroundStyle(foreground)
        .padding(.horizontal, size == .small ? Space.s3 : Space.s4)
        .frame(minHeight: size == .small ? 26 : 32)
        .modifier(ButtonSurface(kind: kind, fill: background))
        .contentShape(Capsule())
        // The keyboard focus ring follows the capsule instead of the label's rectangle.
        .contentShape(.focusEffect, Capsule())
        .scaleEffect(configuration.isPressed ? 0.97 : 1)
        .opacity(isEnabled ? 1 : 0.5)
        .animation(Motion.press, value: configuration.isPressed)
        .animation(Motion.fast, value: hovering)
        .onHover { hovering = $0 }
    }

    // The on-colors suit the tinted glass too: white on plum in light, deep plum on lilac in dark.
    private var foreground: Color {
      switch kind {
      case .primary: return Palette.onPrimary
      case .danger: return Palette.onDanger
      case .apple: return Palette.surfaceCanvas
      case .secondary, .ghost: return Palette.ink
      }
    }

    private var background: Color {
      let pressed = configuration.isPressed
      switch kind {
      case .primary: return pressed ? Palette.primaryActive : hovering ? Palette.primaryHover : Palette.primary
      case .danger: return Palette.overdueError.opacity(pressed ? 0.85 : hovering ? 0.92 : 1)
      case .apple: return Palette.ink.opacity(pressed ? 0.8 : hovering ? 0.88 : 1)
      case .secondary: return pressed ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : Palette.surfaceCanvas
      case .ghost: return pressed ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear
      }
    }
  }
}

/// A button's capsule: tinted, interactive Liquid Glass on macOS 26 (plum for primary, red for danger, clear
/// for secondary), and the solid fills with a hairline for secondary elsewhere. Ghost and Apple buttons stay flat.
private struct ButtonSurface: ViewModifier {
  let kind: ManorButtonStyle.Kind
  let fill: Color
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    if GlassSupport.isActive, !reduceTransparency, kind != .ghost, kind != .apple {
      content.glassSurface(
        Capsule(), fallback: fill, interactive: true,
        tint: kind == .primary ? Palette.primary : kind == .danger ? Palette.overdueError : nil
      )
    } else {
      // The fill sits half a point inside the border so its antialiased edge never shows past the stroke as a
      // sliver at the capsule's rounded ends.
      content
        .background {
          if kind == .secondary {
            Capsule().inset(by: 0.5).fill(fill)
              .overlay(Capsule().strokeBorder(Palette.hairlineStrong, lineWidth: 1))
          } else {
            Capsule().fill(fill)
          }
        }
    }
  }
}

public extension ButtonStyle where Self == ManorButtonStyle {
  static var primary: ManorButtonStyle { ManorButtonStyle(.primary) }
  static var secondary: ManorButtonStyle { ManorButtonStyle(.secondary) }
  static var ghost: ManorButtonStyle { ManorButtonStyle(.ghost) }
  static var danger: ManorButtonStyle { ManorButtonStyle(.danger) }
  static func manor(_ kind: ManorButtonStyle.Kind, size: ManorButtonStyle.Size = .regular) -> ManorButtonStyle { ManorButtonStyle(kind, size: size) }
}

/// A square icon-only button for toolbars and row actions. Always pass an accessibility label.
public struct IconButton: View {
  let systemImage: String
  let label: String
  let size: CGFloat
  let action: () -> Void
  @State private var hovering = false

  public init(_ systemImage: String, label: String, size: CGFloat = 28, action: @escaping () -> Void) {
    self.systemImage = systemImage
    self.label = label
    self.size = size
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: size * 0.5, weight: .medium))
        .foregroundStyle(hovering ? Palette.ink : Palette.inkMuted)
        .frame(width: size, height: size)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(hovering ? Palette.surfaceHover : .clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .help(label)
    .accessibilityLabel(label)
  }
}

// MARK: Pills and tags

/// A tinted label: due buckets, statuses, priorities, durations. Foreground and fill are independent roles.
public struct Pill: View {
  let text: String
  let systemImage: String?
  let foreground: Color
  let fill: Color

  public init(_ text: String, systemImage: String? = nil, foreground: Color = Palette.inkBody, fill: Color = Palette.surfaceSoft) {
    self.text = text
    self.systemImage = systemImage
    self.foreground = foreground
    self.fill = fill
  }

  public var body: some View {
    HStack(spacing: 4) {
      if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .semibold)) }
      Text(text).font(.ui(Typography.Size.xs, weight: .medium)).lineLimit(1)
    }
    .foregroundStyle(foreground)
    .padding(.horizontal, 7)
    .frame(height: 22)
    .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(fill))
    .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(foreground.opacity(0.14), lineWidth: 1))
    .tabular()
  }
}

// MARK: Checkbox

// MARK: Text fields

/// The inset text-field treatment used in dialogs and forms.
public struct ManorFieldStyle: TextFieldStyle {
  @FocusState private var focused: Bool
  public init() {}
  public func _body(configuration: TextField<Self._Label>) -> some View {
    let shape = RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
    configuration
      .textFieldStyle(.plain)
      .font(.ui(Typography.Size.body))
      .foregroundStyle(Palette.ink)
      .padding(.horizontal, Space.s3)
      .frame(minHeight: 32)
      .background(shape.fill(Palette.fieldFill))
      .modifier(FocusRing(shape: shape, focused: focused, border: Palette.fieldBorder))
      .focused($focused)
  }
}

public extension TextFieldStyle where Self == ManorFieldStyle {
  static var manor: ManorFieldStyle { ManorFieldStyle() }
}

/// A search field with a leading glass and an Escape-to-clear behavior.
public struct SearchField: View {
  @Binding var text: String
  let prompt: String
  @FocusState private var focused: Bool

  public init(text: Binding<String>, prompt: String = "Search") {
    _text = text
    self.prompt = prompt
  }

  public var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField(prompt, text: $text).textFieldStyle(.plain).font(.ui(Typography.Size.body)).focused($focused)
        .onExitCommand { text = "" }
      if !text.isEmpty {
        Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.inkMuted) }
          .buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, Space.s2 + 2)
    .frame(height: 30)
    .background(Capsule().fill(Palette.searchFill))
    .modifier(FocusRing(shape: Capsule(), focused: focused, border: .clear))
  }
}

// MARK: Segmented tabs

/// A compact segmented control for page views (Weekly / Master, Today / Yesterday / History).
public struct SegmentedTabs<Value: Hashable>: View {
  let options: [(value: Value, label: String)]
  @Binding var selection: Value
  @Namespace private var namespace

  public init(_ options: [(value: Value, label: String)], selection: Binding<Value>) {
    self.options = options
    _selection = selection
  }

  public var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option in
        let selected = option.value == selection
        Button { withAnimation(Motion.base) { selection = option.value } } label: {
          Text(option.label)
            .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? Palette.ink : Palette.inkMuted)
            .padding(.horizontal, Space.s3)
            .frame(height: 26)
            .background {
              if selected {
                Capsule().fill(Palette.segmentSelected)
                  .overlay(Capsule().strokeBorder(Palette.segmentSelectedEdge, lineWidth: 0.5))
                  .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                  .matchedGeometryEffect(id: "segment", in: namespace)
              }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(3)
    .glassSurface(Capsule(), fallback: Palette.surfaceSoft)
  }
}

// MARK: Hover rows

/// The hover and selection fill shared by list rows, menus, and sidebar items.
public struct RowBackground: ViewModifier {
  let selected: Bool
  @State private var hovering = false
  public func body(content: Content) -> some View {
    content
      .background(
        RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
          .fill(selected ? (hovering ? Palette.surfaceSelectedHover : Palette.surfaceSelected) : (hovering ? Palette.surfaceHover : .clear))
      )
      .onHover { hovering = $0 }
      .animation(Motion.fast, value: hovering)
  }
}

public extension View {
  func rowBackground(selected: Bool = false) -> some View { modifier(RowBackground(selected: selected)) }
}
