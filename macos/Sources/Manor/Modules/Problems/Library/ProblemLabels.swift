import AppKit
import ManorKit
import SwiftUI

/// The color family of a label chip: topics take their category's color so patterns of one category read as
/// a family; interview tags follow their facet; collections are plum.
enum ProblemChipTone: CaseIterable {
  case info, tomorrow, plum, forest, gold, neutral

  var foreground: Color {
    switch self {
    case .info: return Palette.frozenInfo
    case .tomorrow: return Palette.pillTomorrow
    case .plum: return Palette.thisWeekPlum
    case .forest: return Palette.forest
    case .gold: return Palette.tomorrowGold
    case .neutral: return Palette.inkBody
    }
  }

  var fill: Color {
    switch self {
    case .info: return Palette.frozenInfoTint
    case .tomorrow: return Palette.pillTomorrowTint
    case .plum: return Palette.thisWeekPlumTint
    case .forest: return Palette.forestSoft
    case .gold: return Palette.tomorrowGoldTint
    case .neutral: return Palette.surfaceSoft
    }
  }

  private static let topicTones: [ProblemChipTone] = [.info, .tomorrow, .plum, .forest, .gold]

  static func of(_ property: ProblemLabelProperty, _ label: String) -> ProblemChipTone {
    switch property {
    case .collections: return .plum
    case .companies: return .neutral
    case .tags:
      switch ProblemTagFacet.parse(label).facet {
      case .round: return .plum
      case .role: return .info
      case .technology: return .forest
      case .employment: return .gold
      case .other: return .neutral
      }
    case .topics:
      let family = (ProblemTopics.category(of: label) ?? label).trimmingCharacters(in: .whitespaces).lowercased()
      var hash: UInt32 = 0
      for unit in family.utf16 { hash = hash &* 31 &+ UInt32(unit) }
      return topicTones[Int(hash % UInt32(topicTones.count))]
    }
  }
}

/// The text a chip shows: interview tags drop their facet prefix.
func problemChipText(_ property: ProblemLabelProperty, _ label: String) -> String {
  property == .tags ? ProblemTagFacet.parse(label).label : label
}

/// One label chip. Companies read as a neutral, bordered name; everything else is a tinted pill.
struct ProblemChip: View {
  let property: ProblemLabelProperty
  let label: String

  var body: some View {
    let text = problemChipText(property, label)
    if property == .companies {
      Text(text)
        .font(.ui(Typography.Size.xs, weight: .medium))
        .foregroundStyle(Palette.inkBody)
        .lineLimit(1)
        .padding(.horizontal, Space.s2)
        .frame(height: 22)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceCanvas))
        .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(Palette.hairlineStrong, lineWidth: 1))
        .help(label)
    } else {
      let tone = ProblemChipTone.of(property, label)
      Pill(text, foreground: tone.foreground, fill: tone.fill).help(label)
    }
  }
}

/// Chip widths from text metrics rather than layout, so fitting a screen of cells never measures views.
@MainActor
enum ProblemChipMetrics {
  static let gap: CGFloat = 4
  /// A table cell's horizontal padding on both sides.
  static let cellPadding: CGFloat = 24
  private static var cache: [String: CGFloat] = [:]

  /// The face `Font.ui` draws with (the system font), so measured widths match the rendered chips.
  private static func font(size: CGFloat, weight: NSFont.Weight) -> NSFont {
    .systemFont(ofSize: size, weight: weight)
  }

  private static let pillFont = font(size: Typography.Size.xs, weight: .medium)
  private static let companyFont = font(size: Typography.Size.xs, weight: .medium)
  private static let counterFont = font(size: Typography.Size.xs, weight: .regular)

  private static func measure(_ text: String, _ font: NSFont) -> CGFloat {
    ceil((text as NSString).size(withAttributes: [.font: font]).width) + 2
  }

  static func width(_ property: ProblemLabelProperty, _ label: String) -> CGFloat {
    let key = "\(property.rawValue)\u{0}\(label)"
    if let known = cache[key] { return known }
    let width = property == .companies
      ? measure(label, companyFont) + 18
      : measure(problemChipText(property, label), pillFont) + 14
    cache[key] = width
    return width
  }

  static func counterWidth(_ hidden: Int) -> CGFloat {
    let key = "+\u{0}\(hidden)"
    if let known = cache[key] { return known }
    let width = measure("+\(hidden)", counterFont) + 12
    cache[key] = width
    return width
  }
}

/// A one-line row of whole chips for a table cell: as many as fit, then "+N", which shows the rest in a popover.
/// Only when not even the first chip fits does that chip shrink, ending in an ellipsis.
struct ProblemChipRow: View {
  let property: ProblemLabelProperty
  let labels: [String]
  let available: CGFloat
  @State private var showingAll = false

