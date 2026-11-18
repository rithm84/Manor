import ManorKit
import SwiftUI

/// The editor for one day's check-in: opened from a calendar day, or from Log a past day with a date field.
struct DayEditorDraft: Identifiable, Equatable {
  let id = UUID()
  var date: String
  var adding: Bool
  /// The committed record when the editor opened. Saves compare against it, so a record that changed
  /// underneath the editor is refused rather than overwritten.
  var baseline: MoodFocusEntry?
  var mood: Mood?
  var focus: Focus?
  var saving = false
  var error: String?

  init(date: String, adding: Bool, baseline: MoodFocusEntry?) {
    self.date = date
    self.adding = adding
    self.baseline = baseline
    mood = baseline?.mood
    focus = baseline?.focus
  }

  var dirty: Bool { mood != baseline?.mood || focus != baseline?.focus }
}

/// One habit's state on the day the editor shows. Habits are read only here: they log from Daily.
struct DayEditorHabit: Identifiable {
  let id: String
  let name: String
  let mark: HabitDayMark
}

struct DayEditorPanel: View {
  @Binding var draft: DayEditorDraft
  let store: MoodFocusStore
  let habits: [DayEditorHabit]
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    DialogPanel(draft.adding ? "Log a past day" : HabitDates.fullDateLabel(draft.date), onClose: onCancel) {
      VStack(alignment: .leading, spacing: Space.s4) {
        if draft.adding {
          HStack {
            Text("Day").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
            Spacer()
            ManorDatePicker("Day", selection: dayBinding, maximum: HabitDates.addDays(store.today, -1),
                            quickPicks: [.yesterday, .custom("2 days ago", days: -2), .custom("A week ago", days: -7)])
              .fixedSize()
          }
        }
        HabitListCard {
          CheckInRow(mood: draft.mood) { draft.mood = $0 }
          Hairline()
          CheckInRow(focus: draft.focus) { draft.focus = $0 }
        }
        if !habits.isEmpty { habitsDone }
        if let error = draft.error {
          Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Space.s3).padding(.vertical, Space.s2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
        }
      }
      .padding(.top, Space.s1)
    } footer: {
      Button("Cancel", action: onCancel).buttonStyle(.ghost).disabled(draft.saving).keyboardShortcut(.cancelAction)
      Button(draft.saving ? "Saving…" : (draft.baseline == nil ? "Add check-in" : "Save changes"), action: onSave)
        .buttonStyle(.primary)
        .disabled(draft.saving || !draft.dirty || (draft.mood == nil && draft.focus == nil))
        .keyboardShortcut(.defaultAction)
    }
  }

  private var habitsDone: some View {
    let done = habits.filter { $0.mark == .complete }.count
    return VStack(alignment: .leading, spacing: Space.s2) {
      HStack {
        Text("Habits").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.inkBody)
        Spacer()
        Text("\(done) of \(habits.count) done").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
      }
      FlowRow(spacing: 6) {
        ForEach(habits) { habit in
          HStack(spacing: 5) {
            HabitWeekSegment(mark: habit.mark, selected: false).scaleEffect(0.85).frame(width: 18, height: 12)
            Text(habit.name).font(.ui(Typography.Size.xs, weight: .medium))
              .foregroundStyle(habit.mark == .complete ? Palette.ink : Palette.inkMuted)
              .lineLimit(1)
          }
          .padding(.horizontal, Space.s2)
          .frame(height: 24)
          .background(Capsule().fill(Palette.surfacePaper))
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(habit.name), \(habit.mark.rawValue)")
        }
      }
    }
  }

  /// The latest day a correction accepts: yesterday, in the account's time zone. Today logs from Daily.
  /// Picking another day reloads its committed ratings; the draft follows the new day.
  private var dayBinding: Binding<String> {
    Binding(
      get: { draft.date },
      set: { picked in
        let date = min(picked, HabitDates.addDays(store.today, -1))
        guard date != draft.date else { return }
        draft = DayEditorDraft(date: date, adding: true, baseline: store.committedEntry(on: date))
      }
    )
  }
}

/// Lays children left to right and wraps them onto new lines.
struct FlowRow: SwiftUI.Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width { x = 0; y += line + spacing; line = 0 }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}
