import AppKit
import Foundation
import ManorKit
import Observation
import UniformTypeIdentifiers

/// The Notes page's state and flows: the list and its views, the open note's draft and save status, lifecycle
/// changes applied optimistically, folders, versions, suggestions, conflicts, import, and export. Ported from
/// `NotesPage.tsx`; persistence lives in `NotesService`.
@MainActor
@Observable
final class NotesStore {
  enum SaveState: Equatable {
    /// Typed but not yet handed to protection.
    case unsaved
    /// Being written to this Mac.
    case protecting
    /// Held on this Mac; the cloud save follows.
    case protected
    /// The Mac could not hold the edit; leaving the note is blocked.
    case unprotected
    case syncing
    /// Held on this Mac, but the cloud refused or failed.
    case failed
    case saved
  }

  enum ReviewMode: Hashable { case versions, suggestions, conflict }

  enum Dialog: Hashable, Identifiable {
    case newFolder
    case renameFolder(NoteFolder)
    case move(NotePage)
    case moveBlocks(NotePage, [String])
    var id: String {
      switch self {
      case .newFolder: return "new-folder"
      case .renameFolder(let folder): return "folder-\(folder.id)"
      case .move(let page): return "move-\(page.id)"
      case .moveBlocks(let page, let ids): return "move-blocks-\(page.id)-\(ids.joined(separator: ","))"
      }
    }
  }

  let service: NotesService
  private let gateway: Gateway
  private let toasts: ToastCenter

  // MARK: Corpus and list

  private(set) var data = NotesState() { didSet { if !suppressRecompute { recomputeList() } } }
  private(set) var loading = true
  var scope: NotesScope = .all { didSet { if scope != oldValue { recomputeList(); remember() } } }
  var query = "" { didSet { if query != oldValue { recomputeList() } } }
  private(set) var rows: [NoteTreeRow] = []
  private(set) var counts = NotesCounts()
  var selection = NoteSelection.empty
  var listCollapsed: Bool = UserDefaults.standard.bool(forKey: "manor.notes.list-collapsed") {
    didSet { UserDefaults.standard.set(listCollapsed, forKey: "manor.notes.list-collapsed") }
  }
  @ObservationIgnored private var searchIndex: [String: String] = [:]

  // MARK: Open note

  private(set) var selectedId: String?
  /// The open note's title and blocks as the editor shows them.
  private(set) var draft: NoteContent?
  /// Bumps when the page replaces the editor's document from outside (a merge, a restore, a foreign change).
  private(set) var editorRevision = 0
  private(set) var saveState: SaveState = .saved
  /// The state the toolbar shows; syncing holds for a beat so a quick save reads as a save, not a flicker.
  private(set) var shownSaveState: SaveState = .saved
  private(set) var exportedFlash = false
  var error: String?
  var notice: String?
  /// Notes left behind with changes that still need to sync.
  private(set) var deferredIds: [String] = []
  private(set) var creating = false
  /// A freshly created note whose title takes focus once its editor shows.
  var titleFocusId: String?

  // MARK: Overlays

  var review: ReviewMode?
  var dialog: Dialog?
  var purgeRequest: [String]?
  var findOpen = false { didSet { if !findOpen { findQuery = ""; findIndex = 0 } } }
  /// Find in note: the query and the active match, which the editor highlights once it supports it.
  var findQuery = ""
  var findIndex = 0

  // MARK: Save machinery

  @ObservationIgnored private var pending: NoteContent?
  @ObservationIgnored private var protection: Task<Void, Error>?
  @ObservationIgnored private var debounce: Task<Void, Never>?
  @ObservationIgnored private var saveRun: Task<[NotePage], Error>?
  @ObservationIgnored private var syncingSince: Date?
  @ObservationIgnored private var shownTask: Task<Void, Never>?
  @ObservationIgnored private var changeTask: Task<Void, Never>?
  @ObservationIgnored private var started = false

  init(service: NotesService, gateway: Gateway, toasts: ToastCenter) {
    self.service = service
    self.gateway = gateway
    self.toasts = toasts
  }

  var selectedPage: NotePage? { selectedId.flatMap { id in data.pages.first { $0.id == id } } }
  var listTitle: String { NotesModel.scopeTitle(scope, folders: data.folders) }
  var hasConflict: Bool { selectedId.map(service.hasConflict) ?? false }

