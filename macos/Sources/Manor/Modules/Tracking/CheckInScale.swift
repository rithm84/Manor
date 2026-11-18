import ManorKit
import SwiftUI

// Mood and focus on the Tracking page: the scale tones, the drawn marks, the one-tap check-in rows the Daily
// view and the day editor share, and the rows' week strips.

/// A level's strong tone (swatches, marks, selected words) and its tint (selected fills, day cells).
struct MoodFocusTone {
  let strong: Color
  let tint: Color
}

/// A level on one of the two scales, as the check-in rows read it.
protocol CheckInLevel: Hashable, Identifiable, RawRepresentable where RawValue == String {
  var tone: MoodFocusTone { get }
  /// A deliberate day off: shown apart from the rated levels and never read as a low score.
  var isRest: Bool { get }
}

extension Mood: CheckInLevel {
  var tone: MoodFocusTone {
    switch self {
    case .awful: return MoodFocusTone(strong: Palette.scaleAwful, tint: Palette.scaleAwfulTint)
    case .bad: return MoodFocusTone(strong: Palette.scaleBad, tint: Palette.scaleBadTint)
    case .neutral: return MoodFocusTone(strong: Palette.scaleNeutral, tint: Palette.scaleNeutralTint)
    case .good: return MoodFocusTone(strong: Palette.scaleGood, tint: Palette.scaleGoodTint)
    case .great: return MoodFocusTone(strong: Palette.scaleGreat, tint: Palette.scaleGreatTint)
    }
  }
  var isRest: Bool { false }
}

extension Focus: CheckInLevel {
  var tone: MoodFocusTone {
    switch self {
    case .lockedOut: return MoodFocusTone(strong: Palette.scaleLockedout, tint: Palette.scaleLockedoutTint)
    case .low: return MoodFocusTone(strong: Palette.scaleLow, tint: Palette.scaleLowTint)
    case .medium: return MoodFocusTone(strong: Palette.scaleMedium, tint: Palette.scaleMediumTint)
    case .high: return MoodFocusTone(strong: Palette.scaleHigh, tint: Palette.scaleHighTint)
    case .lockedIn: return MoodFocusTone(strong: Palette.scaleLockedin, tint: Palette.scaleLockedinTint)
    case .resting: return MoodFocusTone(strong: Palette.scaleResting, tint: Palette.scaleRestingTint)
    }
  }
  var isRest: Bool { self == .resting }

  var systemImage: String {
    switch self {
    case .lockedIn: return "scope"
    case .high: return "bolt.fill"
    case .medium: return "gauge.with.dots.needle.50percent"
    case .low: return "battery.25percent"
    case .lockedOut: return "circle.slash"
    case .resting: return "moon.fill"
    }
  }
}

/// The two series colors of the trend chart: plum for mood, slate blue for focus, both clear of the habit
/// completion green beside them.
enum MoodFocusSeries {
  static let mood = Palette.primary
  static let focus = Palette.scaleMedium
}

// MARK: Marks

/// A drawn face for each mood. SF Symbols has no frowning face, so the five read as one family: the mouth
/// bends from a wide open smile down to a frown, and Awful adds knitted brows.
struct MoodFace: View {
  let mood: Mood
  var size: CGFloat = 20
  var lineWidth: CGFloat = 1.6

