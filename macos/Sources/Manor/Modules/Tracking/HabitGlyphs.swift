import ManorKit
import SwiftUI

// Vector marks for the streak system, drawn from the same 24-unit artwork the web client used so they stay
// crisp at every size and in both themes.

/// How a streak flame reads: an outlined ember at rest, amber when today is at risk, lit while the streak
/// runs, and gilded once the habit has gone seven days without a freeze.
enum HabitFlameState: Equatable {
  case ember, dim, lit, gilded

  static func of(streak: Int, atRisk: Bool, gold: Bool) -> HabitFlameState {
    if streak == 0 { return .ember }
    if atRisk { return .dim }
    return gold ? .gilded : .lit
  }
}

private struct FlameBody: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 13.1, y: 2.6))
    path.addCurve(to: CGPoint(x: 8.3, y: 11.8), control1: CGPoint(x: 13.6, y: 6.9), control2: CGPoint(x: 8.3, y: 8.0))
    path.addCurve(to: CGPoint(x: 9.4, y: 14.0), control1: CGPoint(x: 8.3, y: 12.9), control2: CGPoint(x: 8.8, y: 13.6))
    path.addCurve(to: CGPoint(x: 6.2, y: 10.9), control1: CGPoint(x: 7.4, y: 13.6), control2: CGPoint(x: 6.4, y: 12.2))
    path.addCurve(to: CGPoint(x: 4.3, y: 15.7), control1: CGPoint(x: 4.9, y: 12.6), control2: CGPoint(x: 4.3, y: 14.0))
    path.addArc(center: CGPoint(x: 12, y: 15.7), radius: 7.7, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
    path.addCurve(to: CGPoint(x: 15.8, y: 5.9), control1: CGPoint(x: 19.7, y: 11.0), control2: CGPoint(x: 16.3, y: 9.0))
    path.addCurve(to: CGPoint(x: 15.7, y: 9.3), control1: CGPoint(x: 15.3, y: 7.1), control2: CGPoint(x: 15.3, y: 8.4))
    path.addCurve(to: CGPoint(x: 13.1, y: 2.6), control1: CGPoint(x: 14.0, y: 8.1), control2: CGPoint(x: 14.7, y: 5.0))
    path.closeSubpath()
    return path.applying(Self.scale(to: rect))
  }

  static func scale(to rect: CGRect) -> CGAffineTransform {
    let factor = min(rect.width, rect.height) / 24
    return CGAffineTransform(translationX: rect.minX + (rect.width - 24 * factor) / 2, y: rect.minY + (rect.height - 24 * factor) / 2).scaledBy(x: factor, y: factor)
  }
}

private struct FlameCore: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 12.8, y: 12.9))
    path.addCurve(to: CGPoint(x: 10.3, y: 17.6), control1: CGPoint(x: 13.0, y: 15.1), control2: CGPoint(x: 10.3, y: 15.7))
    path.addArc(center: CGPoint(x: 12.7, y: 17.6), radius: 2.4, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
    path.addCurve(to: CGPoint(x: 12.8, y: 12.9), control1: CGPoint(x: 15.1, y: 15.8), control2: CGPoint(x: 13.5, y: 15.1))
    path.closeSubpath()
    return path.applying(FlameBody.scale(to: rect))
  }
}

/// The streak flame. It settles with one small pulse when a lit or gilded state is earned, never loops,
/// and stays still under Reduce Motion.
struct HabitStreakFlame: View {
  let state: HabitFlameState
  var size: CGFloat = 22
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var pulse = false

  var body: some View {
    let stroke = max(1.1, size / 16)
    ZStack {
      FlameBody().fill(bodyFill)
      FlameBody().stroke(bodyStroke, style: StrokeStyle(lineWidth: stroke, lineJoin: .round))
      switch state {
      case .ember:
        FlameCore().stroke(Palette.inkMuted, style: StrokeStyle(lineWidth: stroke * 0.8, lineJoin: .round))
      case .dim:
        FlameCore().fill(Palette.todayWarning)
      case .lit:
        FlameCore().fill(Palette.streak)
        FlameCore().stroke(Palette.streakDeep, style: StrokeStyle(lineWidth: stroke * 0.8, lineJoin: .round))
      case .gilded:
        FlameCore().fill(Palette.streakCore)
      }
    }
    .frame(width: size, height: size)
    .scaleEffect(pulse ? 1.14 : 1)
    .animation(Motion.fast, value: state)
    .onChange(of: state) { old, new in
      guard old != new, new == .lit || new == .gilded, !reduceMotion else { return }
      withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.1)) { pulse = true }
      withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.16).delay(0.1)) { pulse = false }
    }
    .accessibilityHidden(true)
  }

  private var bodyFill: AnyShapeStyle {
    switch state {
    case .ember: return AnyShapeStyle(Palette.surfaceSoft)
    case .dim: return AnyShapeStyle(Palette.todayWarningTint)
    case .lit: return AnyShapeStyle(Palette.streakTint)
    case .gilded: return AnyShapeStyle(LinearGradient(colors: [Palette.streakGlow, Palette.streak], startPoint: .top, endPoint: .bottom))
    }
  }

  private var bodyStroke: Color {
    switch state {
    case .ember: return Palette.inkMuted
    case .dim: return Palette.todayWarning
    case .lit, .gilded: return Palette.streakDeep
    }
  }
}