  var body: some View {
    let ordered = property == .tags ? ProblemTagFacet.ordered(labels) : labels
    let widths = ordered.map { ProblemChipMetrics.width(property, $0) }
    let whole = ProblemColumn.fittingChipCount(widths, gap: ProblemChipMetrics.gap, counter: ProblemChipMetrics.counterWidth(ordered.count), available: available)
    let shown = whole == 0 && !ordered.isEmpty ? 1 : whole
    let hidden = ordered.count - shown
    HStack(spacing: ProblemChipMetrics.gap) {
      ForEach(Array(ordered.prefix(shown)), id: \.self) { label in
        ProblemChip(property: property, label: label).layoutPriority(whole == 0 ? 0 : 1)
      }
      if hidden > 0 {
        Button { showingAll = true } label: {
          Text("+\(hidden)")
            .font(.ui(Typography.Size.xs))
            .foregroundStyle(Palette.inkMuted)
            .padding(.horizontal, 6)
            .frame(height: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .help(ordered.suffix(hidden).map { problemChipText(property, $0) }.joined(separator: ", "))
        .accessibilityLabel("Show \(hidden) more")
        .popover(isPresented: $showingAll, arrowEdge: .bottom) {
          ProblemChipWrap(property: property, labels: ordered)
            .padding(Space.s3)
            .frame(width: 320)
        }
      }
    }
    .lineLimit(1)
  }
}

/// Every chip of a property, wrapping onto as many lines as it needs.
struct ProblemChipWrap: View {
  let property: ProblemLabelProperty
  let labels: [String]

  var body: some View {
    ProblemFlowLayout(spacing: ProblemChipMetrics.gap) {
      ForEach(property == .tags ? ProblemTagFacet.ordered(labels) : labels, id: \.self) { ProblemChip(property: property, label: $0) }
    }
  }
}

/// Lays children out left to right, wrapping to a new line when one would overflow.
struct ProblemFlowLayout: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width { x = 0; y += line + spacing; line = 0 }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: min(widest, width), height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

/// Official difficulties use a soft fill; an estimated one keeps its hue with a dashed outline and says so on hover.
struct ProblemDifficultyBadge: View {
  let difficulty: ProblemDifficulty?
  let estimated: Bool

  var body: some View {
    if let difficulty {
      let (foreground, fill) = Self.colors(difficulty)
      Text(difficulty.rawValue)
        .font(.ui(Typography.Size.xs, weight: estimated ? .medium : .semibold))
        .foregroundStyle(foreground)
        .padding(.horizontal, Space.s2)
        .frame(height: 22)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(estimated ? .clear : fill))
        .overlay {
          if estimated {
            RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(foreground, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
          }
        }
        .help(estimated ? "Estimated difficulty" : "")
        .accessibilityLabel(estimated ? "\(difficulty.rawValue), estimated difficulty" : difficulty.rawValue)
    } else {
      Text("Not specified").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1)
    }
  }

  static func colors(_ difficulty: ProblemDifficulty) -> (Color, Color) {
    switch difficulty {
    case .easy: return (Palette.completion, Palette.completionTint)
    case .medium: return (Palette.todayWarning, Palette.todayWarningTint)
    case .hard: return (Palette.error, Palette.errorSoft)
    }
  }
}

struct ProblemStatusLabel: View {
  let status: ProblemStatus

  var body: some View {
    HStack(spacing: Space.s1) {
      if status == .solved { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)) }
      Text(status.label).font(.ui(Typography.Size.xs, weight: status == .solved ? .semibold : .regular)).lineLimit(1)
    }
    .foregroundStyle(status == .solved ? Palette.completion : status == .attempted ? Palette.todayWarning : Palette.inkMuted)
  }
}

/// The reported last-asked date at its own precision, or the newest company report window when no date was reported.
struct ProblemRecencyLabel: View {
  let metadata: ProblemSourceMetadata?
  let timeZone: TimeZone

  var body: some View {
    if let asked = metadata?.lastAsked {
      Text(ProblemDateLabels.compactLabel(asked, in: timeZone))
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).tabular().lineLimit(1)
        .help(asked.precision == .month ? "Reported to the month" : asked.precision == .year ? "Reported to the year" : asked.precision == .instant ? ProblemDateLabels.label(asked) : "")
    } else if let report = ProblemSourceMetadata.latestReport(metadata?.companyReports ?? []) {
      Text(report.window.label)
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).lineLimit(1)
        .help("\(report.window.label), as of \(ProblemDateLabels.day(report.snapshotDate))")
    } else {
      Text("Not reported").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1)
    }
  }
}
