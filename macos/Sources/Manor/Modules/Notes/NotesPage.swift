import ManorKit
import SwiftUI

/// Notes: the note list beside the editor. The list collapses into a slim rail the Mac remembers; coming back
/// during a session reopens the note you left, and a relaunch opens with no note selected.
struct NotesPage: View {
  @Environment(AppContext.self) private var context
  @State private var store: NotesStore?
  @State private var failed = false

  var body: some View {
    Group {
      if let store {
        NotesWorkspace(store: store)
      } else if failed {
        EmptyState(systemImage: "exclamationmark.triangle", title: "Notes could not open",
                   message: "Manor could not open the place it keeps your note drafts on this Mac. Quit and reopen Manor to try again.")
      } else {
        Color.clear
      }
    }
    .background(Palette.surfaceCanvas)
    .task {
      guard store == nil else { return }
      guard let service = NotesRuntime.service(for: context.gateway) else { failed = true; return }
      let created = NotesStore(service: service, gateway: context.gateway, toasts: context.toasts)
      store = created
      var linked: String?
      if let target = context.linkTarget, target.route == .notes {
        linked = target.path.first ?? target.query["note"]
        context.linkTarget = nil
      }
      await created.start(linkedNoteId: linked)
    }
  }
}

private struct NotesWorkspace: View {
  @Environment(AppContext.self) private var context
  @Environment(\.pageIsActive) private var isActive
  @Bindable var store: NotesStore
  @FocusState private var searchFocused: Bool

  private var linkKey: String? {
    guard let target = context.linkTarget, target.route == .notes else { return nil }
    return target.path.first ?? target.query["note"]
  }

  var body: some View {
    HStack(spacing: 0) {
      NotesListPane(store: store, searchFocused: $searchFocused)
      Rectangle().fill(Palette.hairline).frame(width: 1)
      NotesEditorPane(store: store)
    }
    .animation(Motion.panel, value: store.listCollapsed)
    .background(shortcuts)
    .manorDialog(item: $store.dialog, width: 440) { dialog in
      switch dialog {
      case .newFolder: NoteFolderDialog(store: store, folder: nil) { store.dialog = nil }
      case .renameFolder(let folder): NoteFolderDialog(store: store, folder: folder) { store.dialog = nil }
      case .move(let page): NoteMoveDialog(store: store, page: page) { store.dialog = nil }
      case .moveBlocks(let page, let ids): NoteMoveBlocksDialog(store: store, page: page, blockIds: ids) { store.dialog = nil }
      }
    }
    .manorDialog(item: $store.purgeRequest, width: 440) { ids in
      NotePurgeDialog(store: store, ids: ids)
    }
    .manorDialog(item: reviewBinding, width: 860) { review in
      if let page = store.selectedPage {
        NoteReviewDialog(store: store, mode: review, page: page) { store.review = nil }
      }
    }
    .onChange(of: context.createRequests[.notes]) {
      Task { await store.createPage() }
    }
    .onChange(of: linkKey) { _, id in
      guard let id else { return }
      context.linkTarget = nil
      Task { await store.openLinked(id) }
    }
    .onChange(of: context.gateway.isConnected) { _, connected in
      if connected { store.connectionRestored() }
    }
    .onChange(of: isActive) { _, active in
      // Leaving Notes mid-debounce sends the edit instead of leaving it waiting for the next visit.
      if !active { Task { await store.runPendingSave() } }
    }
  }

  private var reviewBinding: Binding<NotesStore.ReviewMode?> {
    Binding(get: { store.selectedPage == nil ? nil : store.review }, set: { store.review = $0 })
  }

  /// Page shortcuts, live only while Notes is the visible page.
  private var shortcuts: some View {
    ZStack {
      Button("Save note") { Task { await store.runPendingSave() } }
        .keyboardShortcut("s", modifiers: .command)
      Button("Find in note") { if store.selectedId != nil { store.findOpen = true } }
        .keyboardShortcut("f", modifiers: .command)
      Button("Search notes") {
        store.listCollapsed = false
        DispatchQueue.main.async { searchFocused = true }
      }
      .keyboardShortcut("f", modifiers: [.command, .shift])
    }
    .disabled(!isActive)
    .opacity(0)
    .frame(width: 0, height: 0)
    .accessibilityHidden(true)
  }
}
