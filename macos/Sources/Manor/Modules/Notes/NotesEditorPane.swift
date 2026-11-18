import ManorKit
import SwiftUI

/// The editor column: notices, the toolbar (where the note lives, whether it is safe, its star and actions),
/// the title, and the block editor. Notes in Trash read only.
struct NotesEditorPane: View {
  @Environment(AppContext.self) private var context
  @Environment(\.windowButtonsClearance) private var buttonsClearance
  @Bindable var store: NotesStore

  var body: some View {
    VStack(spacing: 0) {
      notices
      if let page = store.selectedPage, let draft = store.draft, draft.id == page.id {
        toolbar(page)
        if store.findOpen {
          NoteFindBar(store: store, blocks: draft.blocks)
            .padding(.horizontal, Space.s4)
            .padding(.bottom, Space.s2)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
        document(page, draft)
      } else {
        emptyEditor
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Palette.surfaceCanvas)
    .animation(Motion.fast, value: store.findOpen)
  }

  // MARK: Notices

  @ViewBuilder
  private var notices: some View {
    VStack(spacing: Space.s2) {
      if let error = store.error {
        HStack(spacing: Space.s2) {
          Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.overdueError)
          Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
          if store.hasConflict && store.saveState == .failed {
            Button("Compare versions") { store.review = .conflict }.buttonStyle(.manor(.secondary, size: .small))
          }
          if store.saveState == .failed || store.saveState == .unprotected {
            Button("Retry") { Task { await store.runPendingSave() } }.buttonStyle(.manor(.secondary, size: .small))
          }
          IconButton("xmark", label: "Dismiss", size: 24) { store.error = nil }
        }
        .padding(.horizontal, Space.s3)
        .padding(.vertical, Space.s2)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
      }
      let deferred = store.deferredIds.filter { $0 != store.selectedId }
      if let first = deferred.first {
        notice(deferred.count == 1 ? "One note has changes saved on this Mac that still need to sync." : "\(deferred.count) notes have changes saved on this Mac that still need to sync.",
               action: ("Open note", { Task { await store.open(first) } }), dismiss: nil)
      }
      if let message = store.notice {
        notice(message, action: nil, dismiss: { store.notice = nil })
      }
    }
    .padding(.horizontal, Space.s4)
    .padding(.top, store.error == nil && store.notice == nil && store.deferredIds.filter({ $0 != store.selectedId }).isEmpty ? 0 : Space.s3)
    .animation(Motion.fast, value: store.error)
  }

  private func notice(_ text: String, action: (String, () -> Void)?, dismiss: (() -> Void)?) -> some View {
    HStack(spacing: Space.s2) {
      Text(text).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).frame(maxWidth: .infinity, alignment: .leading)
      if let action { Button(action.0, action: action.1).buttonStyle(.manor(.secondary, size: .small)) }
      if let dismiss { IconButton("xmark", label: "Dismiss", size: 24, action: dismiss) }
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, Space.s2)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceSoft))
  }

  // MARK: Toolbar

  private func toolbar(_ page: NotePage) -> some View {
    HStack(spacing: Space.s2) {
      HStack(spacing: 5) {
        Text(store.folderName).foregroundStyle(Palette.inkMuted)
        Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        Text(store.draft?.title.isEmpty == false ? store.draft!.title : "Untitled").foregroundStyle(Palette.ink).fontWeight(.medium)
      }
      .font(.ui(Typography.Size.xs))
      .lineLimit(1)
      Spacer(minLength: Space.s3)
      NoteSaveStatus(state: store.shownSaveState, exported: store.exportedFlash)
      if page.status == .active {
        Button { Task { await store.toggleFavorite(page) } } label: {
          Image(systemName: page.favorite ? "star.fill" : "star")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(page.favorite ? Palette.todayWarning : Palette.inkMuted)
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(NotesHoverButtonStyle())
        .help(page.favorite ? "Remove from favorites" : "Add to favorites")
        .accessibilityLabel(page.favorite ? "Remove from favorites" : "Add to favorites")
      }
      actionsMenu(page)
    }
    // Beside the collapsed note list, the breadcrumb clears the window buttons when the app sidebar is hidden too.
    .padding(.leading, store.listCollapsed && buttonsClearance > 0 ? max(Space.s5, buttonsClearance - NotesListPane.railWidth) : Space.s5)
    .padding(.trailing, Space.s4)
    .frame(height: 46)
  }

  private func actionsMenu(_ page: NotePage) -> some View {
    Menu {
      if page.status == .active {
        Button { Task { await store.createPage(parentId: page.id) } } label: { Label("Add subpage", systemImage: "doc.badge.plus") }
        Button { store.dialog = .move(page) } label: { Label("Move to…", systemImage: "folder") }
        Button { Task { await store.duplicate(page.id) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
        Divider()
      }
      Button { store.findOpen = true } label: { Label("Find in note", systemImage: "magnifyingglass") }
      Button { store.review = .versions } label: { Label("Version history", systemImage: "clock.arrow.circlepath") }
      Button { store.review = .suggestions } label: { Label("Suggestions", systemImage: "text.badge.checkmark") }
      Divider()
      Button { store.exportMarkdown() } label: { Label("Export Markdown…", systemImage: "square.and.arrow.up") }
      Button { store.exportNative() } label: { Label("Export Manor document…", systemImage: "doc.zipper") }
      Divider()
      switch page.status {
      case .active:
        Button { Task { await store.archive(page.id) } } label: { Label("Archive", systemImage: "archivebox") }
        Button(role: .destructive) { Task { await store.trash([page.id]) } } label: { Label("Move to Trash", systemImage: "trash") }
      case .archived:
        Button { Task { await store.restore([page.id]) } } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
        Button(role: .destructive) { Task { await store.trash([page.id]) } } label: { Label("Move to Trash", systemImage: "trash") }
      case .trash:
        Button { Task { await store.restore([page.id]) } } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
        Button(role: .destructive) { store.purgeRequest = [page.id] } label: { Label("Delete permanently", systemImage: "trash.slash") }
      }
    } label: {
      Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.inkMuted)
    }
    .menuStyle(.borderlessButton)
    .menuIndicator(.hidden)
    .fixedSize()
    .frame(width: 28, height: 28)
    .help("Note actions")
    .accessibilityLabel("Note actions")
  }

  // MARK: Document

  private func document(_ page: NotePage, _ draft: NoteContent) -> some View {
    let readOnly = page.status == .trash
    return VStack(spacing: 0) {
      if readOnly {
        HStack(spacing: Space.s2) {
          Image(systemName: "trash").foregroundStyle(Palette.inkMuted)
          Text("This note is in Trash. Restore it to edit.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
          Spacer()
          Button("Restore") { Task { await store.restore([page.id]) } }.buttonStyle(.manor(.secondary, size: .small))
        }
        .padding(.horizontal, Space.s6)
        .padding(.vertical, Space.s2)
        .background(Palette.surfaceSoft)
      }
      // The editor scrolls the whole document itself (it only lays out the blocks in view); the title rides
      // along as its header.
      NoteEditor(
        blocks: draft.blocks, documentID: page.id, externalRevision: store.editorRevision, isEditable: !readOnly,
        services: editorServices(for: page),
        findQuery: store.findOpen ? store.findQuery : nil, findIndex: store.findIndex,
        onFindCommand: { store.findOpen = true },
        header: AnyView(NoteTitleField(store: store, pageId: page.id, readOnly: readOnly))
      ) { blocks in
        store.editBlocks(blocks)
      }
      .id(page.id)
    }
  }

  /// What the editor reaches outside itself for: other notes to mention and open, block links, and moving
  /// blocks to another note. Attachments are resolved and uploaded through the Files service.
  private func editorServices(for page: NotePage) -> NoteEditorServices {
    let mentions = store.data.pages
      .filter { $0.status == .active && $0.id != page.id }
      .sorted { $0.lastOpenedAt > $1.lastOpenedAt }
      .map { NoteMentionCandidate(id: $0.id, title: $0.displayTitle) }
    let scheme = context.gateway.config.urlScheme
    var services = NoteEditorServices(
      resolveAttachment: NotesAttachments.resolver(gateway: context.gateway),
      uploadAttachment: NotesAttachments.uploader(gateway: context.gateway, noteId: page.id),
      mentionCandidates: mentions,
      openNote: { id in Task { await store.openLinked(id) } },
      moveBlocks: { ids in store.dialog = .moveBlocks(page, ids) },
      blockLink: { blockId in URL(string: "\(scheme)://notes/\(page.id)#block=\(blockId)") },
      openURL: { url in context.openExternal(url) }
    )
    services.noteTitle = { [store] in store.draft?.title ?? page.displayTitle }
    services.openAlfredSettings = { [context] in
      context.navigate(to: .settings)
      context.linkTarget = (.settings, ["alfred"], [:])
    }
    return services
  }

  private var emptyEditor: some View {
    let trash = store.scope == .trash
    let empty = store.rows.isEmpty
    return EmptyState(
      systemImage: trash ? "trash" : "doc.text",
      title: trash && empty ? "Trash is empty" : "Select a note",
      message: trash ? (empty ? "Deleted notes appear here." : "Choose a note to read it, restore it, or delete it permanently.") : "Choose a note or create a new one."
    ) {
      if store.scope.canCreate {
        Button("New note") { Task { await store.createPage() } }
          .buttonStyle(.manor(.secondary, size: .small))
          .disabled(store.creating)
      }
    }
  }
}

/// Where the open note's changes are: on this Mac, syncing, in the cloud, or stuck. The words carry the state;
/// color and a small ring add emphasis.
struct NoteSaveStatus: View {
  let state: NotesStore.SaveState
  let exported: Bool

  var body: some View {
    HStack(spacing: 5) {
      if state == .syncing {
        ProgressView().controlSize(.mini).scaleEffect(0.8)
      } else if state == .failed || state == .unprotected {
        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11)).foregroundStyle(Palette.overdueError)
      } else if state == .saved && !exported {
        Image(systemName: "checkmark.icloud").font(.system(size: 11)).foregroundStyle(Palette.inkMuted)
      }
      Text(label)
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(state == .failed || state == .unprotected ? Palette.overdueError : Palette.inkMuted)
    }
    .id(label)
    .transition(.opacity)
    .animation(Motion.fast, value: label)
    .accessibilityElement(children: .combine)
  }

  private var label: String {
    switch state {
    case .unsaved: return "Unsaved"
    case .protecting: return "Saving on this Mac"
    case .protected: return "Saved on this Mac"
    case .unprotected: return "Not saved on this Mac"
    case .syncing: return "Syncing"
    case .failed: return "On this Mac, not synced"
    case .saved: return exported ? "Exported" : "Saved to cloud"
    }
  }
}

/// The note title above the first block. It lives inside the editor's scrolling document, so it keeps its own
/// focus and saves when it loses focus.
struct NoteTitleField: View {
  @Bindable var store: NotesStore
  let pageId: String
  let readOnly: Bool
  @FocusState private var focused: Bool

  var body: some View {
    TextField("Untitled", text: Binding(get: { store.draft?.title ?? "" }, set: { store.editTitle($0) }), axis: .vertical)
      .textFieldStyle(.plain)
      .font(.display(Typography.Size.displayLG))
      .foregroundStyle(Palette.ink)
      .lineLimit(1...4)
      // The editor sizes the title from its fitting height, so the field reports its full wrapped height and
      // sits on the column's leading edge with a little air before the first block.
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.bottom, Space.s1)
      .focused($focused)
      .disabled(readOnly)
      .onSubmit { focused = false }
      .accessibilityLabel("Note title")
      .task(id: pageId) {
        guard store.titleFocusId == pageId else { return }
        store.titleFocusId = nil
        try? await Task.sleep(for: .milliseconds(50))
        focused = true
      }
      .onChange(of: focused) { _, isFocused in
        if !isFocused { Task { await store.runPendingSave() } }
      }
  }
}
