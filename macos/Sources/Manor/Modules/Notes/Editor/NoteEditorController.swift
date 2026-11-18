import AppKit
import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// Hooks the Notes page provides to the editor. Every one is optional; without them the editor still edits text
/// and structure, and shows placeholders where it needs the outside world.
struct NoteEditorServices {
  /// Maps a stored attachment URL (`manor-attachment://<id>`) to a URL the editor can load. Web addresses are
  /// used as they are. Without a resolver, attachment media shows its loading placeholder.
  var resolveAttachment: ((String) async throws -> URL)?
  /// Uploads a local file as an attachment of the open note and returns its stable `manor-attachment://` URL.
  /// Without an uploader, media blocks offer only "paste a link".
  var uploadAttachment: ((URL) async throws -> String)?
  /// Pages the `@` menu offers as mentions (active notes other than the open one).
  var mentionCandidates: [NoteMentionCandidate] = []
  /// Opens another note, from a page mention or a `manor-note://` link.
  var openNote: ((String) -> Void)?
  /// Starts "Move to note" for blocks (the page shows its destination dialog and applies the move).
  var moveBlocks: (([String]) -> Void)?
  /// The shareable link to a block, for "Copy link to block".
  var blockLink: ((String) -> URL?)?
  /// Opens a web address. Defaults to the system browser.
  var openURL: ((URL) -> Void)?
  /// The open note's title, sent to Alfred as context and shown in its composer.
  var noteTitle: (() -> String)?
  /// Opens Settings at Alfred (offered when Alfred has no key).
  var openAlfredSettings: (() -> Void)?
  /// Writes with Alfred. Defaults to Alfred's writer; tests pass a scripted one.
  var alfredWriter: (any NoteAlfredWriting)?

  init(resolveAttachment: ((String) async throws -> URL)? = nil, uploadAttachment: ((URL) async throws -> String)? = nil,
       mentionCandidates: [NoteMentionCandidate] = [], openNote: ((String) -> Void)? = nil, moveBlocks: (([String]) -> Void)? = nil,
       blockLink: ((String) -> URL?)? = nil, openURL: ((URL) -> Void)? = nil) {
    self.resolveAttachment = resolveAttachment
    self.uploadAttachment = uploadAttachment
    self.mentionCandidates = mentionCandidates
    self.openNote = openNote
    self.moveBlocks = moveBlocks
    self.blockLink = blockLink
    self.openURL = openURL
  }
}

struct NoteMentionCandidate: Hashable, Identifiable {
  let id: String
  let title: String
  init(id: String, title: String) {
    self.id = id
    self.title = title
  }
}

/// Where the caret or selection goes after an edit, and what undo restores.
enum NoteFocus: Equatable {
  case text(String, NSRange)
  case cell(String, NoteCellAddress, NSRange)
  case blocks([String])
  case none
}

enum NoteCaretPlacement { case start, end }

/// The editor's state shared with SwiftUI: find, dialogs, and notices.
@MainActor @Observable
final class NoteEditorModel {
  @ObservationIgnored let controller = NoteEditorController()
  var findVisible = false
  var findQuery = ""
  var findCount = 0
  var findIndex = 0
  var notice: String?
  var findFocusToken = 0
  /// The Alfred composer while it is open.
  var alfredComposer: NoteAlfredComposerRequest?

  init() { controller.model = self }
}

struct NoteImageEditRequest: Identifiable, Equatable {
  let id: String
  var props: [String: JSONValue]
  var image: NSImage?
  static func == (lhs: NoteImageEditRequest, rhs: NoteImageEditRequest) -> Bool { lhs.id == rhs.id && lhs.props == rhs.props }
}

/// Owns the document, its undo history, focus, and every edit. Views report input here; the controller
/// changes the model and lays the canvas out again.
@MainActor
final class NoteEditorController: NSObject, NSTextViewDelegate {
  weak var model: NoteEditorModel?
  private(set) var blocks: [NoteBlock] = [] {
    didSet { headingsCache = nil }
  }
  private var headingsCache: [NoteHeading]?

  /// The document's headings, computed once per document change (the live contents block reads them).
  var headings: [NoteHeading] {
    if let headingsCache { return headingsCache }
    let computed = blocks.headings
    headingsCache = computed
    return computed
  }
  private(set) var documentID = ""
  private var externalRevision = -1
  private var lastLoaded: [JSONValue] = []
  var isEditable = true {
    didSet { if oldValue != isEditable { canvas?.layoutDocument(); reloadAllViews() } }
  }
  var services = NoteEditorServices() {
    didSet {
      if (oldValue.resolveAttachment == nil) != (services.resolveAttachment == nil) || (oldValue.uploadAttachment == nil) != (services.uploadAttachment == nil) {
        canvas?.refreshMediaViews()
      }
    }
  }
  var onChange: (([JSONValue]) -> Void)?
  let undoManager = UndoManager()
  weak var canvas: NoteCanvasView?
  weak var scrollView: NSScrollView?