  // MARK: Derived list

  private func recomputeList() {
    counts = NotesCounts(data.pages)
    let scoped = NotesModel.pages(data.pages, scope: scope, query: query, searchIndex: query.isEmpty ? [:] : searchIndexFor(data.pages))
    rows = NotesModel.treeRows(scoped)
    let pruned = selection.pruned(to: rows.map(\.id))
    if pruned != selection { selection = pruned }
  }

  private func searchIndexFor(_ pages: [NotePage]) -> [String: String] {
    var index: [String: String] = [:]
    for page in pages { index[page.id] = searchIndex[page.id] ?? NotesModel.searchableText(page) }
    searchIndex = index
    return index
  }

  private func setPages(_ change: (inout [NotePage]) -> Void) {
    var pages = data.pages
    change(&pages)
    data.pages = pages
  }

  private func replacePage(_ page: NotePage) {
    searchIndex[page.id] = nil
    setPages { pages in
      if let index = pages.firstIndex(where: { $0.id == page.id }) { pages[index] = page }
    }
  }

  // MARK: Start and remote changes

  func start(linkedNoteId: String?) async {
    guard !started else { return }
    started = true
    NotesRuntime.activeStore = self
    do {
      let state = try await service.load()
      data = state
      let requested = linkedNoteId.flatMap { id in state.pages.first { $0.id == id } }
      // A link names the note; otherwise the reader returns to where they left Notes this session. A fresh
      // session, or a remembered note that is gone, starts with the list and no note open.
      let remembered = requested == nil ? NotesRuntime.rememberedView.flatMap { $0.accountId == service.accountId ? $0 : nil } : nil
      if let requested {
        scope = NotesScope.of(requested)
        select(requested.id)
      } else if let remembered {
        if case .folder(let id) = remembered.scope, !state.folders.contains(where: { $0.id == id }) { scope = .all }
        else { scope = remembered.scope }
        if let noteId = remembered.noteId, state.pages.contains(where: { $0.id == noteId }) { select(noteId) }
      }
      if linkedNoteId != nil && requested == nil { error = "This note is not available in your account." }
    } catch {
      self.error = error.localizedDescription
    }
    loading = false
    remember()
    watchChanges()
  }

  /// Remote changes are folded together briefly, then read once; the echo of this device's own save carries
  /// nothing new and causes no reload. Without a local mirror only this device's commands publish, so there is
  /// nothing foreign to fold.
  private func watchChanges() {
    changeTask?.cancel()
    let stream = gateway.changes(of: ["note_pages", "note_folders"])
    changeTask = Task { [weak self] in
      for await _ in stream {
        try? await Task.sleep(for: .milliseconds(250))
        guard let self, !Task.isCancelled else { return }
        guard self.gateway.localMirror != nil else { continue }
        await self.foldRemoteChanges()
      }
    }
  }

