import ManorKit
import SwiftUI

// Controls the history views share (Tracking and Pomodoro): the month navigator, section heads, weighted
// summary columns, and the 3, 6, and 12-month range switch.

/// The month navigator. Chevrons step a month, Left and Right do the same while it has focus, and the
/// month name returns to the current month whenever another month is shown.
struct HistoryMonthNav: View {
  enum Style {
    /// A bordered stepper with the month name between the chevrons.
    case compact
    /// The month name as the section's title, with quiet chevrons after it.
    case title
    /// Only the chevrons, for a month already named nearby.
    case arrows
  }

  let label: String
  let canMoveBack: Bool
  let canMoveForward: Bool
  let onShift: (Int) -> Void
  let onCurrent: (() -> Void)?
  var style: Style = .compact
  @FocusState private var focused: Bool
  @State private var hoveringLabel = false

  var body: some View {
    HStack(spacing: style == .title ? Space.s1 : 2) {
      if style == .title {
        name
        Spacer().frame(width: Space.s1)
        arrows
      } else {
        IconButton("chevron.left", label: "Previous month") { if canMoveBack { onShift(-1) } }
          .disabled(!canMoveBack).opacity(canMoveBack ? 1 : 0.35)
        if style == .compact { name.frame(minWidth: 128) }
        IconButton("chevron.right", label: "Next month") { if canMoveForward { onShift(1) } }
          .disabled(!canMoveForward).opacity(canMoveForward ? 1 : 0.35)
      }
    }
    .padding(style == .compact ? 2 : 0)
    .background {
      if style == .compact {
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard)
      }
    }
    .overlay {
      RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
        .strokeBorder(focused ? Palette.focusBorder : (style == .compact ? Palette.hairline : .clear), lineWidth: focused ? 1.5 : 1)
        .padding(style == .compact ? 0 : -4)
    }
    .focusable(interactions: .activate)
    .focusEffectDisabled()
    .focused($focused)
    .onKeyPress(.leftArrow) { if canMoveBack { onShift(-1) }; return .handled }
    .onKeyPress(.rightArrow) { if canMoveForward { onShift(1) }; return .handled }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Month: \(label)")
  }

  private var arrows: some View {
    HStack(spacing: 0) {
      IconButton("chevron.left", label: "Previous month") { if canMoveBack { onShift(-1) } }
        .disabled(!canMoveBack).opacity(canMoveBack ? 1 : 0.35)
      IconButton("chevron.right", label: "Next month") { if canMoveForward { onShift(1) } }
        .disabled(!canMoveForward).opacity(canMoveForward ? 1 : 0.35)
    }
  }

  @ViewBuilder
  private var name: some View {
    let font: Font = style == .title ? .display(Typography.Size.title, weight: .semibold) : .ui(Typography.Size.sm, weight: .semibold)
    Group {
      if let onCurrent {
        Button(action: onCurrent) {
          Text(label)
            .foregroundStyle(hoveringLabel ? Palette.primary : Palette.ink)
            .underline(style == .compact, color: Palette.hairlineStrong)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveringLabel = $0 }
        .help("Back to this month")
      } else {
        Text(label).foregroundStyle(Palette.ink)
      }
    }
    .font(font)
    .tabular()
    .contentTransition(.opacity)
    .animation(Motion.fast, value: hoveringLabel)
  }
}

/// A history section's title and one-line description.
struct HistorySectionHead: View {
  let title: String
  let subtitle: String?

  init(title: String, subtitle: String? = nil) {
    self.title = title
    self.subtitle = subtitle
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.display(Typography.Size.md, weight: .medium)).foregroundStyle(Palette.ink)
        .accessibilityAddTraits(.isHeader)
      if let subtitle {
        Text(subtitle).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
    }
  }
}

/// Columns that share the offered width by weight, like CSS `1.2fr 1fr`. Summary strips use it.
struct WeightedColumns: SwiftUI.Layout {
  struct Weight: LayoutValueKey { static let defaultValue: CGFloat = 1 }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? subviews.reduce(0) { $0 + $1.sizeThatFits(.unspecified).width }
    let widths = columnWidths(width, subviews)
    let height = zip(subviews, widths).map { $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height }.max() ?? 0
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX
    for (subview, width) in zip(subviews, columnWidths(bounds.width, subviews)) {
      subview.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: width, height: bounds.height))
      x += width
    }
  }

  private func columnWidths(_ width: CGFloat, _ subviews: Subviews) -> [CGFloat] {
    let total = subviews.reduce(0) { $0 + $1[Weight.self] }
    return subviews.map { total == 0 ? 0 : width * $0[Weight.self] / total }
  }
}

extension View {
  func columnWeight(_ weight: CGFloat) -> some View { layoutValue(key: WeightedColumns.Weight.self, value: weight) }
}

/// The 3, 6, and 12-month range switch.
struct HistoryRangeTabs: View {
  @Binding var range: Int

  var body: some View {
    HStack(spacing: 2) {
      ForEach([3, 6, 12], id: \.self) { value in
        let selected = value == range
        Button { withAnimation(Motion.base) { range = value } } label: {
          Text("\(value)m").font(.ui(Typography.Size.xs, weight: selected ? .semibold : .medium)).tabular()
            .foregroundStyle(selected ? Palette.ink : Palette.inkMuted)
            .frame(minWidth: 34, minHeight: 24)
            .background {
              if selected {
                RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceCanvas)
                  .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
              }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(HabitPressStyle(scale: 0.97))
        .accessibilityLabel("Show \(value) months")
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .padding(2)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceSoft))
  }
}

/// Shows or hides retired habits.
struct ArchivedToggle: View {
  @Binding var isOn: Bool
  let count: Int
  @State private var hovering = false

  var body: some View {
    Button { withAnimation(Motion.base) { isOn.toggle() } } label: {
      HStack(spacing: 5) {
        Image(systemName: "archivebox").font(.system(size: 11, weight: .medium))
        Text("Archived").font(.ui(Typography.Size.sm, weight: isOn ? .semibold : .medium))
        if count > 0 { Text("\(count)").font(.ui(Typography.Size.sm)).tabular() }
      }
      .foregroundStyle(isOn ? Palette.ink : Palette.inkMuted)
      .padding(.horizontal, Space.s2 + 2)
      .frame(height: 26)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(isOn ? Palette.surfaceSelected : (hovering ? Palette.surfaceHover : .clear)))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help(isOn ? "Hide archived habits" : "Show archived habits")
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// A small legend key: a mark and its name.
struct HistoryLegendItem<Mark: View>: View {
  let label: String
  @ViewBuilder let mark: () -> Mark

  var body: some View {
    HStack(spacing: 5) {
      mark()
      Text(label).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
    }
  }
}
