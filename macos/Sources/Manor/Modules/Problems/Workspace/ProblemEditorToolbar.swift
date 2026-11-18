import ManorKit
import SwiftUI

/// LeetCode's editor bar: the language on the left; save state, reset, settings, and full screen on the right.
struct WorkspaceEditorToolbar: View {
  @Bindable var model: ProblemWorkspaceModel
  @State private var showSettings = false

  var body: some View {
    HStack(spacing: Space.s3) {
      ManorSelect("Solution language", selection: Binding(get: { model.language }, set: { if let language = $0 { model.chooseLanguage(language) } }),
                  options: model.languages.map { ManorSelectOption($0, $0.label) }, placeholder: "Language", style: .toolbar)
      .fixedSize()
      .disabled(model.busy || model.language == nil)
      .help("Solution language")

      DraftSaveState(status: model.draftStatus, conflict: model.draftConflict != nil, onResolve: model.resolveDraft)

      Spacer(minLength: 0)

      IconButton("arrow.counterclockwise", label: "Reset to starter code") { model.confirmReset = true }
        .disabled(model.busy || !model.hasCode)
      IconButton("textformat.size", label: "Editor settings") { showSettings.toggle() }
        .manorPopover(isPresented: $showSettings) { EditorSettingsPanel(model: model) }
      IconButton(model.fullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", label: model.fullscreen ? "Exit full screen (Esc)" : "Full screen") {
        withAnimation(Motion.panel) { model.fullscreen.toggle() }
      }
    }
    .padding(.leading, Space.s3)
    .padding(.trailing, Space.s2)
    .frame(height: workspaceStripHeight - 1)
  }
}

private struct EditorSettingsPanel: View {
  @Bindable var model: ProblemWorkspaceModel

  var body: some View {
    let sizes = ProblemWorkspacePreferences.fontSizes
    let index = sizes.firstIndex(of: model.fontSize) ?? 2
    VStack(alignment: .leading, spacing: Space.s3) {
      HStack(spacing: Space.s4) {
        Text("Font size").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
        Spacer()
        HStack(spacing: 0) {
          IconButton("minus", label: "Smaller font", size: 26) { model.fontSize = sizes[max(0, index - 1)] }.disabled(index == 0)
          Text("\(model.fontSize)").font(.ui(Typography.Size.sm, weight: .semibold)).tabular().frame(minWidth: 32)
          IconButton("plus", label: "Larger font", size: 26) { model.fontSize = sizes[min(sizes.count - 1, index + 1)] }.disabled(index == sizes.count - 1)
        }
        .padding(2)
        .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.control))
      }
      HStack(spacing: Space.s4) {
        Text("Tab size").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
        Spacer()
        SegmentedTabs(ProblemWorkspacePreferences.tabSizes.map { (value: $0, label: "\($0)") }, selection: $model.tabSize)
          .fixedSize()
      }
    }
    .padding(Space.s3)
    .frame(width: 260)
  }
}

/// A quiet save indicator: a muted cloud at rest, "Saving…" only for slow saves, a brief check, and a warning that
/// stays until resolved. Its width is reserved so the toolbar never shifts.
private struct DraftSaveState: View {
  enum Display: Equatable { case none, idle, saving, justSaved, queued, attention }
  let status: CodeDraftStatus
  let conflict: Bool
  let onResolve: () -> Void
  @State private var view: Display = .none
  @State private var savedAt: Date?
  @State private var shownSaving = false
  @State private var timer: Task<Void, Never>?

  var body: some View {
    HStack(spacing: Space.s1) {
      switch view {
      case .none: EmptyView()
      case .attention:
        Button(action: onResolve) {
          Label(conflict ? "Compare" : "Not synced", systemImage: "exclamationmark.triangle")
            .font(.ui(Typography.Size.xs, weight: .semibold))
            .foregroundStyle(Palette.warning)
            .padding(.horizontal, Space.s2)
            .frame(height: 24)
            .background(Palette.warningSoft, in: RoundedRectangle(cornerRadius: Radius.chip))
        }
        .buttonStyle(.plain)
        .help(conflict ? "Your code changed on another device. Compare the drafts." : "Your code is safe on this Mac but did not reach the cloud. Try again.")
      case .saving:
        ProgressView().controlSize(.mini)
        Text("Saving…").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
      case .justSaved:
        Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.completion)
          .help(savedLabel)
      case .idle:
        Image(systemName: "checkmark.icloud").font(.system(size: 13)).foregroundStyle(Palette.inkMuted)
          .help(savedLabel)
      case .queued:
        Image(systemName: "icloud.slash").font(.system(size: 13)).foregroundStyle(Palette.inkMuted)
          .help("Saved on this Mac. It syncs to the cloud when it can.")
      }
    }
    .frame(minWidth: 96, alignment: .leading)
    .animation(Motion.base, value: view)
    .onChange(of: status, initial: true) { update() }
    .onChange(of: conflict) { update() }
  }

  private var savedLabel: String {
    guard let savedAt else { return "Saved to cloud" }
    return "Saved to cloud at \(savedAt.formatted(date: .omitted, time: .shortened))"
  }

  private func after(_ delay: Duration, _ action: @escaping () -> Void) {
    timer?.cancel()
    timer = Task { try? await Task.sleep(for: delay); if !Task.isCancelled { action() } }
  }

  private func update() {
    timer?.cancel()
    if status == .failed || conflict { shownSaving = false; view = .attention; return }
    switch status {
    case .loading: shownSaving = false; view = .none
    case .saved:
      savedAt = Date()
      if !shownSaving { view = .idle; return }
      shownSaving = false
      view = .justSaved
      after(.milliseconds(1500)) { view = .idle }
    case .protected:
      // Local-only code that stays unsynced well past the save delay is queued.
      after(.seconds(2)) { shownSaving = false; view = .queued }
    default:
      after(.milliseconds(300)) { shownSaving = true; view = .saving }
    }
  }
}
