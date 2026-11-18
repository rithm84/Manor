import ManorKit
import SwiftUI

/// The ring, the clock, and the controls. One session at a time; the finished ring holds until the next
/// step is chosen.
struct PomodoroTimerStage: View {
  @Environment(PomodoroStore.self) private var store
  @State private var editingLabel: String?
  @FocusState private var labelFocused: Bool
  @FocusState private var draftFocused: Bool

  var body: some View {
    let phase = store.phase
    let shown = store.active ?? store.ended
    let kind = shown?.kind ?? store.next
    let tone = PomodoroTone(kind: kind)
    VStack(spacing: Space.s5) {
      PomodoroRing(tone: tone, phase: phase, endedId: store.ended?.id) {
        face(phase: phase, kind: kind, tone: tone)
      }
      labelRow(phase: phase, shown: shown, kind: kind)
        .frame(minHeight: 36)
      controls(phase: phase, kind: kind)
    }
    .padding(.top, Space.s6)
    .padding(.bottom, Space.s4)
    .frame(maxWidth: 480)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Timer")
  }

  // MARK: Face

  private func face(phase: PomodoroPhase, kind: PomodoroKind, tone: PomodoroTone) -> some View {
    let seconds: Int
    if let clock = store.clock { seconds = clock.remainingSeconds }
    else if let ended = store.ended { seconds = ended.plannedSeconds }
    else { seconds = store.settings.plannedSeconds(store.next) }
    let status: String
    switch phase {
    case .ended: status = kind == .focus ? "Focus complete" : "Break over"
    case .paused: status = "\(kind.label) paused"
    default: status = kind.label
    }
    let position = Pomodoro.cyclePosition(completedToday: store.completedToday, longBreakEvery: store.settings.longBreakEvery)
    return VStack(spacing: 6) {
      Text(status)
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(phase == .ended ? tone.strong : Palette.inkMuted)
      Text(Pomodoro.formatClock(seconds))
        .font(.display(64, weight: .medium))
        .kerning(-1)
        .monospacedDigit()
        .foregroundStyle(phase == .ended ? tone.strong : (phase == .paused ? Palette.inkMuted : Palette.ink))
        .accessibilityLabel("\(Pomodoro.formatClock(seconds)) \(phase == .ended ? "done" : "remaining")")
      if kind == .focus && phase != .ended {
        HStack(spacing: 6) {
          ForEach(0..<store.settings.longBreakEvery, id: \.self) { index in
            Circle().fill(index < position ? tone.strong : Palette.surfaceStrong).frame(width: 7, height: 7)
          }
        }
        .padding(.top, 4)
        .animation(Motion.base, value: position)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(store.completedToday) focus sessions completed today")
      }
    }
  }

  // MARK: Label

