import AppKit
import ManorKit
import SwiftUI

private enum TrackingView: String { case daily, history }

/// Tracking: habits, mood, and focus. Daily logs today or yesterday in one place; History reads all three
/// month by month.
struct TrackingPage: View {
  @Environment(AppContext.self) private var context
  @State private var habits: HabitsStore?
  @State private var moodFocus = MoodFocusStore()

  var body: some View {
    Group {
      if let habits {
        TrackingContent(habits: habits, moodFocus: moodFocus)
      } else {
        VStack(spacing: 0) {
          PageHeader("Tracking")
          Spacer()
        }
      }
    }
    .onAppear {
      if habits == nil {
        let context = context
        habits = HabitsStore(gateway: context.gateway, today: { context.today })
      }
    }
  }
}

struct TrackingContent: View {
  let habits: HabitsStore
  let moodFocus: MoodFocusStore
  @Environment(AppContext.self) private var context
  @AppStorage("tracking.view") private var viewRaw = TrackingView.daily.rawValue
  @State private var detailId: String?
  @State private var detailMonth = ""
  @State private var editor: HabitEditorModel?
  @State private var retireId: String?
  @State private var retiring = false
  @State private var dayEditor: DayEditorDraft?
  @State private var confirmDayDiscard = false

  private var view: Binding<TrackingView> {
    Binding(get: { TrackingView(rawValue: viewRaw) ?? .daily }, set: { viewRaw = $0.rawValue })
  }