  var body: some View {
    Canvas { context, canvas in
      let s = min(canvas.width, canvas.height)
      let inset = lineWidth / 2 + s * 0.04
      let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
      let style = StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
      let shading = GraphicsContext.Shading.style(.foreground)
      context.stroke(Path(ellipseIn: rect), with: shading, style: style)

      let eyeY = rect.minY + rect.height * 0.38
      let eyeRadius = max(1, s * 0.055)
      for x in [rect.minX + rect.width * 0.35, rect.minX + rect.width * 0.65] {
        context.fill(Path(ellipseIn: CGRect(x: x - eyeRadius, y: eyeY - eyeRadius, width: eyeRadius * 2, height: eyeRadius * 2)), with: shading)
      }

      let left = CGPoint(x: rect.minX + rect.width * 0.32, y: rect.minY + rect.height * 0.64)
      let right = CGPoint(x: rect.minX + rect.width * 0.68, y: left.y)
      var mouth = Path()
      switch mood {
      case .great:
        mouth.move(to: CGPoint(x: left.x, y: left.y - rect.height * 0.04))
        mouth.addQuadCurve(to: CGPoint(x: right.x, y: right.y - rect.height * 0.04), control: CGPoint(x: rect.midX, y: left.y + rect.height * 0.26))
        mouth.closeSubpath()
        context.fill(mouth, with: shading)
        context.stroke(mouth, with: shading, style: style)
        return
      case .good:
        mouth.move(to: left)
        mouth.addQuadCurve(to: right, control: CGPoint(x: rect.midX, y: left.y + rect.height * 0.16))
      case .neutral:
        mouth.move(to: CGPoint(x: left.x, y: left.y + rect.height * 0.04))
        mouth.addLine(to: CGPoint(x: right.x, y: right.y + rect.height * 0.04))
      case .bad:
        mouth.move(to: CGPoint(x: left.x, y: left.y + rect.height * 0.1))
        mouth.addQuadCurve(to: CGPoint(x: right.x, y: right.y + rect.height * 0.1), control: CGPoint(x: rect.midX, y: left.y - rect.height * 0.06))
      case .awful:
        mouth.move(to: CGPoint(x: left.x, y: left.y + rect.height * 0.12))
        mouth.addQuadCurve(to: CGPoint(x: right.x, y: right.y + rect.height * 0.12), control: CGPoint(x: rect.midX, y: left.y - rect.height * 0.1))
        var brows = Path()
        brows.move(to: CGPoint(x: rect.minX + rect.width * 0.24, y: eyeY - rect.height * 0.17))
        brows.addLine(to: CGPoint(x: rect.minX + rect.width * 0.42, y: eyeY - rect.height * 0.09))
        brows.move(to: CGPoint(x: rect.minX + rect.width * 0.76, y: eyeY - rect.height * 0.17))
        brows.addLine(to: CGPoint(x: rect.minX + rect.width * 0.58, y: eyeY - rect.height * 0.09))
        context.stroke(brows, with: shading, style: style)
      }
      context.stroke(mouth, with: shading, style: style)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// The swatch beside a level word: square for mood, round for focus. Resting is a ring and a missing
/// rating a hollow outline, so neither reads as a low score.
struct MoodFocusSwatch: View {
  enum Shape { case square, circle }
  let shape: Shape
  let color: Color?
  var resting = false
  var size: CGFloat = 8

  var body: some View {
    Group {
      if shape == .square {
        swatch(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
      } else {
        swatch(Circle())
      }
    }
    .frame(width: size, height: size)
  }

  @ViewBuilder
  private func swatch<S: InsettableShape>(_ shape: S) -> some View {
    if let color {
      if resting { shape.strokeBorder(color, lineWidth: max(1.5, size / 4)) } else { shape.fill(color) }
    } else {
      shape.strokeBorder(Palette.inkMuted, lineWidth: 1)
    }
  }
}

/// The leading mark of a check-in row, in the place a habit row keeps its check: the chosen level's mark
/// on its tint, a moon ring for a rest day, or a dashed outline while nothing is logged.
struct CheckInGlyph: View {
  enum Value { case mood(Mood?), focus(Focus?) }
  let value: Value
  var size: CGFloat = 26

  var body: some View {
    ZStack {
      switch value {
      case .mood(let mood?):
        Circle().fill(mood.tone.tint)
        MoodFace(mood: mood, size: size - 4, lineWidth: 1.5).foregroundStyle(mood.tone.strong)
      case .focus(let focus?) where focus == .resting:
        Circle().strokeBorder(focus.tone.strong, lineWidth: 1.5)
        Image(systemName: focus.systemImage).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(focus.tone.strong)
      case .focus(let focus?):
        Circle().fill(focus.tone.tint)
        Circle().strokeBorder(focus.tone.strong.opacity(0.55), lineWidth: 1)
        Image(systemName: focus.systemImage).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(focus.tone.strong)
      default:
        Circle().strokeBorder(Palette.surfaceStrong, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5]))
      }
    }
    .frame(width: size, height: size)
    .animation(Motion.base, value: key)
    .accessibilityHidden(true)
  }

  private var key: String {
    switch value {
    case .mood(let mood): return "m\(mood?.rawValue ?? "")"
    case .focus(let focus): return "f\(focus?.rawValue ?? "")"
    }
  }
}

// MARK: Check-in rows

/// One signal's check-in: the glyph, the signal's name, and its scale, lowest to highest with Resting set
/// apart. Rows stack so the two scales start on the same line. The scale shows every word while there is room, tightens its spacing next, and on the narrowest
/// rows keeps the chosen word with swatches for the rest.
struct CheckInRow<Level: CheckInLevel>: View {
  let title: String
  let glyph: CheckInGlyph.Value
  let levels: [Level]
  let selection: Level?
  let swatchShape: MoodFocusSwatch.Shape
  /// The week around the day, shown on the trailing edge the way habit rows show theirs; nil hides it.
  var week: [CheckInWeekDay]? = nil
  let onSelect: (Level) -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: 10) {
      CheckInGlyph(value: glyph).frame(width: 28, height: 28)
      Text(title)
        .font(.ui(Typography.Size.md, weight: .medium))
        .foregroundStyle(Palette.ink)
        .lineLimit(1)
        .frame(width: 56, alignment: .leading)
        .accessibilityHidden(true)
      ViewThatFits(in: .horizontal) {
        CheckInScale(title: title, levels: levels, selection: selection, swatchShape: swatchShape, density: .regular, onSelect: onSelect)
        CheckInScale(title: title, levels: levels, selection: selection, swatchShape: swatchShape, density: .tight, onSelect: onSelect)
        CheckInScale(title: title, levels: levels, selection: selection, swatchShape: swatchShape, density: .swatches, onSelect: onSelect)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if let week {
        CheckInWeekStrip(title: title, days: week, swatchShape: swatchShape)
      }
    }
    .padding(.horizontal, Space.s3)
    .frame(minHeight: 52)
    .background(hovering ? Palette.surfacePaper : .clear)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
  }
}

extension CheckInRow where Level == Mood {
  init(mood: Mood?, week: [CheckInWeekDay]? = nil, onSelect: @escaping (Mood) -> Void) {
    self.init(title: "Mood", glyph: .mood(mood), levels: Mood.ascending, selection: mood, swatchShape: .square, week: week, onSelect: onSelect)
  }
}

extension CheckInRow where Level == Focus {
  init(focus: Focus?, week: [CheckInWeekDay]? = nil, onSelect: @escaping (Focus) -> Void) {
    self.init(title: "Focus", glyph: .focus(focus), levels: Focus.ascending + [.resting], selection: focus, swatchShape: .circle, week: week, onSelect: onSelect)
  }
}

// MARK: Week strip

/// One day on a check-in row's week strip.
struct CheckInWeekDay: Identifiable {
  let date: String
  let letter: String
  /// The logged level's word and tone; nil while nothing is logged.
  let level: String?
  let tone: MoodFocusTone?
  let resting: Bool
  let isToday: Bool
  let isFuture: Bool
  let selected: Bool
  var id: String { date }

