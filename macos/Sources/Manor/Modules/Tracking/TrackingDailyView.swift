import ManorKit
import SwiftUI

/// The day's logging: the day bar, the mood and focus check-in, the habit list with
/// drag ordering, paused and archived habits, and the rail with the day's progress and the freeze pool.
/// Today and yesterday can be logged; the day bar steps between them.
struct TrackingDailyView: View {
  let habits: HabitsStore
  let moodFocus: MoodFocusStore
  let today: String
  let onOpen: (String) -> Void
  let onStatus: (String, HabitLifecycleStatus) -> Void
  let onRetire: (String) -> Void
  let onNewHabit: () -> Void
  @State private var archiveOpen = false
  @State private var width: CGFloat = 900

  private var date: String { habits.selectedDate }
  private var yesterday: String { HabitDates.addDays(today, -1) }
  private var daily: HabitsDailySnapshot? { habits.daily }
  private var hasHabits: Bool { !(habits.state?.habits.isEmpty ?? true) }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      dayBar
      checkIn
      if width >= 760, hasHabits, let daily {
        HStack(alignment: .top, spacing: Space.s4) {
          habitLists(daily).frame(maxWidth: .infinity, alignment: .topLeading)
          HabitsStatusRail(daily: daily).frame(width: width >= 980 ? 312 : 264)
        }
      } else {
        VStack(alignment: .leading, spacing: Space.s4) {
          if hasHabits, let daily {
            HabitsStatusRail(daily: daily)
            habitLists(daily)
          } else {
            habitsPlaceholder
          }
        }
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
  }

  // MARK: Day bar

  private var dayBar: some View {
    HStack(alignment: .center) {
      HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
        Text(HabitDates.dayLabel(date, today: today))
          .font(.ui(Typography.Size.emphasis, weight: .semibold)).foregroundStyle(Palette.ink)
          .contentTransition(.opacity)
        Text(HabitDates.fullDateLabel(date)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      Spacer()
      HStack(spacing: 2) {
        HabitDayStepButton(systemImage: "chevron.left", label: date == yesterday ? "You can log as far back as yesterday" : "Yesterday", enabled: date != yesterday) {
          habits.selectedDate = yesterday
        }
        HabitDayStepButton(systemImage: "chevron.right", label: "Today", enabled: date != today) {
          habits.selectedDate = today
        }
      }
    }
    .padding(.horizontal, Space.s1)
    .frame(minHeight: 44)
    .overlay(alignment: .bottom) { Hairline() }
  }

  // MARK: Check-in

  /// Mood and focus as one band above the habits. Each row carries its week on the trailing edge, as the
  /// habit rows do, when the band is wide enough.
  private var checkIn: some View {
    let entry = moodFocus.entry(on: date)
    // Quick capture covers today and yesterday, the same reach as habit backfill.
    let ready = moodFocus.loaded && MoodFocusHistory.canQuickCapture(date, today: today)
    let showsWeek = width >= 780
    return HabitListCard {
      CheckInRow(
        mood: entry?.mood,
        week: showsWeek ? CheckInWeekDay.week(around: date, today: today) { moodFocus.entry(on: $0)?.mood } : nil
      ) { moodFocus.setMood($0, on: date) }
      Hairline()
      CheckInRow(
        focus: entry?.focus,
        week: showsWeek ? CheckInWeekDay.week(around: date, today: today) { moodFocus.entry(on: $0)?.focus } : nil
      ) { moodFocus.setFocus($0, on: date) }
    }
    .disabled(!ready)
  }

  // MARK: Habits

  private func habitLists(_ daily: HabitsDailySnapshot) -> some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      if daily.active.isEmpty {
        Text(daily.isToday ? "No active habits today." : "No habits were active yesterday.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          .padding(.horizontal, Space.s1).padding(.vertical, Space.s3)
      } else {
        ReorderableHabitList(store: habits, daily: daily, onOpen: onOpen, onStatus: onStatus, onRetire: onRetire)
      }
      if !daily.paused.isEmpty { pausedSection(daily) }
      if !daily.archived.isEmpty { archivedSection(daily) }
    }
  }

  /// Where the habit list goes while there are no habits yet, or while they are still loading.
  @ViewBuilder
  private var habitsPlaceholder: some View {
    if habits.state == nil {
      if habits.loading {
        Text("Loading habits…").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(.horizontal, Space.s1)
      }
    } else {
      HabitListCard {
        HStack(spacing: Space.s3) {
          HabitStreakFlame(state: .ember, size: 26)
          VStack(alignment: .leading, spacing: 2) {
            Text("No habits yet").font(.ui(Typography.Size.md, weight: .semibold)).foregroundStyle(Palette.ink)
            Text("Add a habit to check it off here each day.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
          Spacer(minLength: Space.s3)
          Button(action: onNewHabit) { Label("New habit", systemImage: "plus") }.buttonStyle(.secondary)
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s4)
      }
    }
  }

  private func pausedSection(_ daily: HabitsDailySnapshot) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Text("Paused").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted).padding(.leading, Space.s1)
      HabitListCard {
        ForEach(Array(daily.paused.enumerated()), id: \.element.id) { index, habit in
          if index > 0 { Hairline() }
          HabitRowView(habit: habit, isToday: true, onOpen: { onOpen(habit.id) }, onResume: { onStatus(habit.id, .active) })
            .contextMenu {
              Button("Open details") { onOpen(habit.id) }
              Button("Resume") { onStatus(habit.id, .active) }
              Divider()
              Button("Retire…") { onRetire(habit.id) }
            }
        }
      }
    }
  }

  private func archivedSection(_ daily: HabitsDailySnapshot) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Button { withAnimation(Motion.base) { archiveOpen.toggle() } } label: {
        HStack(spacing: 6) {
          Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
            .rotationEffect(.degrees(archiveOpen ? 90 : 0))
          Text("Archived").font(.ui(Typography.Size.sm, weight: .medium))
          Text("\(daily.archived.count)").font(.ui(Typography.Size.sm)).tabular()
        }
        .foregroundStyle(Palette.inkMuted)
        .padding(.horizontal, Space.s1).padding(.vertical, Space.s1)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Archived, \(daily.archived.count)")
      .accessibilityValue(archiveOpen ? "Expanded" : "Collapsed")
      if archiveOpen {
        HabitListCard {
          ForEach(Array(daily.archived.enumerated()), id: \.element.id) { index, habit in
            if index > 0 { Hairline() }
            HStack(spacing: Space.s3) {
              Button { onOpen(habit.id) } label: {
                Text(habit.name).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted).lineLimit(1)
                  .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              Button("Reactivate") { onStatus(habit.id, .active) }.buttonStyle(.manor(.ghost, size: .small))
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2)
          }
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
  }
}