  private func foldRemoteChanges() async {
    _ = try? await protection?.value
    do {
      guard var state = try await service.loadIfChanged() else { return }
      if let pending, let index = state.pages.firstIndex(where: { $0.id == pending.id }) {
        state.pages[index].title = pending.title
        state.pages[index].content = pending.blocks
      }
      searchIndex = [:]
      data = state
      if let selectedId, !state.pages.contains(where: { $0.id == selectedId }) {
        self.selectedId = nil
        draft = nil
        return
      }
      // A foreign change to the open note shows at once when this device holds nothing newer for it.
      if pending == nil, let page = selectedPage, let draft, draft.id == page.id, draft.blocks != page.content || draft.title != page.title {
        self.draft = NoteContent(id: page.id, title: page.title, blocks: page.content)
        editorRevision += 1
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  func stop() {
    changeTask?.cancel()
    if debounce != nil { Task { _ = await runPendingSave() } }
  }

  private func remember() {
    guard !loading else { return }
    NotesRuntime.rememberedView = (service.accountId, scope, selectedId)
  }

  // MARK: Selection

  private func select(_ id: String?) {
    selectedId = id
    remember()
    findOpen = false
    guard let id, let page = data.pages.first(where: { $0.id == id }) else {
      draft = nil
      return
    }
    if pending?.id != id {
      draft = NoteContent(id: page.id, title: page.title, blocks: page.content)
      saveState = .saved
      updateShownState()
    }
    // A draft this Mac protected earlier (before a relaunch or a failed sync) comes back and is sent again.
    Task { [weak self] in
      guard let self, let recovered = try? await self.service.pendingDrafts().first(where: { $0.id == id }), self.selectedId == id, self.pending == nil else { return }
      self.pending = recovered
      if self.draft?.blocks != recovered.blocks || self.draft?.title != recovered.title {
        self.draft = recovered
        self.editorRevision += 1
      }
      self.setSaveState(self.service.hasConflict(id) ? .failed : .protected)
      _ = self.service.takeMergedOps(id)
      if !self.service.hasConflict(id) { _ = await self.runPendingSave() }
    }
  }

  // MARK: Editing and saving

  func editTitle(_ title: String) {
    guard let draft else { return }
    queueSave(NoteContent(id: draft.id, title: String(title.replacingOccurrences(of: "\n", with: " ").prefix(NoteLimits.titleLength)), blocks: draft.blocks))
  }

  func editBlocks(_ blocks: [JSONValue]) {
    guard let draft, draft.blocks != blocks else { return }
    queueSave(NoteContent(id: draft.id, title: draft.title, blocks: blocks))
  }

  private func queueSave(_ next: NoteContent) {
    let titleChanged = draft?.title != next.title
    draft = next
    pending = next
    setSaveState(.protecting)
    protect(next)
    searchIndex[next.id] = nil
    if let index = data.pages.firstIndex(where: { $0.id == next.id }) {
      if titleChanged || !query.isEmpty {
        setPages { $0[index].title = next.title; $0[index].content = next.blocks }
      } else {
        // Content edits do not change the list; skip recomputing it on every keystroke.
        withoutListRecompute { $0[index].content = next.blocks }
      }
    }
    debounce?.cancel()
    debounce = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(650))
      guard !Task.isCancelled else { return }
      _ = await self?.runPendingSave()
    }
  }

  @ObservationIgnored private var suppressRecompute = false
  private func withoutListRecompute(_ change: (inout [NotePage]) -> Void) {
    var pages = data.pages
    change(&pages)
    suppressRecompute = true
    data.pages = pages
    suppressRecompute = false
  }

  /// Chains a protection after the previous one, so the latest link means the latest draft is on disk.
  private func protect(_ content: NoteContent) {
    let previous = protection
    let service = self.service
    let task = Task { @MainActor in
      _ = try? await previous?.value
      try await service.protectDraft(content)
    }
    protection = task
    Task { [weak self] in
      do {
        try await task.value
        if let self, self.pending == content, self.saveState == .protecting { self.setSaveState(.protected) }
      } catch {
        guard let self else { return }
        if self.pending?.id == content.id { self.setSaveState(.unprotected) }
        self.error = error.localizedDescription
      }
    }
  }

  /// Sends every pending draft in turn, each after its device-side protection.
  private func saveQueue() async throws -> [NotePage] {
    if let saveRun { return try await saveRun.value }
    let run = Task { @MainActor [weak self] () -> [NotePage] in
      var saved: [NotePage] = []
      while let self, let current = self.pending {
        try await self.protection?.value
        saved.append(try await self.service.updatePage(current))
        if self.pending == current { self.pending = nil }
      }
      return saved
    }
    saveRun = run
    defer { saveRun = nil }
    return try await run.value
  }

  /// Saves the open note now (the debounce, Command-S, leaving Notes, retry).
  @discardableResult
  func runPendingSave() async -> Bool {
    debounce?.cancel()
    debounce = nil
    guard let current = pending else { return true }
    let savingId = current.id
    var stillOpen: Bool { selectedId == savingId }
    setSaveState(.syncing)
    var protectedLocally = false
    do {
      do { try await protection?.value } catch {
        if let latest = pending { try await service.protectDraft(latest) }
      }
      protectedLocally = true
      let saved = try await saveQueue()
      for page in saved { absorbSaved(page) }
      deferredIds.removeAll { id in saved.contains { $0.id == id } }
      if stillOpen || pending != nil { setSaveState(pending == nil ? .saved : .unsaved) }
      if stillOpen { error = nil }
      return true
    } catch is ManorConnectionError {
      // Offline: the edit is held on this Mac and goes out when the connection returns.
      if stillOpen { setSaveState(.protected) } else if !deferredIds.contains(savingId) { deferredIds.append(savingId) }
      return true
    } catch {
      if stillOpen {
        setSaveState(protectedLocally ? .failed : .unprotected)
        self.error = error.localizedDescription
      } else if !deferredIds.contains(savingId) {
        deferredIds.append(savingId)
      }
      return false
    }
  }

  /// A committed save: the list takes the receipt, and foreign blocks a merge brought in reach the open editor.
  private func absorbSaved(_ saved: NotePage) {
    let ops = service.takeMergedOps(saved.id)
    var page = saved
    if pending?.id == saved.id, let pending {
      page.title = pending.title
      page.content = pending.blocks
    }
    replacePage(page)
    guard !ops.isEmpty, var draft, draft.id == saved.id else { return }
    draft.blocks = NoteMerge.apply(ops, to: draft.blocks)
    self.draft = draft
    if var newer = pending, newer.id == saved.id {
      newer.blocks = NoteMerge.apply(ops, to: newer.blocks)
      pending = newer
      protect(newer)
    }
    editorRevision += 1
  }

  /// Leaving a note waits only for the Mac to hold the edit, never for the cloud. The sync continues in the
  /// background, and a note whose sync fails is offered back.
  func prepareNavigation() async -> Bool {
    guard let current = pending else { return true }
    do {
      try await protection?.value
      let held = try await service.pendingDrafts().first { $0.id == current.id }
      guard let held, held.title == current.title, held.blocks == NoteRows.nativeBlocks(current.blocks) else {
        throw ManorRequestError(operation: "Leave note", code: "unprotected", detail: "Your latest edit is not saved on this Mac. Retry saving before leaving this note.")
      }
      if saveState == .failed {
        if !deferredIds.contains(current.id) { deferredIds.append(current.id) }
      } else {
        // The service orders this after any save of the note already in flight.
        Task { [weak self] in
          guard let self else { return }
          do {
            let saved = try await self.service.updatePage(current)
            self.absorbSaved(saved)
            self.deferredIds.removeAll { $0 == saved.id }
            if self.selectedId == saved.id && self.pending == nil { self.setSaveState(.saved) }
          } catch {
            if !self.deferredIds.contains(current.id) { self.deferredIds.append(current.id) }
          }
        }
      }
      debounce?.cancel()
      debounce = nil
      pending = nil
      error = nil
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  /// Retries every note left behind, then the open one.
  func retrySync() async {
    do {
      let saved = try await service.syncDrafts()
      for page in saved { absorbSaved(page) }
      deferredIds.removeAll { id in saved.contains { $0.id == id } }
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
    _ = await runPendingSave()
  }

  /// Called when the connection comes back.
  func connectionRestored() {
    guard pending != nil || !deferredIds.isEmpty else { return }
    Task { await retrySync() }
  }

  /// The sign-out guard settles what the open note holds in memory first.
  func settleForSignOut() async {
    _ = try? await protection?.value
    if pending != nil { _ = await runPendingSave() }
  }

  private func setSaveState(_ state: SaveState) {
    saveState = state
    updateShownState()
  }

  private func updateShownState() {
    shownTask?.cancel()
    if saveState == .syncing {
      syncingSince = Date()
      shownSaveState = .syncing
      return
    }
    let remaining = syncingSince.map { 0.45 - Date().timeIntervalSince($0) } ?? 0
    guard remaining > 0 else {
      syncingSince = nil
      shownSaveState = saveState
      return
    }
    shownTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(remaining))
      guard let self, !Task.isCancelled else { return }
      self.syncingSince = nil
      self.shownSaveState = self.saveState
    }
  }

  // MARK: Navigation

  func open(_ id: String) async {
    guard await prepareNavigation() else { return }
    pending = nil
    if let page = data.pages.first(where: { $0.id == id }), !rows.contains(where: { $0.id == id }) { scope = NotesScope.of(page) }
    select(id)
    selection = .one(id)
    guard let page = data.pages.first(where: { $0.id == id }), page.status != .trash else { return }
    do {
      if let touched = try await service.touchPage(id) {
        var shown = touched
        if pending?.id == id, let pending { shown.title = pending.title; shown.content = pending.blocks }
        replacePage(shown)
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// A link (`manor://notes/<id>`) opens its note in the view it belongs to.
  func openLinked(_ id: String) async {
    guard let page = data.pages.first(where: { $0.id == id }) else {
      error = "This note is not available in your account."
      return
    }
    scope = NotesScope.of(page)
    await open(id)
  }

  func selectScope(_ next: NotesScope) async {
    guard await prepareNavigation() else { return }
    listCollapsed = false
    scope = next
    query = ""
    select(nil)
    selection = .empty
  }

  func clearSelection() {
    selection = selectedId.map(NoteSelection.one) ?? .empty
  }

  // MARK: Create

  private static let emptyDocument: [JSONValue] = [["type": "paragraph", "content": [], "children": []]]

  func createPage(parentId: String? = nil) async {
    // One click, one note: a second press while the first is still creating is the same request.
    guard !creating else { return }
    creating = true
    defer { creating = false }
    guard await prepareNavigation() else { return }
    let parent = parentId.flatMap { id in data.pages.first { $0.id == id } }
    do {
      let result = try await service.createPage(title: "Untitled", folderId: parent?.folderId ?? scope.folderId, parentPageId: parentId, blocks: Self.emptyDocument)
      data = result.state
      error = nil
      if let created = result.state.pages.first(where: { $0.id == result.id }) {
        scope = created.folderId.map(NotesScope.folder) ?? .all
      }
      select(result.id)
      selection = .one(result.id)
      titleFocusId = result.id
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: Lifecycle

  /// Applies a lifecycle change to the list at once, runs it, and puts the previous list back if it fails.
  private func optimistically(_ ids: [String], apply: (NotePage) -> NotePage?, run: () async throws -> NotesState) async -> NotesState? {
    let affected = NotesModel.withDescendants(ids, in: data.pages)
    let before = data.pages
    setPages { pages in pages = pages.compactMap { affected.contains($0.id) ? apply($0) : $0 } }
    do {
      let state = try await run()
      data = overlayingPending(state)
      error = nil
      return state
    } catch {
      setPages { $0 = before }
      self.error = error.localizedDescription
      return nil
    }
  }

  private func overlayingPending(_ state: NotesState) -> NotesState {
    guard let pending, let index = state.pages.firstIndex(where: { $0.id == pending.id }) else { return state }
    var result = state
    result.pages[index].title = pending.title
    result.pages[index].content = pending.blocks
    return result
  }

  /// Moving to Trash includes subpages and offers Undo while the toast shows.
  func trash(_ ids: [String]) async {
    if let selectedId, ids.contains(selectedId), !(await prepareNavigation()) { return }
    let now = NotesModel.timestamp()
    let state = await optimistically(ids, apply: { page in
      var copy = page
      copy.status = .trash
      copy.deletedAt = now
      return copy
    }, run: { try await service.trashPages(ids) })
    guard state != nil else { return }
    if let selectedId, ids.contains(selectedId) { select(nil) }
    toasts.show(ids.count == 1 ? "Note moved to Trash" : "\(ids.count) notes moved to Trash", actionLabel: "Undo") { [weak self] in
      Task { await self?.restore(ids) }
    }
  }

  /// Restore follows the open note back to its live view.
  func restore(_ ids: [String]) async {
    let state = await optimistically(ids, apply: { page in
      var copy = page
      copy.status = .active
      copy.deletedAt = nil
      copy.archivedAt = nil
      return copy
    }, run: { try await service.restorePages(ids) })
    guard let state else { return }
    if let selectedId, ids.contains(selectedId), let restored = state.pages.first(where: { $0.id == selectedId }) { scope = NotesScope.of(restored) }
    toasts.show(ids.count == 1 ? "Note restored" : "\(ids.count) notes restored")
  }

  func purge(_ ids: [String]) async {
    purgeRequest = nil
    let state = await optimistically(ids, apply: { _ in nil }, run: { try await service.purgePages(ids) })
    guard state != nil else { return }
    if let selectedId, ids.contains(selectedId) { select(nil) }
    toasts.show(ids.count == 1 ? "Note deleted permanently" : "\(ids.count) notes deleted permanently")
  }

  func archive(_ id: String) async {
    if id == selectedId, !(await prepareNavigation()) { return }
    let now = NotesModel.timestamp()
    let state = await optimistically([id], apply: { page in
      guard page.id == id else { return page }
      var copy = page
      copy.status = .archived
      copy.archivedAt = now
      return copy
    }, run: { try await service.archivePage(id: id) })
    if state != nil, id == selectedId { select(nil) }
    if state != nil { toasts.show("Note archived") }
  }

  /// The star flips at once; the service lands the note's draft before the change goes out.
  func toggleFavorite(_ page: NotePage) async {
    let favorite = !page.favorite
    _ = await optimistically([page.id], apply: { candidate in
      guard candidate.id == page.id else { return candidate }
      var copy = candidate
      copy.favorite = favorite
      return copy
    }, run: { try await service.setFavorite(id: page.id, favorite: favorite) })
  }

  func duplicate(_ id: String) async {
    if id == selectedId, !(await prepareNavigation()) { return }
    do {
      let result = try await service.duplicatePage(id)
      data = overlayingPending(result.state)
      select(result.id)
      selection = .one(result.id)
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  func move(_ page: NotePage, folderId: String?, parentPageId: String?) async -> String? {
    if page.id == selectedId, !(await prepareNavigation()) { return error }
    let state = await optimistically([page.id], apply: { candidate in
      guard candidate.id == page.id else { return candidate }
      var copy = candidate
      copy.folderId = folderId
      copy.parentPageId = parentPageId
      return copy
    }, run: { try await service.movePage(id: page.id, folderId: folderId, parentPageId: parentPageId) })
    return state == nil ? error : nil
  }

  // MARK: Folders

  func createFolder(name: String) async -> String? {
    do {
      let result = try await service.createFolder(name: name)
      data = overlayingPending(result.state)
      _ = await selectScope(.folder(result.id))
      return nil
    } catch {
      return error.localizedDescription
    }
  }

  func renameFolder(_ folder: NoteFolder, name: String) async -> String? {
    do {
      data = overlayingPending(try await service.renameFolder(id: folder.id, name: name))
      return nil
    } catch {
      return error.localizedDescription
    }
  }

  func deleteFolder(_ folder: NoteFolder) async -> String? {
    do {
      data = overlayingPending(try await service.deleteFolder(id: folder.id))
      if scope == .folder(folder.id) { scope = .all }
      return nil
    } catch {
      return error.localizedDescription
    }
  }

  // MARK: Review

  /// Before a version restore or a suggestion review, the open note's draft lands first.
  func beforeReviewChange() async -> Bool {
    if pending == nil { return true }
    return await runPendingSave()
  }

  /// Moves blocks of the open note to the end of another note, then shows both notes as committed.
  func moveBlocks(_ blockIds: [String], from source: NotePage, to targetId: String) async -> String? {
    guard await prepareNavigation() else { return error ?? "Save this note before moving blocks." }
    do {
      let state = try await service.moveBlocks(sourceId: source.id, targetId: targetId, blockIds: blockIds)
      data = overlayingPending(state)
      if let page = state.pages.first(where: { $0.id == source.id }) { applied(page) }
      return nil
    } catch {
      return error.localizedDescription
    }
  }

  /// A restore, an accepted suggestion, or a resolved conflict replaces the open document.
  func applied(_ page: NotePage) {
    if pending?.id == page.id { pending = nil }
    debounce?.cancel()
    debounce = nil
    replacePage(page)
    if selectedId == page.id {
      draft = NoteContent(id: page.id, title: page.title, blocks: page.content)
      editorRevision += 1
      setSaveState(.saved)
      error = nil
    }
  }

  /// Keeps the cloud copy and drops this Mac's conflicting draft.
  func keepCloudVersion(_ conflict: NoteConflict) async {
    do {
      try await service.discardDraft(conflict.local.id)
      applied(conflict.current)
    } catch {
      self.error = error.localizedDescription
    }
  }

  // MARK: Import and export

  /// Imports Markdown files as text (an opening heading becomes the title) and Manor native documents.
  func importFiles() async {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false
    panel.prompt = "Import"
    panel.message = "Choose Markdown files or Manor documents to import."
    panel.allowedContentTypes = [UTType(filenameExtension: "md"), UTType(filenameExtension: "markdown"), .json, .plainText].compactMap { $0 }
    guard panel.runModal() == .OK, !panel.urls.isEmpty else { return }
    guard await prepareNavigation() else { return }
    let folderId = scope.folderId
    var failures: [String] = []
    var lastId: String?
    var lastState: NotesState?
    for url in panel.urls {
      do {
        let source = try String(contentsOf: url, encoding: .utf8)
        var title = NotesModel.importedTitle(fileName: url.lastPathComponent)
        let blocks: [JSONValue]
        if url.pathExtension.lowercased() == "json" {
          let native = try ManorJSON.plainDecoder.decode(JSONValue.self, from: Data(source.utf8))
          guard native["format"]?.string == "manor-note", native["version"]?.int == 1, let nativeTitle = native["title"]?.string, let content = native["content"]?.array else {
            throw NoteValidationError.invalid("Choose a Manor document or a Markdown file")
          }
          title = nativeTitle
          blocks = content
        } else {
          let split = NotesModel.splitLeadingHeading(source)
          if let heading = split.title { title = heading }
          blocks = NoteDocumentCoding.json(from: NoteMarkdown.blocks(from: split.body))
        }
        let result = try await service.createPage(title: String(title.prefix(NoteLimits.titleLength)), folderId: folderId, parentPageId: nil,
                                                  blocks: blocks.isEmpty ? Self.emptyDocument : blocks)
        lastState = result.state
        lastId = result.id
      } catch {
        failures.append("\(url.lastPathComponent): \(error.localizedDescription)")
      }
    }
    if let lastState { data = overlayingPending(lastState) }
    if let lastId {
      if !scope.canCreate { scope = .all }
      select(lastId)
      selection = .one(lastId)
    }
    let count = panel.urls.count
    error = failures.isEmpty ? nil : "Could not import \(failures.count) of \(count) file\(count == 1 ? "" : "s"). \(failures.joined(separator: "; "))"
    if failures.isEmpty { toasts.show(count == 1 ? "Note imported" : "\(count) notes imported") }
  }

  func exportMarkdown() {
    guard let page = selectedPage else { return }
    let content = draft?.id == page.id ? draft! : NoteContent(id: page.id, title: page.title, blocks: page.content)
    let blocks = NoteDocumentCoding.blocks(from: content.blocks)
    let markdown = "# \(content.savedTitle)\n\n" + NoteMarkdown.markdown(from: blocks) + "\n"
    if save(markdown, name: NotesModel.exportFileName(title: content.savedTitle, extension: "md"), type: UTType(filenameExtension: "md") ?? .plainText) {
      notice = "Markdown turns columns and tabs into sections, and image crops and some formatting are not kept. Export a Manor document to keep the full structure."
      flashExported()
    }
  }

  func exportNative() {
    guard let page = selectedPage else { return }
    let content = draft?.id == page.id ? draft! : NoteContent(id: page.id, title: page.title, blocks: page.content)
    let document: JSONValue = ["format": "manor-note", "version": 1, "title": .string(content.savedTitle), "content": .array(content.blocks)]
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(document), let text = String(data: data, encoding: .utf8) else { return }
    if save(text, name: NotesModel.exportFileName(title: content.savedTitle, extension: "manor.json"), type: .json) {
      notice = nil
      flashExported()
    }
  }

  private func save(_ text: String, name: String, type: UTType) -> Bool {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [type]
    panel.canCreateDirectories = true
    guard panel.runModal() == .OK, let url = panel.url else { return false }
    do {
      try text.write(to: url, atomically: true, encoding: .utf8)
      return true
    } catch {
      self.error = "Export failed: \(error.localizedDescription)"
      return false
    }
  }

  private func flashExported() {
    exportedFlash = true
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(2))
      self?.exportedFlash = false
    }
  }

  // MARK: Labels

  var folderName: String {
    guard let folderId = selectedPage?.folderId else { return "Notes" }
    return data.folders.first { $0.id == folderId }?.name ?? "Notes"
  }
}