  // View state that is not part of the document.
  private(set) var openToggles: Set<String> = []
  private(set) var activeTabs: [String: String] = [:]
  private var measuredHeights: [String: CGFloat] = [:]
  private(set) var editingMath: Set<String> = []
  private(set) var selectedBlockIDs: [String] = []
  private(set) var focusedBlockID: String?
  private(set) var focusedRole: NoteTextRole = .block
  private var uploading: Set<String> = []
  private var uploadErrors: [String: String] = [:]
  private var columnDragOrigin: (id: String, blocks: [NoteBlock], focus: NoteFocus)?

  // Typing coalescing.
  private var typingFocusBefore: NoteFocus?
  private var coalesceKey: String?
  private var coalesceLast = Date.distantPast
  private var coalesceStart = Date.distantPast

  // Change emission.
  private var changeTask: Task<Void, Never>?
  private var layoutScheduled = false

  // Find.
  private(set) var findMatches: [NoteFindMatch] = []
  private(set) var findActive: Int = 0
  var onFindCommand: (() -> Void)?
  private var externalFindQuery: String?
  private var externalFindIndex = 0

  // Alfred generations by block id (view state, never stored).
  var alfredRuns: [String: NoteAlfredRun] = [:]
  /// The selection rewrite in progress, previewed under the selection.
  var selectionEdit: NoteAlfredSelectionEdit?
  /// Converted blocks of each Alfred block, by its source and whether it is still streaming.
  var alfredRenderCache: [String: (source: String, streaming: Bool, blocks: [NoteBlock])] = [:]

  // Menus.
  let dialogs = NoteDialogPresenter()
  let suggestions = NoteSuggestionMenu()
  let toolbar = NoteFormattingToolbar()

  override init() {
    super.init()
    undoManager.levelsOfUndo = 200
    // Every step is grouped explicitly, so typing coalescing decides the steps rather than the run loop.
    undoManager.groupsByEvent = false
    suggestions.controller = self
    toolbar.controller = self
  }

  // MARK: Loading

  /// Loads the stored document. A new `documentID` resets everything; a new `externalRevision` replaces the
  /// content in place (a merge or restore from outside) and keeps the caret where it can.
  func load(_ json: [JSONValue], documentID: String, externalRevision: Int) {
    if documentID != self.documentID {
      stopAllAlfred()
      alfredRuns = [:]
      selectionEdit?.task?.cancel()
      selectionEdit = nil
      // A composer opened for the previous note doesn't carry over.
      model?.alfredComposer = nil
      flushChanges()
      self.documentID = documentID
      self.externalRevision = externalRevision
      lastLoaded = json
      blocks = Self.normalized(NoteDocumentCoding.blocks(from: json))
      encoder.reset()
      pendingChanged = nil
    if blocks.isEmpty { blocks = [NoteSchema.paragraph()] }
      undoManager.removeAllActions()
      openToggles = []
      activeTabs = [:]
      measuredHeights = [:]
      editingMath = []
      selectedBlockIDs = []
      focusedBlockID = nil
      uploadErrors = [:]
      coalesceKey = nil
      suggestions.close()
      toolbar.hide()
      NoteTextMeasurer.shared.invalidate()
      canvas?.subviews.compactMap { $0 as? NoteBlockView }.forEach { $0.removeFromSuperview() }
      canvas?.resetViews()
      canvas?.layoutDocument()
      scrollView?.contentView.scroll(to: .zero)
      scrollView?.reflectScrolledClipView(scrollView!.contentView)
      refreshFind()
      return
    }
    guard externalRevision != self.externalRevision else { return }
    self.externalRevision = externalRevision
    guard json != lastLoaded, json != NoteDocumentCoding.json(from: blocks) else { lastLoaded = json; return }
    lastLoaded = json
    let focus = currentFocus()
    changeTask?.cancel()
    changeTask = nil
    blocks = Self.normalized(NoteDocumentCoding.blocks(from: json))
      encoder.reset()
      pendingChanged = nil
    if blocks.isEmpty { blocks = [NoteSchema.paragraph()] }
    undoManager.removeAllActions()
    coalesceKey = nil
    reloadAllViews()
    if case .text(let id, _) = focus, blocks.contains(id: id) { apply(focus) }
    refreshFind()
  }

  /// Legacy two-column blocks that stored each column as serialized JSON become native columns, as the React
  /// editor did on load. They are written in the new shape only once the reader edits the note.
  static func normalized(_ blocks: [NoteBlock]) -> [NoteBlock] {
    blocks.map { block in
      var block = block
      if block.kind == .twoColumns, let left = block.props["leftContent"]?.string, let right = block.props["rightContent"]?.string {
        let columns = [("leftContent", left), ("rightContent", right)].map { key, value -> NoteBlock in
          let parsed = (try? JSONDecoder().decode([JSONValue].self, from: Data(value.utf8))) ?? []
          return NoteBlock(id: "\(block.id)-\(key)", type: "noteColumn", props: [:], content: .absent, children: normalized(NoteDocumentCoding.blocks(from: parsed)))
        }
        block.props = ["ratio": block.props["ratio"] ?? 50]
        block.children = columns
        return block
      }
      block.children = normalized(block.children)
      return block
    }
  }

