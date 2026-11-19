import ManorKit
import SwiftUI

enum PomodoroTab: String { case timer, history }

/// Pomodoro: the timer first, month statistics and the session log under History. The clock itself lives
/// in `PomodoroStore`, owned app-wide by `PomodoroAppHook`, so it keeps running on every page.
struct PomodoroPage: View {
  @Environment(PomodoroStore.self) private var store
  @AppStorage("manor.pomodoro.view") private var tab: PomodoroTab = .timer
  /// The preferences being edited; nil while the dialog is closed.
  @State private var preferences: PomodoroSettings?
  @State private var confirmDiscard = false
  @State private var savingPreferences = false
  @State private var month: String?
  @State private var confirmDelete: PomodoroSession?

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Pomodoro") {
        SegmentedTabs([(PomodoroTab.timer, "Timer"), (PomodoroTab.history, "History")], selection: $tab)
        IconButton("slider.horizontal.3", label: "Timer preferences", size: 32) { preferences = store.settings }
          .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
      }
      // A centered page, like Daily tracking and Bookmarks; the timer stage centers itself below.
      .centeredColumn()
      if let error = store.error, store.loaded {
        ErrorBanner(error)
          .overlay(alignment: .topTrailing) {
            IconButton("xmark", label: "Dismiss", size: 24) { store.error = nil }.padding(Space.s1 + 2)
          }
          .padding(.horizontal, Space.s8)
          .padding(.bottom, Space.s3)
          .centeredColumn()
      }
      if !store.loaded {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        switch tab {
        case .timer:
          PomodoroTimerStage()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, Space.s12)
        case .history:
          PomodoroHistoryView(month: Binding(get: { month ?? PomodoroDates.monthOf(store.today) }, set: { month = $0 }), confirmDelete: $confirmDelete)
        }
      }
    }
    .animation(Motion.base, value: store.error)
    .manorDialog(isPresented: preferencesOpen, width: 480, onDismiss: closePreferences) {
      PomodoroPreferencesPanel(
        draft: Binding(get: { preferences ?? store.settings }, set: { preferences = $0 }),
        saved: store.settings,
        saving: savingPreferences,
        onCancel: closePreferences,
        onSave: savePreferences
      )
    }
    .manorDialog(isPresented: $confirmDiscard, width: 380) {
      ConfirmPanel(title: "Discard these changes?", message: "They have not been saved.", confirmLabel: "Discard", destructive: true,
                   onCancel: { confirmDiscard = false }, onConfirm: { confirmDiscard = false; preferences = nil })
    }
    .onChange(of: preferences != nil) { _, open in store.openDialogs += open ? 1 : -1 }
    .manorDialog(item: $confirmDelete, width: 400) { session in
      ConfirmPanel(
        title: "Delete this session?",
        message: "\(session.label ?? "This focus session") leaves your history and statistics. This can't be undone.",
        confirmLabel: "Delete session",
        onCancel: { confirmDelete = nil },
        onConfirm: {
          confirmDelete = nil
          store.remove(session.id)
        }
      )
    }
    .onChange(of: confirmDelete != nil) { _, open in store.openDialogs += open ? 1 : -1 }
  }

  private var preferencesOpen: Binding<Bool> {
    Binding(get: { preferences != nil }, set: { if !$0 { preferences = nil } })
  }

  /// Escape, the backdrop, and Cancel ask before dropping unsaved changes.
  private func closePreferences() {
    guard !savingPreferences else { return }
    if let preferences, preferences != store.settings { confirmDiscard = true } else { preferences = nil }
  }

  private func savePreferences() {
    guard let draft = preferences, !savingPreferences else { return }
    if draft == store.settings { preferences = nil; return }
    savingPreferences = true
    Task {
      if await store.saveSettings(draft) { preferences = nil }
      savingPreferences = false
    }
  }
}