  @ViewBuilder
  private func labelRow(phase: PomodoroPhase, shown: PomodoroSession?, kind: PomodoroKind) -> some View {
    @Bindable var store = store
    if phase == .idle {
      TextField("What are you focusing on?", text: $store.draftLabel)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.md, weight: .medium))
        .multilineTextAlignment(.center)
        .padding(.horizontal, Space.s3)
        .frame(width: 420, height: 36)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .strokeBorder(draftFocused ? Palette.focusBorder : Palette.hairline, lineWidth: draftFocused ? 1.5 : 1))
        .focused($draftFocused)
        .onSubmit { if !store.busy { draftFocused = false; store.startFocusFromDraft() } }
        .onChange(of: store.draftLabel) { _, text in
          if text.count > PomodoroLimits.label { store.draftLabel = String(text.prefix(PomodoroLimits.label)) }
        }
        .accessibilityLabel("Session label")
    } else if let active = store.active, active.kind == .focus {
      if let editing = editingLabel {
        TextField("What are you focusing on?", text: Binding(get: { editing }, set: { editingLabel = String($0.prefix(PomodoroLimits.label)) }))
          .textFieldStyle(.plain)
          .font(.ui(Typography.Size.md, weight: .medium))
          .multilineTextAlignment(.center)
          .padding(.horizontal, Space.s3)
          .frame(width: 420, height: 36)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCard))
          .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.focusBorder, lineWidth: 1.5))
          .focused($labelFocused)
          .onAppear { labelFocused = true }
          .onSubmit { commitLabel() }
          .onExitCommand { editingLabel = nil }
          .onChange(of: labelFocused) { _, focused in if !focused { commitLabel() } }
          .accessibilityLabel("Session label")
      } else {
        PomodoroLabelButton(text: active.label ?? "Add a label", empty: active.label == nil) { editingLabel = active.label ?? "" }
      }
    } else {
      let text = shown?.label ?? (phase == .ended ? (kind == .focus ? "Nice work." : "Ready when you are.") : "Step away for a moment.")
      Text(text)
        .font(.ui(Typography.Size.md, weight: shown?.label == nil ? .regular : .medium))
        .foregroundStyle(shown?.label == nil ? Palette.inkMuted : Palette.ink)
        .lineLimit(1)
        .frame(maxWidth: 420)
    }
  }

  private func commitLabel() {
    guard let editing = editingLabel, let active = store.active else { editingLabel = nil; return }
    editingLabel = nil
    let trimmed = editing.trimmingCharacters(in: .whitespacesAndNewlines)
    let next = trimmed.isEmpty ? nil : trimmed
    if next != active.label { store.relabel(active.id, label: next) }
  }

  // MARK: Controls

  @ViewBuilder
  private func controls(phase: PomodoroPhase, kind: PomodoroKind) -> some View {
    HStack(spacing: Space.s2) {
      switch phase {
      case .idle:
        primary("Start focus", systemImage: "play.fill") { draftFocused = false; store.startFocusFromDraft() }
        secondary("Take a break", systemImage: "cup.and.saucer") { Task { await store.start(.shortBreak, label: nil) } }
      case .running:
        primary("Pause", systemImage: "pause.fill") { store.pause() }
        secondary(kind == .focus ? "Stop" : "Skip break", systemImage: "stop") { store.stopEarly() }
      case .paused:
        primary("Resume", systemImage: "play.fill") { store.resume() }
        secondary(kind == .focus ? "Stop" : "Skip break", systemImage: "stop") { store.stopEarly() }
      case .ended:
        let next = store.next
        primary(next == .focus ? "Start focus" : "Start \(next.label.lowercased())", systemImage: next == .focus ? "play.fill" : "cup.and.saucer.fill") { store.startNext() }
        secondary(next == .focus ? "Not yet" : "Skip break", systemImage: nil) { store.acknowledge() }
      }
    }
    .disabled(store.busy)
    .animation(Motion.fast, value: phase)
  }

  private func primary(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: systemImage).frame(minWidth: 124)
    }
    .buttonStyle(.primary)
    .help("\(title) (Space)")
  }

  private func secondary(_ title: String, systemImage: String?, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      if let systemImage { Label(title, systemImage: systemImage) } else { Text(title) }
    }
    .buttonStyle(.ghost)
  }
}

/// Plum for focus, teal for breaks.
struct PomodoroTone {
  let strong: Color
  let tint: Color

  init(kind: PomodoroKind) {
    strong = kind == .focus ? Palette.primary : Palette.secondary
    tint = kind == .focus ? Palette.primaryTint : Palette.secondaryTint
  }
}

/// The single progress ring. The arc moves once a second without easing, so it reads as a clock; a
/// finished session blooms once from the ring and settles. Nothing loops at rest.
private struct PomodoroRing<Face: View>: View {
  let tone: PomodoroTone
  let phase: PomodoroPhase
  let endedId: String?
  @ViewBuilder let face: () -> Face
  @Environment(PomodoroStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var bloom = false

  private let size: CGFloat = 272
  private let stroke: CGFloat = 8

  var body: some View {
    let progress: Double = store.clock?.progress ?? (phase == .ended ? 1 : 0)
    ZStack {
      Circle().stroke(Palette.surfaceSoft, lineWidth: stroke)
      Circle()
        .trim(from: 0, to: progress)
        .stroke(phase == .paused ? tone.strong.opacity(0.55) : tone.strong,
                style: StrokeStyle(lineWidth: stroke, lineCap: progress >= 1 || progress <= 0 ? .butt : .round))
        .rotationEffect(.degrees(-90))
        .animation(phase == .running ? .linear(duration: 1) : Motion.base, value: progress)
        .animation(Motion.base, value: phase)
      if !reduceMotion {
        Circle()
          .stroke(tone.strong, lineWidth: stroke)
          .scaleEffect(bloom ? 1.16 : 1)
          .opacity(bloom ? 0 : (endedId == nil ? 0 : 0.55))
          .allowsHitTesting(false)
      }
      face()
    }
    .padding(stroke / 2)
    .frame(width: size, height: size)
    .onChange(of: endedId) { _, id in
      guard id != nil, !reduceMotion else { return }
      bloom = false
      withAnimation(.timingCurve(0.23, 1, 0.32, 1, duration: 0.64)) { bloom = true }
    }
  }
}

private struct PomodoroLabelButton: View {
  let text: String
  let empty: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Text(text)
        .font(.ui(Typography.Size.md, weight: empty ? .regular : .medium))
        .foregroundStyle(empty ? Palette.inkMuted : Palette.ink)
        .lineLimit(1)
        .padding(.horizontal, Space.s3)
        .frame(maxWidth: 420, minHeight: 36)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering ? Palette.surfaceSoft : .clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .help("Edit label")
  }
}
