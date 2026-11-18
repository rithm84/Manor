import AppKit
import ManorKit

/// Where dragged blocks land.
enum NoteDropTarget: Equatable {
  case before(String)
  case after(String)
  /// Nested as the first child of a block, or into an empty column or tab.
  case firstChild(String)
  /// Beside a block, wrapping both in two columns.
  case columnBeside(String)
}

/// The document view: lays out every block, keeps views only for the blocks near the visible area,
/// and owns block selection, the hover handle, rubber-band selection, and block dragging.
final class NoteCanvasView: NSView {
  weak var controller: NoteEditorController?
  private(set) var items: [NoteLayoutItem] = []
  private var itemIndex: [String: Int] = [:]
  private var views: [String: NoteBlockView] = [:]
  private let handle = NoteBlockHandleView()
  private var hoveredID: String?
  private var trackingArea: NSTrackingArea?
  private var dropTarget: NoteDropTarget?
  private var rubberBand: NSRect?
  private var lastWidth: CGFloat = 0
  private(set) var contentX: CGFloat = 0
  private(set) var contentWidth: CGFloat = 0
  /// The height the document needs, for sizing the editor inside an outer scroll view.
  private(set) var documentHeight: CGFloat = 0
  /// Inside a page that scrolls on its own, the editor grows to its content and aligns its text to a fixed
  /// leading inset; alone, it scrolls and centers a reading column.
  var isEmbedded = false
  var onDocumentHeightChange: ((CGFloat) -> Void)?
  static let topPadding: CGFloat = 8
  /// Space above the header (the note title) and between it and the first block.
  static let headerTop: CGFloat = 40
  static let headerGap: CGFloat = 12
  /// A view laid out above the first block that scrolls with the document (the note title).
  var headerView: NSView? {
    didSet {
      guard headerView !== oldValue else { return }
      oldValue?.removeFromSuperview()
      if let headerView { addSubview(headerView, positioned: .below, relativeTo: handle) }
      headerHeight = 0
    }
  }
  /// Measures the header at a width; set alongside `headerView`.
  var measureHeader: ((CGFloat) -> CGFloat)?
  private var headerHeight: CGFloat = 0
  private var documentTop: CGFloat { headerView == nil ? Self.topPadding : Self.headerTop + headerHeight + Self.headerGap }