  /// The Monday-to-Sunday week around `date` for one signal.
  static func week<Level: CheckInLevel>(around date: String, today: String, level: (String) -> Level?) -> [CheckInWeekDay] {
    let start = HabitDates.startOfWeek(date)
    return HabitModel.weekLetters.enumerated().map { index, letter in
      let day = HabitDates.addDays(start, index)
      let value = day > today ? nil : level(day)
      return CheckInWeekDay(
        date: day, letter: letter, level: value?.rawValue, tone: value?.tone, resting: value?.isRest ?? false,
        isToday: day == today, isFuture: day > today, selected: day == date
      )
    }
  }
}

/// The week's ratings for one signal, matching the habit rows' week strips: each logged day in its level's
/// tone, Resting as a ring, today outlined while it waits, and the shown day framed.
struct CheckInWeekStrip: View {
  let title: String
  let days: [CheckInWeekDay]
  let swatchShape: MoodFocusSwatch.Shape

  var body: some View {
    HStack(spacing: 1) {
      ForEach(days) { day in
        VStack(spacing: 4) {
          Text(day.letter)
            .font(.ui(Typography.Size.xs, weight: day.selected ? .semibold : .medium))
            .foregroundStyle(day.selected ? Palette.inkBody : Palette.inkMuted)
          segment(day)
        }
        .frame(width: 21)
        .help(day.level ?? "")
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(title) this week: " + days.filter { !$0.isFuture }.map { "\($0.letter) \($0.level ?? "not logged")" }.joined(separator: "; "))
  }

  private func segment(_ day: CheckInWeekDay) -> some View {
    let shape = RoundedRectangle(cornerRadius: 3, style: .continuous)
    return ZStack {
      if let tone = day.tone {
        if day.resting {
          shape.strokeBorder(tone.strong, lineWidth: 1.5)
        } else {
          shape.fill(tone.strong)
        }
      } else if day.isToday {
        shape.fill(Palette.surfaceCard)
        shape.strokeBorder(Palette.surfaceStrong, lineWidth: 1)
      } else {
        shape.fill(Palette.surfaceSoft)
      }
    }
    .frame(width: 16, height: 10)
    .opacity(day.isFuture ? 0.6 : 1)
    .padding(2)
    .overlay {
      if day.selected {
        RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Palette.inkMuted, lineWidth: 1)
      }
    }
    .animation(Motion.base, value: day.level)
  }
}

/// The scale itself, a keyboard-operable radio group: Left and Right step through the levels, Home and End
/// jump to the ends, 1 to 5 pick a rated level, and R picks Resting where the scale has it.
struct CheckInScale<Level: CheckInLevel>: View {
  enum Density { case regular, tight, swatches }
  let title: String
  let levels: [Level]
  let selection: Level?
  let swatchShape: MoodFocusSwatch.Shape
  let density: Density
  let onSelect: (Level) -> Void
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: density == .regular ? 2 : 1) {
      ForEach(levels) { level in
        CheckInChip(
          level: level, selected: selection == level, swatchShape: swatchShape,
          showsWord: density != .swatches || selection == level, tight: density != .regular
        ) { onSelect(level) }
      }
    }
    .padding(2)
    .overlay(
      RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
        .strokeBorder(Palette.focusBorder, lineWidth: 1.5)
        .opacity(focused ? 1 : 0)
    )
    .fixedSize()
    // Keyboard focus only, like a button: a click picks a level without leaving a ring around the scale.
    .focusable(interactions: .activate)
    .focusEffectDisabled()
    .focused($focused)
    .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, .end]) { press in
      move(press.key)
      return .handled
    }
    .onKeyPress(characters: CharacterSet(charactersIn: "12345rR")) { press in
      pick(press.characters)
      return .handled
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
    .accessibilityValue(selection?.rawValue ?? "Not logged")
  }

  private func move(_ key: KeyEquivalent) {
    guard !levels.isEmpty else { return }
    let index = selection.flatMap { levels.firstIndex(of: $0) }
    let next: Int
    switch key {
    case .home: next = 0
    case .end: next = levels.count - 1
    case .rightArrow, .upArrow: next = index.map { min($0 + 1, levels.count - 1) } ?? 0
    default: next = index.map { max($0 - 1, 0) } ?? levels.count - 1
    }
    if levels[next] != selection { onSelect(levels[next]) }
  }

  private func pick(_ characters: String) {
    let rated = levels.filter { !$0.isRest }
    if characters.lowercased() == "r" {
      if let rest = levels.first(where: \.isRest), rest != selection { onSelect(rest) }
    } else if let number = Int(characters), rated.indices.contains(number - 1), rated[number - 1] != selection {
      onSelect(rated[number - 1])
    }
  }
}