/// The streak count beside a flame: tabular, heavier and gilded in gold, amber when at risk.
struct HabitStreakNumber: View {
  let streak: Int
  let state: HabitFlameState
  var size: CGFloat = Typography.Size.emphasis

  var body: some View {
    Text("\(streak)")
      .font(.ui(size, weight: state == .gilded ? .heavy : .bold))
      .tabular()
      .foregroundStyle(color)
      .contentTransition(.numericText(value: Double(streak)))
      .animation(Motion.base, value: streak)
  }

  private var color: AnyShapeStyle {
    switch state {
    case .ember: return AnyShapeStyle(Palette.inkMuted)
    case .dim: return AnyShapeStyle(Palette.todayWarning)
    case .lit: return AnyShapeStyle(Palette.streakDeep)
    case .gilded: return AnyShapeStyle(LinearGradient(colors: [Palette.streak, Palette.streakDeep], startPoint: .top, endPoint: .bottom))
    }
  }
}

private struct CrystalShell: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.addLines([CGPoint(x: 12, y: 2.5), CGPoint(x: 20.2, y: 7.25), CGPoint(x: 20.2, y: 16.75), CGPoint(x: 12, y: 21.5), CGPoint(x: 3.8, y: 16.75), CGPoint(x: 3.8, y: 7.25)])
    path.closeSubpath()
    return path.applying(FlameBody.scale(to: rect))
  }
}

private struct CrystalFacets: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let strokes: [[CGPoint]] = [
      [CGPoint(x: 12, y: 6), CGPoint(x: 12, y: 18)],
      [CGPoint(x: 6.8, y: 9), CGPoint(x: 17.2, y: 15)],
      [CGPoint(x: 6.8, y: 15), CGPoint(x: 17.2, y: 9)],
      [CGPoint(x: 10, y: 7.2), CGPoint(x: 12, y: 8.4), CGPoint(x: 14, y: 7.2)],
      [CGPoint(x: 10, y: 16.8), CGPoint(x: 12, y: 15.6), CGPoint(x: 14, y: 16.8)],
      [CGPoint(x: 7, y: 11.2), CGPoint(x: 9, y: 10.1), CGPoint(x: 9, y: 7.8)],
      [CGPoint(x: 15, y: 16.2), CGPoint(x: 15, y: 13.9), CGPoint(x: 17, y: 12.8)],
      [CGPoint(x: 7, y: 12.8), CGPoint(x: 9, y: 13.9), CGPoint(x: 9, y: 16.2)],
      [CGPoint(x: 15, y: 7.8), CGPoint(x: 15, y: 10.1), CGPoint(x: 17, y: 11.2)]
    ]
    for points in strokes { path.addLines(points) }
    return path.applying(FlameBody.scale(to: rect))
  }
}

/// The frost seal for freezes: a tinted hexagon with a six-way crystal.
struct HabitFreezeCrystal: View {
  var size: CGFloat = 14
  var color: Color = Palette.frozenInfo

  var body: some View {
    let line = max(0.9, size / 18)
    ZStack {
      CrystalShell().fill(Palette.frozenInfoTint)
      CrystalShell().stroke(color, style: StrokeStyle(lineWidth: line, lineJoin: .round))
      CrystalFacets().stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round, lineJoin: .round))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// A habit's tracked days in a month as a ring: complete, partial, freeze, and missed arcs with a small
/// gap between neighbors, and the completion rate in the center when there is room for it.
struct HabitCompletionRing: View {
  let row: HabitMonthRow
  var diameter: CGFloat = 104
  var lineWidth: CGFloat = 10
  var showsRate = true

  var body: some View {
    let radius = (diameter - lineWidth) / 2
    let gap = min(3, diameter / 12) / (2 * Double.pi * radius)
    ZStack {
      ForEach(Array(HabitRingArc.arcs(row.slices, gap: gap).enumerated()), id: \.offset) { _, arc in
        Circle()
          .inset(by: lineWidth / 2)
          .trim(from: arc.start, to: arc.end)
          .stroke(Self.color(arc.kind), style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
          .rotationEffect(.degrees(-90))
      }
      if showsRate {
        Text("\(row.completionRate)%")
          .font(.display(Typography.Size.title))
          .tabular()
          .foregroundStyle(Palette.ink)
      }
    }
    .frame(width: diameter, height: diameter)
    .animation(Motion.base, value: row.slices)
    .accessibilityHidden(!showsRate)
  }

  static func color(_ kind: HabitPerformanceSlice.Kind) -> Color {
    switch kind {
    case .complete: return Palette.completion
    case .partial: return Palette.completionSoft
    case .frozen: return Palette.frozenInfo
    case .missed: return Palette.overdueError
    case .untracked: return Palette.surfaceSoft
    }
  }
}