  /// Re-measures the header and lays the document out again when its height changed.
  func headerChanged() {
    guard let measure = measureHeader, contentWidth > 0 else { layoutDocument(); return }
    if abs(measure(contentWidth) - headerHeight) > 0.5 { layoutDocument() }
  }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }

  init(controller: NoteEditorController) {
    self.controller = controller
    super.init(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    wantsLayer = true
    handle.canvas = self
    handle.isHidden = true
    addSubview(handle)
    registerForDraggedTypes([.fileURL])
  }

  // MARK: File drops

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    guard controller?.isEditable == true, controller?.services.uploadAttachment != nil else { return [] }
    return .copy
  }

  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
    guard controller?.isEditable == true, controller?.services.uploadAttachment != nil else { return [] }
    let point = convert(sender.draggingLocation, from: nil)
    if let item = hoverItem(at: point) { dropTarget = .after(item.id) } else { dropTarget = nil }
    needsDisplay = true
    return .copy
  }

  override func draggingExited(_ sender: NSDraggingInfo?) {
    dropTarget = nil
    needsDisplay = true
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    defer { dropTarget = nil; needsDisplay = true }
    guard let controller, controller.isEditable, let upload = controller.services.uploadAttachment,
          let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
          !urls.isEmpty else { return false }
    let point = convert(sender.draggingLocation, from: nil)
    guard let anchor = hoverItem(at: point)?.id ?? controller.blocks.last?.id else { return false }
    controller.insertFiles(urls, after: anchor, upload: upload)
    return true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var undoManager: UndoManager? { controller?.undoManager ?? super.undoManager }
  @objc func undo(_ sender: Any?) { controller?.undo() }
  @objc func redo(_ sender: Any?) { controller?.redo() }

  @objc func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
    switch item.action {
    case #selector(undo(_:)): return controller?.undoManager.canUndo ?? false
    case #selector(redo(_:)): return controller?.undoManager.canRedo ?? false
    case #selector(copy(_:)), #selector(cut(_:)), #selector(delete(_:)): return !(controller?.selectedBlockIDs.isEmpty ?? true)
    case #selector(paste(_:)): return controller?.isEditable ?? false
    case #selector(selectAll(_:)): return true
    default: return true
    }
  }

  // MARK: Layout

  /// Recomputes every block's frame and refreshes the views near the visible area.
  func layoutDocument() {
    guard let controller else { return }
    let width = enclosingScrollView?.contentSize.width ?? bounds.width
    let available = max(width, 320)
    if isEmbedded {
      contentX = NoteTheme.handleGutter
      contentWidth = max(240, min(NoteTheme.maxContentWidth, available - NoteTheme.handleGutter - 8))
    } else {
      contentWidth = max(240, min(NoteTheme.maxContentWidth, available - NoteTheme.handleGutter - NoteTheme.minSideMargin))
      contentX = max(NoteTheme.handleGutter, floor((available - contentWidth) / 2))
    }
    if let headerView {
      headerHeight = ceil(measureHeader?(contentWidth) ?? headerView.fittingSize.height)
      headerView.frame = NSRect(x: contentX, y: Self.headerTop, width: contentWidth, height: headerHeight)
    }
    let engine = controller.layoutEngine()
    let result = engine.layout(controller.blocks, x: contentX, width: contentWidth, top: documentTop)
    items = result.items
    itemIndex = Dictionary(items.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
    let needed = documentTop + result.height + (isEmbedded ? 72 : 180)
    if abs(needed - documentHeight) > 0.5 {
      documentHeight = needed
      onDocumentHeightChange?(needed)
    }
    let minHeight = isEmbedded ? 0 : (enclosingScrollView?.contentSize.height ?? 0)
    let height = max(minHeight, needed)
    if frame.size != NSSize(width: available, height: height) {
      setFrameSize(NSSize(width: available, height: height))
    }
    lastWidth = available
    updateVisibleViews()
    positionHandle()
    needsDisplay = true
  }

  override func resizeSubviews(withOldSize oldSize: NSSize) {
    super.resizeSubviews(withOldSize: oldSize)
  }

  /// The fast path after typing in one block: when the block kept its height, only its layout item (and the
  /// snapshots its ancestors hold) change, and no other block moves. Returns `false` when a full layout is needed.
  func relayoutTextChange(_ id: String) -> Bool {
    guard let controller, let index = itemIndex[id], let block = controller.blocks.block(id: id), block.kind != .heading else { return false }
    let item = items[index]
    let height = controller.layoutEngine().ownHeight(of: block, width: item.frame.width)
    guard abs(height - item.frame.height) < 0.5 else { return false }
    items[index].block = block
    var parent = item.parentID
    while let parentID = parent, let parentIndex = itemIndex[parentID] {
      if let updated = controller.blocks.block(id: parentID) { items[parentIndex].block = updated }
      parent = items[parentIndex].parentID
    }
    if let view = views[id] { view.apply(items[index]) }
    return true
  }

  func clipBoundsChanged() {
    let width = enclosingScrollView?.contentSize.width ?? bounds.width
    if abs(width - lastWidth) > 0.5 {
      layoutDocument()
    } else {
      updateVisibleViews()
    }
  }

  func item(_ id: String) -> NoteLayoutItem? { itemIndex[id].map { items[$0] } }

  /// Drops every block view (a different note opened).
  func resetViews() {
    for view in views.values { view.removeFromSuperview() }
    views = [:]
    hoveredID = nil
    handle.isHidden = true
  }

  func view(for id: String) -> NoteBlockView? { views[id] }

  /// Creates the view for a block now, even when it is off-screen, so the caret can enter it.
  @discardableResult
  func materialize(_ id: String) -> NoteBlockView? {
    guard let item = item(id) else { return nil }
    return ensureView(for: item)
  }

  private func viewClass(for item: NoteLayoutItem) -> NoteBlockView.Type? {
    switch item.block.kind {
    case .paragraph, .heading, .bulletListItem, .numberedListItem, .checkListItem, .toggleListItem, .quote, .callout, .codeBlock:
      return item.block.content.inlines != nil || item.block.content.plainString != nil ? NoteTextBlockView.self : NoteUnknownBlockView.self
    case .mathBlock: return NoteMathBlockView.self
    case .divider: return NoteDividerView.self
    case .table: return item.block.content.table != nil ? NoteTableBlockView.self : NoteUnknownBlockView.self
    case .image: return NoteImageBlockView.self
    case .video, .audio: return NoteAVBlockView.self
    case .file: return NoteFileBlockView.self
    case .webBookmark, .webEmbed: return NoteWebBlockView.self
    case .tableOfContents: return NoteTableOfContentsView.self
    case .twoColumns, .columnList: return NoteColumnsView.self
    case .documentTabs: return NoteTabsStripView.self
    case .noteColumn, .column, .documentTab: return nil
    case .alfred:
      if item.id == NoteAlfredSelectionEdit.previewID { return NoteAlfredPreviewView.self }
      return item.isAlfredContent ? NoteUnknownBlockView.self : NoteAlfredBlockView.self
    case .diagram, .generativeUI: return NoteVisualBlockView.self
    case .unknown: return NoteUnknownBlockView.self
    }
  }

  @discardableResult
  private func ensureView(for item: NoteLayoutItem) -> NoteBlockView? {
    guard let controller, let type = viewClass(for: item) else { return nil }
    if let existing = views[item.id] {
      if Swift.type(of: existing) == type {
        existing.apply(item)
        return existing
      }
      existing.removeFromSuperview()
      views[item.id] = nil
    }
    let view = type.init(item: item, controller: controller)
    if item.block.kind == .twoColumns || item.block.kind == .columnList || item.block.kind == .alfred {
      addSubview(view, positioned: .below, relativeTo: nil)
    } else {
      addSubview(view, positioned: .below, relativeTo: handle)
    }
    views[item.id] = view
    if let toc = view as? NoteTableOfContentsView { toc.setHeadings(controller.headings) }
    return view
  }

  /// Keeps views for blocks within a margin of the visible rect, the focused block, and live media.
  func updateVisibleViews() {
    guard let controller else { return }
    let margin: CGFloat = 900
    let visible = visibleRect.insetBy(dx: 0, dy: -margin)
    let focused = controller.focusedBlockID
    var wanted = Set<String>()
    for item in items where item.frame.intersects(visible) || item.id == focused || (item.frame.height > 0 && visible.intersects(item.extent) && item.block.kind.isLayoutContainer) {
      guard let view = ensureView(for: item) else { continue }
      wanted.insert(item.id)
      if let toc = view as? NoteTableOfContentsView { toc.setHeadings(controller.headings) }
    }
    for (id, view) in views where !wanted.contains(id) {
      let keepAlive = itemIndex[id] != nil && (view is NoteAVBlockView || view is NoteWebBlockView)
      if keepAlive {
        if let item = item(id) { view.apply(item) }
        continue
      }
      if let responder = view.window?.firstResponder as? NSView, responder.isDescendant(of: view) {
        // The focused block stays while it is merely off-screen; a block no longer laid out (an inactive
        // tab, a collapsed toggle, a removed block) gives up focus so it never lingers over other blocks.
        if itemIndex[id] != nil { continue }
        view.window?.makeFirstResponder(self)
      }
      view.removeFromSuperview()
      views[id] = nil
    }
  }

  /// Media views resolve again after the attachment services changed.
  func refreshMediaViews() {
    for view in views.values where view is NoteMediaBlockView { view.blockDidChange(from: nil) }
  }

  /// Re-applies find highlights on every live view.
  func refreshFindHighlights() {
    for view in views.values { view.refreshFindHighlights() }
  }

  func appearanceChanged() {
    NoteTextMeasurer.shared.invalidate()
    for view in views.values { view.appearanceDidChange() }
    layoutDocument()
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    guard let controller else { return }
    let selected = controller.selectedBlockIDs
    if !selected.isEmpty {
      NoteTheme.blockSelection.setFill()
      for id in selected {
        guard let item = item(id) else { continue }
        let rect = item.extent.insetBy(dx: -4, dy: 0)
        NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4).fill()
      }
    }
    if let rubberBand {
      NoteTheme.primary.withAlphaComponent(0.08).setFill()
      rubberBand.fill()
    }
    if let dropTarget { drawDropIndicator(dropTarget) }
  }

  private func drawDropIndicator(_ target: NoteDropTarget) {
    NoteTheme.primary.setFill()
    switch target {
    case .before(let id):
      guard let item = item(id) else { return }
      NSBezierPath(roundedRect: NSRect(x: item.frame.minX, y: item.frame.minY - 2, width: item.frame.width, height: 3), xRadius: 1.5, yRadius: 1.5).fill()
    case .after(let id):
      guard let item = item(id) else { return }
      NSBezierPath(roundedRect: NSRect(x: item.extent.minX, y: item.extent.maxY - 1, width: item.extent.width, height: 3), xRadius: 1.5, yRadius: 1.5).fill()
    case .firstChild(let id):
      guard let item = item(id) else { return }
      if item.block.kind == .noteColumn || item.block.kind == .column || item.block.kind == .documentTab {
        NoteTheme.primary.withAlphaComponent(0.12).setFill()
        NSBezierPath(roundedRect: item.extent, xRadius: 4, yRadius: 4).fill()
      } else {
        NSBezierPath(roundedRect: NSRect(x: item.frame.minX + NoteTheme.childIndent, y: item.frame.maxY - 1, width: item.frame.width - NoteTheme.childIndent, height: 3), xRadius: 1.5, yRadius: 1.5).fill()
      }
    case .columnBeside(let id):
      guard let item = item(id) else { return }
      NSBezierPath(roundedRect: NSRect(x: item.frame.maxX + 4, y: item.frame.minY, width: 3, height: item.extent.height), xRadius: 1.5, yRadius: 1.5).fill()
    }
  }

  // MARK: Hover handle

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  /// The block whose handle shows for a point: the innermost block on that row.
  func hoverItem(at point: NSPoint) -> NoteLayoutItem? {
    // The innermost block on the row whose column the pointer is in (its text or the handle gutter to its
    // left); a block in a neighboring column only when no block claims the point.
    var best: NoteLayoutItem?
    var bestInside = false
    for item in items {
      let kind = item.block.kind
      if kind == .noteColumn || kind == .column || kind == .documentTab || item.isAlfredContent { continue }
      let frame = item.frame
      guard point.y >= frame.minY, point.y < frame.maxY, point.x >= frame.minX - NoteTheme.handleGutter, point.x <= frame.maxX + 20 else { continue }
      if kind == .twoColumns || kind == .columnList {
        // Containers show their handle only along their top edge.
        guard point.y < frame.minY + 14 else { continue }
      }
      let inside = point.x <= frame.maxX
      if best == nil || (inside && !bestInside) || (inside == bestInside && item.depth >= best!.depth) {
        best = item
        bestInside = inside
      }
    }
    return best
  }

  override func mouseMoved(with event: NSEvent) {
    guard controller?.isEditable == true, !handle.isTracking else { return }
    let point = convert(event.locationInWindow, from: nil)
    let id = hoverItem(at: point)?.id
    if id != hoveredID {
      hoveredID = id
      positionHandle()
    }
  }

  override func mouseExited(with event: NSEvent) {
    guard !handle.isTracking else { return }
    let point = convert(event.locationInWindow, from: nil)
    if !handle.frame.contains(point) {
      hoveredID = nil
      positionHandle()
    }
  }

  private func positionHandle() {
    guard let id = hoveredID, let item = item(id), controller?.isEditable == true else {
      handle.isHidden = true
      return
    }
    let anchor = views[id]?.handleAnchorY ?? 14
    handle.blockID = id
    handle.frame = NSRect(x: item.frame.minX - 37, y: item.frame.minY + anchor - 12, width: 36, height: 24)
    handle.isHidden = false
    handle.needsDisplay = true
  }

  // MARK: Mouse

  override func mouseDown(with event: NSEvent) {
    guard let controller, let window else { return }
    let point = convert(event.locationInWindow, from: nil)
    // Below the last block: continue writing at the end of the note.
    if let last = items.last(where: { $0.depth == 0 }), point.y > last.extent.maxY, point.x > contentX - 20, point.x < contentX + contentWidth + 20 {
      controller.clickedBelowContent()
      return
    }
    if let item = items.last(where: { ($0.block.kind == .noteColumn || $0.block.kind == .documentTab || $0.block.kind == .column) && $0.extent.contains(point) && $0.block.children.isEmpty }) {
      controller.addParagraph(inEmpty: item.id)
      return
    }
    // From the margins, dragging selects whole blocks.
    controller.clearBlockSelection()
    window.makeFirstResponder(self)
    let start = point
    var moved = false
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      let current = convert(next.locationInWindow, from: nil)
      if next.type == .leftMouseUp { break }
      if !moved && hypot(current.x - start.x, current.y - start.y) < 4 { continue }
      moved = true
      let rect = NSRect(x: min(start.x, current.x), y: min(start.y, current.y), width: abs(current.x - start.x), height: abs(current.y - start.y))
      rubberBand = rect
      let hit = items.filter { item in
        let kind = item.block.kind
        guard kind != .noteColumn && kind != .column && kind != .documentTab && !item.isAlfredContent else { return false }
        return item.frame.minY < rect.maxY && item.frame.maxY > rect.minY && item.frame.minX < rect.maxX + 400 && item.frame.maxX > rect.minX - 400
      }.map(\.id)
      controller.setBlockSelection(controller.blocks.outermost(Set(hit)).map(\.id))
      autoscroll(with: next)
      needsDisplay = true
    }
    rubberBand = nil
    needsDisplay = true
    if !moved {
      // A click in the side margin focuses the nearest block's text.
      if let nearest = items.filter({ $0.block.kind.isTextual }).min(by: { abs($0.frame.midY - point.y) < abs($1.frame.midY - point.y) }) {
        controller.focus(nearest.id, at: point.x < contentX ? .start : .end)
      }
    }
  }

  /// Continues a text drag that left its block as a block selection, until the mouse goes up.
  func continueBlockDragSelection(anchorID: String, event: NSEvent) {
    guard let controller, let window else { return }
    window.makeFirstResponder(self)
    func update(_ event: NSEvent) {
      let point = convert(event.locationInWindow, from: nil)
      let ordered = items.filter { $0.block.kind != .noteColumn && $0.block.kind != .column && $0.block.kind != .documentTab && !$0.isAlfredContent }
      guard let anchorIndex = ordered.firstIndex(where: { $0.id == anchorID }) else { return }
      let targetIndex = ordered.firstIndex(where: { point.y < $0.frame.maxY }) ?? ordered.count - 1
      let range = min(anchorIndex, targetIndex)...max(anchorIndex, targetIndex)
      let ids = Set(ordered[range].map(\.id))
      controller.setBlockSelection(controller.blocks.outermost(ids).map(\.id))
      autoscroll(with: event)
    }
    update(event)
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      update(next)
      if next.type == .leftMouseUp { break }
    }
  }

  // MARK: Block dragging

  /// Drags blocks from the handle. Returns `false` when the mouse never moved (a click).
  func dragBlocks(_ ids: [String], event: NSEvent) -> Bool {
    guard let controller, let window else { return false }
    let start = event.locationInWindow
    var moved = false
    let dragged = Set(ids)
    let draggedTree = Set(controller.blocks.outermost(dragged).flatMap { [$0].allIDs })
    var image: NSImageView?
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      if next.type == .leftMouseUp { break }
      if !moved && hypot(next.locationInWindow.x - start.x, next.locationInWindow.y - start.y) < 4 { continue }
      if !moved {
        moved = true
        controller.setBlockSelection(ids)
        image = makeDragImage(for: ids)
        if let image { addSubview(image) }
        NSCursor.closedHand.push()
      }
      let point = convert(next.locationInWindow, from: nil)
      dropTarget = target(at: point, excluding: draggedTree)
      if let image { image.frame.origin = NSPoint(x: point.x + 12, y: point.y - image.frame.height / 2) }
      autoscroll(with: next)
      needsDisplay = true
    }
    image?.removeFromSuperview()
    if moved { NSCursor.pop() }
    let target = dropTarget
    dropTarget = nil
    needsDisplay = true
    if moved, let target { controller.moveBlocks(ids, to: target) }
    return moved
  }

  private func makeDragImage(for ids: [String]) -> NSImageView? {
    guard let first = ids.first, let view = views[first], let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: rep)
    let image = NSImage(size: view.bounds.size)
    image.addRepresentation(rep)
    let imageView = NSImageView(image: image)
    imageView.frame = NSRect(origin: .zero, size: NSSize(width: min(view.bounds.width, 420), height: min(view.bounds.height, 160)))
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageView.imageAlignment = .alignTopLeft
    imageView.alphaValue = 0.55
    return imageView
  }

  private func target(at point: NSPoint, excluding: Set<String>) -> NoteDropTarget? {
    // An empty column or tab under the pointer takes the blocks.
    if let empty = items.last(where: { ($0.block.kind == .noteColumn || $0.block.kind == .column || $0.block.kind == .documentTab) && $0.block.children.isEmpty && $0.extent.contains(point) }),
       !excluding.contains(empty.id) {
      return .firstChild(empty.id)
    }
    let candidates = items.filter { item in
      let kind = item.block.kind
      return !excluding.contains(item.id) && kind != .noteColumn && kind != .column && kind != .documentTab && !item.isAlfredContent
        && point.x >= item.frame.minX - NoteTheme.handleGutter && point.x <= item.frame.maxX + 60
    }
    guard let item = candidates.last(where: { point.y >= $0.frame.minY && point.y < $0.frame.maxY })
      ?? candidates.min(by: { distance(point.y, $0.frame) < distance(point.y, $1.frame) }) else { return nil }
    let kind = item.block.kind
    if item.depth == 0, !kind.isLayoutContainer, point.x > item.frame.maxX - 36, point.y >= item.frame.minY, point.y < item.frame.maxY {
      return .columnBeside(item.id)
    }
    // Before or after the block under the pointer; nesting stays with Tab, so reordering
    // never nests a block by accident.
    if point.y < item.frame.midY { return .before(item.id) }
    if item.childrenVisible, let firstChild = item.block.children.first?.id {
      // Below a block whose children show, the drop lands above its first child, where the line is drawn.
      return .before(firstChild)
    }
    return .after(item.id)
  }

  private func distance(_ y: CGFloat, _ frame: NSRect) -> CGFloat {
    y < frame.minY ? frame.minY - y : (y > frame.maxY ? y - frame.maxY : 0)
  }

  // MARK: Keyboard (block selection)

  override func keyDown(with event: NSEvent) {
    if controller?.handleBlockSelectionKey(event) == true { return }
    super.keyDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard window?.firstResponder === self else { return super.performKeyEquivalent(with: event) }
    if controller?.handleBlockSelectionKeyEquivalent(event) == true { return true }
    return super.performKeyEquivalent(with: event)
  }

  @objc func copy(_ sender: Any?) { controller?.copySelectedBlocks(cut: false) }
  @objc func cut(_ sender: Any?) { controller?.copySelectedBlocks(cut: true) }
  @objc func paste(_ sender: Any?) { controller?.pasteAfterSelectedBlocks() }
  @objc func delete(_ sender: Any?) { controller?.deleteSelectedBlocks() }
  override func selectAll(_ sender: Any?) { controller?.selectAllBlocks(from: nil) }

  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    return resigned
  }
}