  /// Sends any pending change now (switching notes, closing the editor).
  func flushChanges() {
    guard changeTask != nil else { return }
    changeTask?.cancel()
    changeTask = nil
    emitChange()
  }

  private let encoder = NoteDocumentEncoder()

  /// Top-level blocks changed since the last emission; `nil` after any structural change.
  private var pendingChanged: Set<String>? = []

  private func noteChanged(textEdit: String?) {
    guard let textEdit, pendingChanged != nil, let top = blocks.path(of: textEdit)?.first, blocks.indices.contains(top) else {
      pendingChanged = nil
      return
    }
    pendingChanged?.insert(blocks[top].id)
  }

  private func emitChange() {
    let json = encoder.json(from: blocks, changed: pendingChanged)
    pendingChanged = []
    lastLoaded = json
    onChange?(json)
  }

  private func scheduleChange() {
    changeTask?.cancel()
    // One emission per run loop turn: the page always holds the latest document before the next event
    // (switching notes, closing the window), while a burst of changes in one event encodes once.
    changeTask = Task { [weak self] in
      await Task.yield()
      guard !Task.isCancelled, let self else { return }
      self.changeTask = nil
      self.emitChange()
    }
  }

  // MARK: Layout

  func layoutEngine() -> NoteLayoutEngine {
    var engine = NoteLayoutEngine(openToggles: openToggles, activeTabs: activeTabs, measuredHeights: measuredHeights, editingMath: editingMath,
                     isEditable: isEditable, headingCount: { [unowned self] in self.headings.count })
    engine.alfredContent = { [unowned self] block in self.alfredLayoutContent(block) }
    engine.selectionPreview = selectionPreview
    engine.previewContent = { [unowned self] block in self.previewLayoutContent(block) }
    return engine
  }

  func reloadAllViews() {
    canvas?.layoutDocument()
  }