/// One level of a scale: its swatch and word. Choosing it fills the chip with the level's tint and sets
/// the word in the level's tone; the others stay quiet until hovered.
private struct CheckInChip<Level: CheckInLevel>: View {
  let level: Level
  let selected: Bool
  let swatchShape: MoodFocusSwatch.Shape
  let showsWord: Bool
  let tight: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    let tone = level.tone
    Button(action: action) {
      HStack(spacing: 5) {
        MoodFocusSwatch(shape: swatchShape, color: tone.strong, resting: level.isRest, size: 7)
          .opacity(selected || hovering ? 1 : 0.6)
        if showsWord {
          Text(level.rawValue)
            .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? tone.strong : (hovering ? Palette.ink : Palette.inkMuted))
            .lineLimit(1)
            .fixedSize()
        }
      }
      .padding(.horizontal, showsWord ? (tight ? 6 : 9) : 7)
      .frame(height: 28)
      .background(
        RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
          .fill(selected ? tone.tint : (hovering ? Palette.surfaceSoft : .clear))
      )
      .overlay(
        RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
          .strokeBorder(tone.strong.opacity(selected ? 0.4 : 0), lineWidth: 1)
      )
      .contentShape(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
    }
    .buttonStyle(HabitPressStyle(scale: 0.96))
    .focusable(false)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .animation(Motion.base, value: selected)
    .help(showsWord ? "" : level.rawValue)
    .accessibilityLabel(level.rawValue)
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }
}