/// The hover handle beside a block: add a block below, or drag and open the block menu.
final class NoteBlockHandleView: NSView {
  weak var canvas: NoteCanvasView?
  var blockID: String?
  private(set) var isTracking = false
  private var hoverPart: Int?
  private var trackingArea: NSTrackingArea?

  override var isFlipped: Bool { true }

  private var plusRect: NSRect { NSRect(x: 0, y: 1, width: 18, height: 22) }
  private var gripRect: NSRect { NSRect(x: 19, y: 1, width: 16, height: 22) }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseMoved(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let part = plusRect.contains(point) ? 0 : gripRect.contains(point) ? 1 : nil
    if part != hoverPart { hoverPart = part; needsDisplay = true }
    toolTip = part == 0 ? "Click to add a block below. Option-click to add above." : part == 1 ? "Drag to move. Click to open the menu." : nil
  }

  override func mouseExited(with event: NSEvent) { hoverPart = nil; needsDisplay = true }

  override func mouseDown(with event: NSEvent) {
    guard let blockID, let canvas, let controller = canvas.controller else { return }
    let point = convert(event.locationInWindow, from: nil)
    if plusRect.contains(point) {
      controller.insertBlockFromHandle(near: blockID, above: event.modifierFlags.contains(.option))
      return
    }
    isTracking = true
    let ids = controller.selectedBlockIDs.contains(blockID) ? controller.selectedBlockIDs : [blockID]
    let dragged = canvas.dragBlocks(ids, event: event)
    isTracking = false
    if !dragged {
      controller.setBlockSelection(ids)
      controller.showBlockMenu(for: ids, anchor: self)
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let ink = NoteTheme.inkMuted.withAlphaComponent(0.8)
    for (index, rect) in [plusRect, gripRect].enumerated() where hoverPart == index {
      NoteTheme.surfaceHover.setFill()
      NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4).fill()
    }
    ink.setStroke()
    let plus = NSBezierPath()
    plus.move(to: NSPoint(x: plusRect.midX - 5, y: plusRect.midY))
    plus.line(to: NSPoint(x: plusRect.midX + 5, y: plusRect.midY))
    plus.move(to: NSPoint(x: plusRect.midX, y: plusRect.midY - 5))
    plus.line(to: NSPoint(x: plusRect.midX, y: plusRect.midY + 5))
    plus.lineWidth = 1.5
    plus.lineCapStyle = .round
    plus.stroke()
    ink.setFill()
    for column in 0..<2 {
      for row in 0..<3 {
        let x = gripRect.midX - 3 + CGFloat(column) * 6
        let y = gripRect.midY - 5 + CGFloat(row) * 5
        NSBezierPath(ovalIn: NSRect(x: x - 1.3, y: y - 1.3, width: 2.6, height: 2.6)).fill()
      }
    }
  }
}