  /// Lays the canvas out on the next turn of the run loop, folding several requests into one.
  func setNeedsLayout() {
    guard !layoutScheduled else { return }
    layoutScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.layoutScheduled = false
      self.canvas?.layoutDocument()
    }
  }

  func measuredHeight(_ id: String) -> CGFloat? { measuredHeights[id] }

  func reportHeight(_ id: String, _ height: CGFloat) {
    guard abs((measuredHeights[id] ?? -1) - height) > 0.5 else { return }
    measuredHeights[id] = height
    setNeedsLayout()
  }

  // MARK: Mutation and undo

  private struct Snapshot {
    let blocks: [NoteBlock]
    let focus: NoteFocus
  }

  /// Applies a document change as one undoable step (or folds it into the current typing step).
  /// `textEdit` names the one block whose text changed (typing): the change is known, and the canvas may
  /// relayout incrementally when that block kept its height.
  func mutate(coalesce: String? = nil, focus: NoteFocus? = nil, focusBefore: NoteFocus? = nil, textEdit: String? = nil, _ change: (inout [NoteBlock]) -> Void) {
    guard isEditable else { return }
    let before = blocks
    let beforeFocus = focusBefore ?? currentFocus()
    change(&blocks)
    if blocks.isEmpty { blocks = [NoteSchema.paragraph()] }
    guard textEdit != nil || blocks != before else {
      if let focus { apply(focus) }
      return
    }
    registerUndo(Snapshot(blocks: before, focus: beforeFocus), coalesce: coalesce)
    noteChanged(textEdit: textEdit)
    if let textEdit, canvas?.relayoutTextChange(textEdit) == true {
      // The edited block kept its height; nothing else moved.
    } else {
      canvas?.layoutDocument()
    }
    if let focus { apply(focus) }
    scheduleChange()
    if model?.findVisible == true || externalFindQuery != nil { refreshFind() }
  }

  private func registerUndo(_ snapshot: Snapshot, coalesce: String?) {
    let now = Date()
    if let coalesce, coalesce == coalesceKey, now.timeIntervalSince(coalesceLast) < 1.5, now.timeIntervalSince(coalesceStart) < 10 {
      coalesceLast = now
      return
    }
    coalesceKey = coalesce
    coalesceLast = now
    coalesceStart = now
    undoManager.beginUndoGrouping()
    undoManager.registerUndo(withTarget: self) { target in
      MainActor.assumeIsolated { target.restore(snapshot) }
    }
    undoManager.endUndoGrouping()
  }

  private func restore(_ snapshot: Snapshot) {
    let current = Snapshot(blocks: blocks, focus: currentFocus())
    let grouped = !undoManager.isUndoing && !undoManager.isRedoing
    if grouped { undoManager.beginUndoGrouping() }
    undoManager.registerUndo(withTarget: self) { target in
      MainActor.assumeIsolated { target.restore(current) }
    }
    if grouped { undoManager.endUndoGrouping() }
    coalesceKey = nil
    suggestions.close()
    toolbar.hide()
    blocks = snapshot.blocks
    pendingChanged = nil
    canvas?.layoutDocument()
    apply(snapshot.focus)
    scheduleChange()
    if model?.findVisible == true { refreshFind() }
  }

  func undo() {
    coalesceKey = nil
    stopAllAlfred()
    if undoManager.canUndo { undoManager.undo() }
  }

  func redo() {
    coalesceKey = nil
    stopAllAlfred()
    if undoManager.canRedo { undoManager.redo() }
  }

  /// Changes the document without an undo step or a save, for content that streams in. A later
  /// `commitTransient` records the whole change as one step.
  func applyTransient(_ change: (inout [NoteBlock]) -> Void) {
    change(&blocks)
    if blocks.isEmpty { blocks = [NoteSchema.paragraph()] }
    pendingChanged = nil
    canvas?.layoutDocument()
  }

  /// Records everything applied transiently since `undoSnapshot` as one undo step, and saves.
  func commitTransient(undoSnapshot: [NoteBlock], focusBefore: NoteFocus) {
    coalesceKey = nil
    // Nothing changed (a run that failed before writing): no empty undo step.
    guard undoSnapshot != blocks else { return }
    registerUndo(Snapshot(blocks: undoSnapshot, focus: focusBefore), coalesce: nil)
    coalesceKey = nil
    pendingChanged = nil
    scheduleChange()
    if model?.findVisible == true || externalFindQuery != nil { refreshFind() }
  }

  /// Ends the current typing step so the next keystroke starts a new undo step.
  func breakTypingGroup() { coalesceKey = nil }

  // MARK: Focus

  func currentFocus() -> NoteFocus {
    if !selectedBlockIDs.isEmpty { return .blocks(selectedBlockIDs) }
    guard let responder = canvas?.window?.firstResponder as? NoteTextView, responder.controller === self else { return .none }
    switch responder.role {
    case .block, .mathSource: return .text(responder.blockID, responder.selectedRange())
    case .cell(let address): return .cell(responder.blockID, address, responder.selectedRange())
    }
  }

  func apply(_ focus: NoteFocus) {
    switch focus {
    case .text(let id, let range):
      if let kind = blocks.block(id: id)?.kind, kind == .mathBlock || kind == .diagram || kind == .generativeUI, !editingMath.contains(id) {
        editingMath.insert(id)
        canvas?.layoutDocument()
      }
      clearBlockSelection()
      reveal(id, focus: false)
      guard let view = canvas?.materialize(id), let textView = view.primaryTextView else { selectBlocks([id]); return }
      focusTextView(textView, range: range)
    case .cell(let id, let address, let range):
      clearBlockSelection()
      reveal(id, focus: false)
      guard let view = canvas?.materialize(id) as? NoteTableBlockView, let cell = view.cellView(address) else { return }
      focusTextView(cell, range: range)
    case .blocks(let ids):
      let existing = ids.filter { blocks.contains(id: $0) }
      if existing.isEmpty { clearBlockSelection() } else { selectBlocks(existing) }
    case .none:
      break
    }
  }

  private func focusTextView(_ textView: NoteTextView, range: NSRange) {
    canvas?.layoutSubtreeIfNeeded()
    let length = (textView.string as NSString).length
    let location = min(range.location, length)
    let clamped = NSRange(location: location, length: min(range.length, length - location))
    if textView.window?.firstResponder !== textView { textView.window?.makeFirstResponder(textView) }
    textView.setSelectedRange(clamped)
    scrollToVisible(textView, range: clamped)
  }

  func scrollToVisible(_ textView: NoteTextView, range: NSRange) {
    guard let canvas else { return }
    let rect = canvas.convert(textView.rect(for: range), from: textView).insetBy(dx: 0, dy: -40)
    canvas.scrollToVisible(rect)
  }

  /// Puts the caret in a block's text at its start or end.
  func focus(_ id: String, at placement: NoteCaretPlacement) {
    guard let block = blocks.block(id: id) else { return }
    if block.kind.isTextual {
      let length = block.kind.hasPlainContent ? (block.plainText as NSString).length : (NoteFind.displayText(block.inlines) as NSString).length
      apply(.text(id, NSRange(location: placement == .start ? 0 : length, length: 0)))
    } else if block.kind == .table {
      apply(.cell(id, NoteCellAddress(row: 0, column: 0), NSRange(location: 0, length: 0)))
    } else {
      selectBlocks([id])
    }
  }

  /// Shows a block: opens the toggles around it, switches tabs to it, and scrolls it into view.
  func reveal(_ id: String, focus: Bool) {
    guard let path = blocks.path(of: id) else { return }
    var changed = false
    for depth in 1..<max(path.count, 1) {
      guard let ancestor = blocks[path: Array(path.prefix(depth))] else { continue }
      if ancestor.isToggle, !openToggles.contains(ancestor.id) { openToggles.insert(ancestor.id); changed = true }
      if ancestor.kind == .documentTabs, let tab = blocks[path: Array(path.prefix(depth + 1))], activeTab(in: ancestor) != tab.id {
        activeTabs[ancestor.id] = tab.id
        changed = true
      }
    }
    if changed { canvas?.layoutDocument() }
    if let item = canvas?.item(id) {
      canvas?.scrollToVisible(item.frame.insetBy(dx: 0, dy: -60))
    }
    if focus { self.focus(id, at: .start) }
  }

  // MARK: Block selection

  func selectBlocks(_ ids: [String]) {
    setBlockSelection(ids)
    if let canvas, canvas.window?.firstResponder !== canvas { canvas.window?.makeFirstResponder(canvas) }
    if let last = ids.last, let item = canvas?.item(last) { canvas?.scrollToVisible(item.frame) }
  }

  func setBlockSelection(_ ids: [String]) {
    guard ids != selectedBlockIDs else { return }
    let changed = Set(ids).symmetricDifference(selectedBlockIDs)
    selectedBlockIDs = ids
    for id in changed { refreshAlfredView(id) }
    if !ids.isEmpty {
      toolbar.hide()
      suggestions.close()
    }
    canvas?.needsDisplay = true
  }

  func clearBlockSelection() { setBlockSelection([]) }

  @discardableResult
  func selectAllBlocks(from textView: NoteTextView?) -> Bool {
    let ids = blocks.map(\.id)
    selectBlocks(ids)
    return true
  }

  func beginBlockDragSelection(from textView: NoteTextView, event: NSEvent) {
    toolbar.hide()
    canvas?.continueBlockDragSelection(anchorID: textView.blockID, event: event)
  }

  // MARK: Text view events

  func textViewDidFocus(_ textView: NoteTextView) {
    focusedBlockID = textView.blockID
    focusedRole = textView.role
    if !selectedBlockIDs.isEmpty { clearBlockSelection() }
  }

  func textViewDidBlur(_ textView: NoteTextView) {
    breakTypingGroup()
    if case .mathSource = textView.role {
      let id = textView.blockID
      DispatchQueue.main.async { [weak self] in
        guard let self, (self.canvas?.window?.firstResponder as? NoteTextView)?.blockID != id || (self.canvas?.window?.firstResponder as? NoteTextView)?.role != .mathSource else { return }
        self.setMathEditing(id, false)
      }
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let responder = self.canvas?.window?.firstResponder
      if !(responder is NoteTextView) {
        if !self.toolbar.ownsFocus { self.toolbar.hide() }
        if !self.suggestions.isOpen || !(responder is NSTextView) { self.suggestions.close() }
        if responder !== self.canvas { self.focusedBlockID = nil }
      }
    }
  }

  func textViewWillMouseDown(_ textView: NoteTextView) {
    breakTypingGroup()
    if !selectedBlockIDs.isEmpty { clearBlockSelection() }
    suggestions.close()
  }

  func textViewSelectionSettled(_ textView: NoteTextView) {
    updateToolbar(for: textView)
  }

  func textViewSelectionChanged(_ textView: NoteTextView) {
    guard textView.window?.firstResponder === textView else { return }
    adjustTypingAttributes(textView)
    suggestions.selectionChanged(in: textView)
    if NSEvent.pressedMouseButtons == 0 { updateToolbar(for: textView) }
  }

  /// Typing right after a link does not extend it.
  private func adjustTypingAttributes(_ textView: NoteTextView) {
    let range = textView.selectedRange()
    guard range.length == 0, let storage = textView.textStorage, storage.length > 0 else { return }
    var typing = textView.typingAttributes
    typing.removeValue(forKey: .noteAtom)
    typing.removeValue(forKey: .attachment)
    if typing[.noteLink] != nil {
      let after = range.location < storage.length ? storage.attribute(.noteLink, at: range.location, effectiveRange: nil) as? NoteLinkBox : nil
      if after == nil || after != typing[.noteLink] as? NoteLinkBox {
        typing.removeValue(forKey: .noteLink)
        typing.removeValue(forKey: .cursor)
        typing.removeValue(forKey: .toolTip)
        let styles = (typing[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
        if let style = textStyle(for: textView) {
          typing = NoteInlineText.attributes(for: styles, base: style.baseAttributes, style: style)
        }
      }
    }
    textView.typingAttributes = typing
  }

  func updateToolbar(for textView: NoteTextView) {
    let range = textView.selectedRange()
    guard isEditable, range.length > 0, !textView.isPlain, textView.window?.firstResponder === textView, selectedBlockIDs.isEmpty,
          alfredOwner(of: textView.blockID) == nil else {
      if !toolbar.ownsFocus { toolbar.hide() }
      return
    }
    toolbar.show(for: textView)
  }

  /// The base text style of a text view's block or cell.
  func textStyle(for textView: NoteTextView) -> NoteTextStyle? {
    guard let block = blocks.block(id: textView.blockID) else { return nil }
    switch textView.role {
    case .block, .mathSource: return NoteTextStyle.for(block)
    case .cell(let address):
      guard let table = block.content.table, table.rows.indices.contains(address.row), table.rows[address.row].cells.indices.contains(address.column) else { return nil }
      return NoteTableMetrics.cellStyle(table, row: address.row, column: address.column, cell: table.rows[address.row].cells[address.column])
    }
  }

  // MARK: NSTextViewDelegate

  func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
    guard isEditable, let view = textView as? NoteTextView else { return false }
    let focus: NoteFocus
    switch view.role {
    case .block, .mathSource: focus = .text(view.blockID, view.selectedRange())
    case .cell(let address): focus = .cell(view.blockID, address, view.selectedRange())
    }
    if typingFocusBefore == nil { typingFocusBefore = focus }
    return true
  }

  func textDidChange(_ notification: Notification) {
    guard let textView = notification.object as? NoteTextView else { return }
    commitText(from: textView)
  }

  /// Writes a text view's current text into the model.
  func commitText(from textView: NoteTextView, coalesce: Bool = true) {
    guard let storage = textView.textStorage, let block = blocks.block(id: textView.blockID) else { return }
    let focusBefore = typingFocusBefore
    typingFocusBefore = nil
    let id = textView.blockID
    if block.kind == .diagram || block.kind == .generativeUI {
      // A visual's source lives in its props.
      let source = storage.string
      (canvas?.view(for: id) as? NoteVisualBlockView)?.acceptEditedSource(source)
      mutate(coalesce: coalesce ? "type:\(id)" : nil, focusBefore: focusBefore, textEdit: id) { blocks in
        blocks.update(id: id) { $0.props["source"] = .string(source) }
      }
      return
    }
    switch textView.role {
    case .block, .mathSource:
      let content: NoteBlockContent = block.kind.hasPlainContent ? .plain(storage.string) : .inline(NoteInlineText.inlines(from: storage))
      if let view = canvas?.view(for: id) as? NoteTextBlockView { view.acceptEditedContent(content) }
      if let view = canvas?.view(for: id) as? NoteMathBlockView { view.acceptEditedContent(content) }
      mutate(coalesce: coalesce ? "type:\(id)" : nil, focusBefore: focusBefore, textEdit: id) { blocks in
        blocks.update(id: id) { $0.content = content }
      }
      if block.kind == .codeBlock, let view = canvas?.view(for: id) as? NoteTextBlockView { view.rehighlightCode() }
    case .cell(let address):
      guard var table = block.content.table, table.rows.indices.contains(address.row), table.rows[address.row].cells.indices.contains(address.column) else { return }
      table.rows[address.row].cells[address.column].content = NoteInlineText.inlines(from: storage)
      if let view = canvas?.view(for: id) as? NoteTableBlockView { view.acceptEditedTable(table) }
      mutate(coalesce: coalesce ? "type:\(id):\(address.row).\(address.column)" : nil, focusBefore: focusBefore, textEdit: id) { blocks in
        blocks.update(id: id) { $0.content = .table(table) }
      }
    }
  }

  // MARK: Props and simple block state

  func updateProps(_ id: String, _ props: [String: JSONValue], focus: NoteFocus? = nil) {
    mutate(focus: focus) { blocks in
      blocks.update(id: id) { block in
        for (key, value) in props { block.props[key] = value }
      }
    }
  }

  func toggleChecked(_ id: String) {
    guard let block = blocks.block(id: id) else { return }
    updateProps(id, ["checked": .bool(!(block.props["checked"]?.bool ?? false))])
  }

  func isOpen(_ id: String) -> Bool { openToggles.contains(id) }

  func toggleOpen(_ id: String) {
    let closing = openToggles.contains(id)
    if closing { openToggles.remove(id) } else { openToggles.insert(id) }
    canvas?.view(for: id)?.needsDisplay = true
    // Folding away the block that holds the caret moves the caret to the toggle itself.
    let caretInside = closing && focusedBlockID.map { focused in focused != id && (blocks.block(id: id).map { [$0].allIDs.contains(focused) } ?? false) } == true
    canvas?.layoutDocument()
    if caretInside { focus(id, at: .end) }
  }

  func isEditingMath(_ id: String) -> Bool { editingMath.contains(id) }

  func setMathEditing(_ id: String, _ editing: Bool) {
    if editing {
      guard isEditable else { return }
      editingMath.insert(id)
      canvas?.layoutDocument()
      if let view = canvas?.materialize(id) {
        view.blockDidChange(from: nil)
        canvas?.layoutSubtreeIfNeeded()
        if let source = view.primaryTextView {
          focusTextView(source, range: NSRange(location: (source.string as NSString).length, length: 0))
        }
      }
    } else {
      guard editingMath.contains(id) else { return }
      editingMath.remove(id)
      canvas?.layoutDocument()
      canvas?.view(for: id)?.blockDidChange(from: nil)
    }
  }

  func setActiveTab(_ tabID: String, in tabsID: String) { activeTabs[tabsID] = tabID }

  var columnDragOriginID: String? { columnDragOrigin?.id }

  func isDraggingColumns(_ id: String) -> Bool { columnDragOrigin?.id == id }

  /// Column resizing previews live and lands as one undo step when the drag ends.
  func beginColumnDrag(_ id: String) {
    columnDragOrigin = (id, blocks, currentFocus())
  }

  func setRatioLive(_ id: String, ratio: Double) {
    blocks.update(id: id) { $0.props["ratio"] = .number(ratio) }
    canvas?.layoutDocument()
  }

  func endColumnDrag(_ id: String, ratio: Double) {
    guard let origin = columnDragOrigin else { return }
    columnDragOrigin = nil
    blocks = origin.blocks
    mutate(focusBefore: origin.focus) { blocks in blocks.update(id: id) { $0.props["ratio"] = .number(ratio) } }
    canvas?.view(for: id)?.needsDisplay = true
  }

  func isUploading(_ id: String) -> Bool { uploading.contains(id) }
  func uploadError(for id: String) -> String? { uploadErrors[id] }

  func placeholderForParagraph(_ id: String) -> String {
    if blocks.count == 1, blocks.first?.id == id { return "Start writing, or type / for commands" }
    return "Type / for commands"
  }

  func showNotice(_ text: String) {
    model?.notice = text
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(2))
      if self?.model?.notice == text { self?.model?.notice = nil }
    }
  }

  // MARK: Links and attachments

  func resolveURL(_ stored: String) async throws -> URL {
    if stored.hasPrefix("manor-attachment://") {
      guard let resolver = services.resolveAttachment else {
        throw NoteEditorError.message("Attachments are unavailable right now.")
      }
      return try await resolver(stored)
    }
    guard let url = URL(string: stored), let scheme = url.scheme?.lowercased(), ["https", "http", "file", "data"].contains(scheme) else {
      throw NoteEditorError.message("This link is not a web address.")
    }
    return url
  }

  func openExternal(_ url: URL) {
    if let open = services.openURL { open(url) } else { NSWorkspace.shared.open(url) }
  }

  /// Opens a link: in-note fragments jump to their heading, note links open the note, web links open the browser.
  func openLink(_ href: String) {
    if let fragment = NoteFragments.fragment(ofLink: href) {
      if let id = NoteFragments.blockID(for: fragment, in: blocks), blocks.contains(id: id) { reveal(id, focus: true) }
      return
    }
    if href.hasPrefix("manor-note://") {
      services.openNote?(String(href.dropFirst("manor-note://".count)))
      return
    }
    guard let url = URL(string: href.trimmingCharacters(in: .whitespaces)) else { return }
    if url.scheme == nil, let web = URL(string: "https://\(href)") { openExternal(web); return }
    openExternal(url)
  }

  /// Reveals a block named by a deep-link fragment (`#block=<id>`) or a heading slug.
  func revealFragment(_ fragment: String) {
    if let id = NoteFragments.blockID(for: fragment, in: blocks), blocks.contains(id: id) { reveal(id, focus: true) }
  }

  func openAttachment(_ stored: String) {
    Task { [weak self] in
      guard let self else { return }
      do { self.openExternal(try await self.resolveURL(stored)) } catch { self.showNotice(error.localizedDescription) }
    }
  }

  /// Picks a file and uploads it into a media block.
  func chooseAndUpload(for id: String, kind: NoteUploadKind) {
    guard let upload = services.uploadAttachment else { return }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    if !kind.contentTypes.isEmpty {
      panel.allowedContentTypes = kind.contentTypes.compactMap { UTType($0) }
    }
    guard panel.runModal() == .OK, let file = panel.url else { return }
    self.upload(file, into: id, using: upload)
  }

  func upload(_ file: URL, into id: String, using upload: @escaping (URL) async throws -> String) {
    uploading.insert(id)
    uploadErrors[id] = nil
    refreshView(id)
    Task { [weak self] in
      do {
        let stable = try await upload(file)
        guard let self else { return }
        self.uploading.remove(id)
        self.updateProps(id, ["url": .string(stable), "name": .string(file.lastPathComponent)])
        self.refreshView(id)
      } catch {
        guard let self else { return }
        self.uploading.remove(id)
        self.uploadErrors[id] = error.localizedDescription
        self.refreshView(id)
      }
    }
  }

  func refreshView(_ id: String) {
    guard let view = canvas?.view(for: id) else { return }
    view.blockDidChange(from: nil)
  }

  func requestImageEdit(_ id: String) {
    guard isEditable, let block = blocks.block(id: id) else { return }
    let image = (canvas?.view(for: id) as? NoteImageBlockView)?.currentImage
    let request = NoteImageEditRequest(id: id, props: block.props, image: image)
    dialogs.present(over: canvas?.window, width: 600, onDismiss: {}) {
      NoteImageDialog(request: request, canReplace: services.uploadAttachment != nil, onCancel: { [weak self] in
        self?.dialogs.dismiss()
      }, onSave: { [weak self] edited in
        self?.dialogs.dismiss()
        self?.applyImageEdit(edited)
      }, onReplace: { [weak self] in
        self?.dialogs.dismiss()
        self?.chooseAndUpload(for: id, kind: .image)
      })
    }
  }

  func applyImageEdit(_ request: NoteImageEditRequest) {
    guard let block = blocks.block(id: request.id) else { return }
    var changes: [String: JSONValue] = [:]
    for (key, value) in request.props where block.props[key] != value { changes[key] = value }
    if !changes.isEmpty { updateProps(request.id, changes) }
  }

  // MARK: Atoms

  /// A click on an inline atom: mentions open their note; equations open their source.
  func activateAtom(_ atom: NoteInline, at index: Int, in textView: NoteTextView) -> Bool {
    switch atom {
    case .mention(let pageID, _, _):
      services.openNote?(pageID)
      return true
    case .math(let latex, _):
      guard isEditable else { return true }
      NoteInlineMathEditor.present(latex: latex, relativeTo: textView.rect(for: NSRange(location: index, length: 1)), of: textView) { [weak self, weak textView] value in
        guard let self, let textView else { return }
        self.replaceAtom(at: index, in: textView, with: value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .math(value))
      }
      return true
    default:
      return false
    }
  }

  func replaceAtom(at index: Int, in textView: NoteTextView, with item: NoteInline?) {
    guard let storage = textView.textStorage, index < storage.length, let style = textStyle(for: textView) else { return }
    let replacement = item.map { NoteInlineText.atom($0, base: style.baseAttributes, style: style) } ?? NSAttributedString()
    let range = NSRange(location: index, length: 1)
    if textView.shouldChangeText(in: range, replacementString: replacement.string) {
      storage.replaceCharacters(in: range, with: replacement)
      textView.didChangeText()
    }
  }

  // MARK: Find

  func updateFind(query: String) {
    model?.findQuery = query
    findActive = 0
    refreshFind(scroll: true)
  }

  func refreshFind(scroll: Bool = false) {
    if let external = externalFindQuery {
      findMatches = NoteFind.matches(of: external, in: blocks)
      findActive = findMatches.isEmpty ? 0 : min(externalFindIndex, findMatches.count - 1)
      canvas?.refreshFindHighlights()
      return
    }
    let query = model?.findVisible == true ? (model?.findQuery ?? "") : ""
    findMatches = NoteFind.matches(of: query, in: blocks)
    if findActive >= findMatches.count { findActive = max(0, findMatches.count - 1) }
    model?.findCount = findMatches.count
    model?.findIndex = findActive
    canvas?.refreshFindHighlights()
    if scroll { revealActiveMatch() }
  }

  func stepFind(_ delta: Int) {
    guard !findMatches.isEmpty else { return }
    findActive = (findActive + delta + findMatches.count) % findMatches.count
    model?.findIndex = findActive
    canvas?.refreshFindHighlights()
    revealActiveMatch()
  }

  func closeFind() {
    model?.findVisible = false
    findMatches = []
    model?.findCount = 0
    canvas?.refreshFindHighlights()
  }

  private func revealActiveMatch() {
    guard findMatches.indices.contains(findActive) else { return }
    let match = findMatches[findActive]
    reveal(match.blockID, focus: false)
    guard let view = canvas?.materialize(match.blockID) else { return }
    canvas?.layoutSubtreeIfNeeded()
    view.refreshFindHighlights()
    let textView: NoteTextView? = match.cell.flatMap { (view as? NoteTableBlockView)?.cellView($0) } ?? view.primaryTextView
    if let textView, let canvas {
      canvas.scrollToVisible(canvas.convert(textView.rect(for: match.range), from: textView).insetBy(dx: 0, dy: -120))
    }
  }

  func findRanges(in id: String, cell: NoteCellAddress?) -> ([NSRange], NSRange?) {
    guard !findMatches.isEmpty else { return ([], nil) }
    var ranges: [NSRange] = []
    var active: NSRange?
    for (index, match) in findMatches.enumerated() where match.blockID == id && match.cell == cell {
      ranges.append(match.range)
      if index == findActive { active = match.range }
    }
    return (ranges, active)
  }

  func openFind() {
    if let onFindCommand { onFindCommand(); return }
    model?.findVisible = true
    model?.findFocusToken += 1
    refreshFind(scroll: true)
  }

  /// Find driven by the page's own find bar: highlight `query` and show match `index`.
  func setExternalFind(query: String?, index: Int) {
    guard query != externalFindQuery || index != externalFindIndex else { return }
    externalFindQuery = query
    externalFindIndex = index
    findMatches = NoteFind.matches(of: query ?? "", in: blocks)
    findActive = findMatches.isEmpty ? 0 : min(max(index, 0), findMatches.count - 1)
    canvas?.refreshFindHighlights()
    if !findMatches.isEmpty { revealActiveMatch() }
  }
}