  /// The account's today, from whichever store has read it.
  private var today: String {
    habits.state?.today ?? (moodFocus.today.isEmpty ? context.today : moodFocus.today)
  }

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Tracking") {
        SegmentedTabs([(TrackingView.daily, "Daily"), (.history, "History")], selection: view)
        Button { openEditor(nil) } label: { Label("New habit", systemImage: "plus") }
          .buttonStyle(.primary)
          .help("New habit (⌘N)")
      }
      // Daily reads as a centered page; History's charts and calendar use the whole width.
      .centeredColumn(view.wrappedValue == .daily)
      content
    }
    .background(Palette.surfaceCanvas)
    .task { await habits.load() }
    .task { await habits.listen() }
    .task(id: context.gateway.accountId) { await moodFocus.run(context: context) }
    .onChange(of: context.createRequests[.tracking]) { _, _ in
      if !habits.loading { openEditor(nil) }
    }
    .onChange(of: context.gateway.isConnected) { _, connected in
      // A load that failed for want of a connection runs again once it is back.
      guard connected else { return }
      if habits.errorMessage != nil { Task { await habits.load() } }
      if moodFocus.loadError != nil { Task { await moodFocus.load() } }
    }
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
      // Coming back after midnight moves today along.
      if let state = habits.state, state.today != context.today { Task { await habits.load() } }
    }
    .manorDialog(item: $detailId, width: 560) { id in detailPanel(id) }
    .manorDialog(isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil } }), width: 460, onDismiss: requestCloseEditor) {
      if let editor {
        HabitEditorPanel(model: editor, onClose: requestCloseEditor, onSave: saveEditor)
      }
    }
    .manorDialog(isPresented: Binding(get: { editor?.confirmDiscard == true }, set: { if !$0 { editor?.confirmDiscard = false } }), width: 380) {
      if let editor {
        ConfirmPanel(
          title: editor.isEditing ? "Discard these changes?" : "Discard this habit?",
          message: editor.isEditing ? "They have not been saved." : "It has not been added yet.",
          confirmLabel: "Discard", destructive: true,
          onCancel: { editor.confirmDiscard = false },
          onConfirm: { self.editor = nil }
        )
      }
    }
    .manorDialog(item: $retireId, width: 420) { id in
      ConfirmPanel(
        title: "Retire this habit?",
        message: "\(habits.state?.habit(id)?.name ?? "This habit") moves to your archive and stops appearing in the daily list. Its history stays, and you can bring it back any time.",
        confirmLabel: "Retire", destructive: false,
        onCancel: { retireId = nil },
        onConfirm: { confirmRetire(id) }
      )
      .disabled(retiring)
    }
    .manorDialog(item: $dayEditor, width: 660, onDismiss: requestCloseDay) { draft in
      DayEditorPanel(
        draft: Binding(get: { dayEditor ?? draft }, set: { dayEditor = $0 }),
        store: moodFocus, habits: habitsOn(dayEditor?.date ?? draft.date),
        onCancel: requestCloseDay, onSave: saveDay
      )
    }
    .manorDialog(isPresented: $confirmDayDiscard, width: 400) {
      ConfirmPanel(title: "Discard changes?", message: "Your check-in changes have not been saved.", confirmLabel: "Discard", destructive: true,
                   onCancel: { confirmDayDiscard = false }, onConfirm: { confirmDayDiscard = false; dayEditor = nil })
    }
  }

  @ViewBuilder
  private var content: some View {
    if habits.state == nil && habits.errorMessage == nil && !moodFocus.loaded && moodFocus.loadError == nil {
      Text("Loading…")
        .font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, Space.s8)
    } else {
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s4) {
          banners
          switch view.wrappedValue {
          case .daily:
            TrackingDailyView(
              habits: habits, moodFocus: moodFocus, today: today,
              onOpen: openDetail, onStatus: setStatus, onRetire: { retireId = $0 }, onNewHabit: { openEditor(nil) }
            )
          case .history:
            TrackingHistoryView(
              habits: habits, moodFocus: moodFocus, today: today,
              onOpenHabit: openDetail,
              onOpenDay: { openDay($0, adding: false) },
              onAddDay: { openDay(HabitDates.addDays(today, -1), adding: true) }
            )
          }
        }
        .padding(.horizontal, Space.s8)
        .padding(.bottom, Space.s10)
        .centeredColumn(view.wrappedValue == .daily)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
  }

  @ViewBuilder
  private var banners: some View {
    if let message = habits.errorMessage {
      ErrorBanner(message) { Task { await habits.load() } }
    }
    if let message = moodFocus.loadError {
      ErrorBanner(message) { Task { await moodFocus.load() } }
    } else if let message = moodFocus.saveError {
      ErrorBanner(message)
        .overlay(alignment: .topTrailing) {
          IconButton("xmark", label: "Dismiss", size: 24) { moodFocus.saveError = nil }.padding(Space.s1 + 2)
        }
        .transition(.opacity)
    }
  }

  // MARK: Habit details

  @ViewBuilder
  private func detailPanel(_ id: String) -> some View {
    if let data = habits.detail(habitId: id, month: detailMonth) {
      let definition = data.habit.definition
      HabitDetailPanel(
        data: data,
        month: $detailMonth,
        onClose: { detailId = nil },
        onEdit: {
          detailId = nil
          openEditor(definition)
        },
        onStatus: { setStatus(id, $0) },
        onRetire: { retireId = id }
      )
    }
  }

  private func openDetail(_ id: String) {
    detailMonth = view.wrappedValue == .history ? habits.historyMonth : HabitDates.monthKey(habits.selectedDate)
    detailId = id
  }

  // MARK: Habit editor

  private func openEditor(_ habit: HabitDefinition?) {
    editor = HabitEditorModel(habit: habit)
  }

  private func requestCloseEditor() {
    guard let editor, !editor.saving else { return }
    if editor.isDirty { editor.confirmDiscard = true } else { self.editor = nil }
  }

  private func saveEditor() {
    guard let editor, editor.isValid, !editor.saving else { return }
    editor.saving = true
    editor.error = nil
    Task {
      do {
        try await habits.save(editor.draft, editing: editor.habitId)
        if self.editor === editor { self.editor = nil }
      } catch {
        editor.error = "Could not save the habit. \(HabitsStore.message(error))"
      }
      editor.saving = false
    }
  }

  // MARK: Habit lifecycle

  private func setStatus(_ id: String, _ status: HabitLifecycleStatus) {
    Task { await changeStatus(id, status) }
  }

  @discardableResult
  private func changeStatus(_ id: String, _ status: HabitLifecycleStatus) async -> Bool {
    guard let name = await habits.setStatus(habitId: id, status) else { return false }
    switch status {
    case .retired:
      if detailId == id { detailId = nil }
      // Retiring is reversible while the toast is up: the same-day reactivation leaves no gap.
      context.toasts.show("\(name) moved to the archive", actionLabel: "Undo") { setStatus(id, .active) }
    case .paused:
      context.toasts.show("\(name) paused", actionLabel: "Undo") { setStatus(id, .active) }
    case .active:
      break
    }
    return true
  }

  private func confirmRetire(_ id: String) {
    guard !retiring else { return }
    retiring = true
    Task {
      if await changeStatus(id, .retired) { retireId = nil }
      retiring = false
    }
  }

  // MARK: Day editor

  private func openDay(_ date: String, adding: Bool) {
    guard moodFocus.loaded else { return }
    dayEditor = DayEditorDraft(date: date, adding: adding, baseline: moodFocus.committedEntry(on: date))
  }

  /// The habits active on a day and how each went, for the day editor.
  private func habitsOn(_ date: String) -> [DayEditorHabit] {
    guard let state = habits.state else { return [] }
    return HabitRules.active(on: date, in: state).map {
      DayEditorHabit(id: $0.id, name: $0.name, mark: HabitRules.mark($0, on: date, in: state))
    }
  }

  private func requestCloseDay() {
    guard let dayEditor, !dayEditor.saving else { return }
    if dayEditor.dirty { confirmDayDiscard = true } else { self.dayEditor = nil }
  }

  private func saveDay() {
    guard var draft = dayEditor, !draft.saving else { return }
    guard draft.mood != nil || draft.focus != nil else {
      draft.error = "Choose a mood or focus rating."
      dayEditor = draft
      return
    }
    draft.saving = true
    draft.error = nil
    dayEditor = draft
    let mutation = MoodFocusHistoryMutation(date: draft.date, mood: draft.mood, focus: draft.focus, expectedUpdatedAt: draft.baseline?.updatedAt)
    Task {
      do {
        try await moodFocus.saveHistory(mutation)
        habits.historyMonth = HabitDates.monthKey(mutation.date)
        dayEditor = nil
      } catch {
        dayEditor?.saving = false
        dayEditor?.error = error.localizedDescription
      }
    }
  }
}
