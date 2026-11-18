import AppKit
import ManorKit

/// Which text a `NoteTextView` edits.
enum NoteTextRole: Equatable {
  /// A text block's inline content, or a code block's plain text.
  case block
  /// One table cell.
  case cell(NoteCellAddress)
  /// The LaTeX source of an equation block.
  case mathSource
}

/// The text view of one text block (TextKit 1, so measurement and display agree exactly). Keys that cross
/// block boundaries, shortcuts, paste, and drags that leave the block go to the editor controller.
final class NoteTextView: NSTextView {
  weak var controller: NoteEditorController?
  var blockID: String = ""
  var role: NoteTextRole = .block
  /// Plain text blocks (code, equations) carry no inline styles.
  var isPlain = false
  var placeholder: String?
  var placeholderFont: NSFont = NoteTheme.ui(NoteTheme.bodySize)
  var showsPlaceholderUnfocused = false
  private(set) var isFocused = false

  static func make() -> NoteTextView {
    let storage = NSTextStorage()
    let layoutManager = NSLayoutManager()
    storage.addLayoutManager(layoutManager)
    let container = NSTextContainer(size: NSSize(width: 100, height: CGFloat.greatestFiniteMagnitude))
    container.lineFragmentPadding = 0
    container.widthTracksTextView = true
    layoutManager.addTextContainer(container)
    let view = NoteTextView(frame: NSRect(x: 0, y: 0, width: 100, height: 24), textContainer: container)
    view.configure()
    return view
  }

  private func configure() {
    isRichText = true
    importsGraphics = false
    allowsUndo = false
    drawsBackground = false
    // Views don't clip by default since macOS 14; the selection fill reaches a hair past the frame, and only
    // the frame repaints when it clears, leaving a sliver under the text.
    clipsToBounds = true
    isVerticallyResizable = false
    isHorizontallyResizable = false
    textContainerInset = .zero
    usesFontPanel = false
    usesRuler = false
    usesFindBar = false
    isAutomaticQuoteSubstitutionEnabled = false
    isAutomaticDashSubstitutionEnabled = false
    isAutomaticTextReplacementEnabled = false
    isAutomaticLinkDetectionEnabled = false
    isAutomaticDataDetectionEnabled = false
    isContinuousSpellCheckingEnabled = true
    smartInsertDeleteEnabled = false
    focusRingType = .none
    insertionPointColor = NoteTheme.ink
    selectedTextAttributes = [.backgroundColor: NoteTheme.selection]
    linkTextAttributes = [:]
    layoutManager?.allowsNonContiguousLayout = false
  }

  /// Code and equation source: no inline styles, no spelling marks. Highlighting still colors the text.
  func setPlain(_ plain: Bool) {
    guard plain != isPlain else { return }
    isPlain = plain
    isContinuousSpellCheckingEnabled = !plain
    isGrammarCheckingEnabled = false
    isAutomaticSpellingCorrectionEnabled = false
  }

  /// Text views keep no undo history of their own: the controller's snapshot history spans blocks, and
  /// Undo and Redo reach it through `undo(_:)` and `redo(_:)` below.
  override var undoManager: UndoManager? { nil }

  private var resizing = false

  /// The canvas sizes text views during layout. NSTextView answers a frame change by scrolling its selection
  /// into view, which would yank the document to whichever block was just laid out; only the focused view
  /// scrolls, and only for the caret (typing, arrow keys), never for a resize.
  override func setFrameSize(_ newSize: NSSize) {
    resizing = true
    super.setFrameSize(newSize)
    resizing = false
  }

  override func scrollToVisible(_ rect: NSRect) -> Bool {
    guard isFocused, !resizing else { return false }
    return super.scrollToVisible(rect)
  }

  /// Files dropped on text go to the canvas, which uploads them as blocks.
  override var acceptableDragTypes: [NSPasteboard.PasteboardType] {
    super.acceptableDragTypes.filter { $0 != .fileURL && $0.rawValue != "NSFilenamesPboardType" && $0 != .tiff && $0 != .png }
  }

  @objc func undo(_ sender: Any?) { controller?.undo() }
  @objc func redo(_ sender: Any?) { controller?.redo() }

  override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
    switch item.action {
    case #selector(undo(_:)): return controller?.undoManager.canUndo ?? false
    case #selector(redo(_:)): return controller?.undoManager.canRedo ?? false
    default: return super.validateUserInterfaceItem(item)
    }
  }

  // MARK: Focus

  override func becomeFirstResponder() -> Bool {
    let became = super.becomeFirstResponder()
    if became {
      isFocused = true
      needsDisplay = true
      controller?.textViewDidFocus(self)
    }
    return became
  }

  override func resignFirstResponder() -> Bool {
    let resigned = super.resignFirstResponder()
    if resigned {
      isFocused = false
      needsDisplay = true
      controller?.textViewDidBlur(self)
    }
    return resigned
  }

  // MARK: Keys

  override func keyDown(with event: NSEvent) {
    if controller?.handleKeyDown(event, in: self) == true { return }
    super.keyDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard window?.firstResponder === self else { return super.performKeyEquivalent(with: event) }
    if controller?.handleKeyEquivalent(event, in: self) == true { return true }
    return super.performKeyEquivalent(with: event)
  }

  override func doCommand(by selector: Selector) {
    if controller?.handleCommand(selector, in: self) == true { return }
    super.doCommand(by: selector)
  }

  override func insertText(_ string: Any, replacementRange: NSRange) {
    super.insertText(string, replacementRange: replacementRange)
    let text = (string as? String) ?? (string as? NSAttributedString)?.string ?? ""
    controller?.textViewDidInsert(text, in: self)
  }

  // MARK: Clipboard

  override func copy(_ sender: Any?) {
    if controller?.copySelection(from: self, cut: false) == true { return }
    super.copy(sender)
  }

  override func cut(_ sender: Any?) {
    if controller?.copySelection(from: self, cut: true) == true { return }
    super.cut(sender)
  }

  override func paste(_ sender: Any?) {
    if controller?.paste(into: self, plain: false) == true { return }
    super.paste(sender)
  }

  override func pasteAsPlainText(_ sender: Any?) {
    if controller?.paste(into: self, plain: true) == true { return }
    super.pasteAsPlainText(sender)
  }

  override func selectAll(_ sender: Any?) {
    // A second Select All while the block's text is already selected selects every block.
    if selectedRange() == NSRange(location: 0, length: (string as NSString).length), controller?.selectAllBlocks(from: self) == true { return }
    super.selectAll(sender)
  }

  // MARK: Mouse

  /// The inline atom (mention, equation) or link under a point, if the point is on its glyphs.
  func hit(at point: NSPoint) -> (index: Int, atom: NoteInline?, link: NoteLinkBox?)? {
    guard let layoutManager, let textContainer, let storage = textStorage, storage.length > 0 else { return nil }
    let containerPoint = NSPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
    var fraction: CGFloat = 0
    let glyph = layoutManager.glyphIndex(for: containerPoint, in: textContainer, fractionOfDistanceThroughGlyph: &fraction)
    let rect = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: textContainer)
    guard rect.insetBy(dx: -1, dy: -2).contains(containerPoint) else { return nil }
    let index = layoutManager.characterIndexForGlyph(at: glyph)
    guard index < storage.length else { return nil }
    let atom = (storage.attribute(.noteAtom, at: index, effectiveRange: nil) as? NoteAtomBox)?.inline
    let link = storage.attribute(.noteLink, at: index, effectiveRange: nil) as? NoteLinkBox
    return (index, atom, link)
  }

  override func mouseDown(with event: NSEvent) {
    guard let window else { super.mouseDown(with: event); return }
    controller?.textViewWillMouseDown(self)
    let point = convert(event.locationInWindow, from: nil)
    let hit = self.hit(at: point)
    if event.clickCount == 1, let atom = hit?.atom, controller?.activateAtom(atom, at: hit!.index, in: self) == true { return }
    let commandClick = event.modifierFlags.contains(.command)
    guard event.clickCount == 1, !event.modifierFlags.contains(.shift), !commandClick || hit?.link != nil else {
      super.mouseDown(with: event)
      controller?.textViewSelectionSettled(self)
      return
    }
    let index = characterIndexForInsertion(at: point)
    let selection = selectedRange()
    if selection.length > 0, NSLocationInRange(index, selection), isFocused {
      // Dragging selected text moves it, as NSTextView does.
      super.mouseDown(with: event)
      controller?.textViewSelectionSettled(self)
      return
    }
    if window.firstResponder !== self { window.makeFirstResponder(self) }
    setSelectedRange(NSRange(location: index, length: 0))
    let anchor = index
    var moved = false
    let start = event.locationInWindow
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      if next.type == .leftMouseUp { break }
      if !moved, hypot(next.locationInWindow.x - start.x, next.locationInWindow.y - start.y) < 3 { continue }
      moved = true
      if let host = superview {
        let inHost = host.convert(next.locationInWindow, from: nil)
        if inHost.y < host.bounds.minY - 6 || inHost.y > host.bounds.maxY + 6 {
          // Leaving the block turns the text selection into a block selection.
          controller?.beginBlockDragSelection(from: self, event: next)
          return
        }
      }
      let current = characterIndexForInsertion(at: convert(next.locationInWindow, from: nil))
      setSelectedRange(NSRange(location: min(anchor, current), length: abs(current - anchor)), affinity: .downstream, stillSelecting: true)
      autoscroll(with: next)
    }
    setSelectedRange(selectedRange(), affinity: .downstream, stillSelecting: false)
    if !moved, let link = hit?.link {
      controller?.openLink(link.href)
      return
    }
    controller?.textViewSelectionSettled(self)
  }

  override func rightMouseDown(with event: NSEvent) {
    controller?.textViewWillMouseDown(self)
    super.rightMouseDown(with: event)
  }

  override func menu(for event: NSEvent) -> NSMenu? {
    let menu = super.menu(for: event) ?? NSMenu()
    controller?.decorateContextMenu(menu, for: self)
    return menu
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard let placeholder, string.isEmpty, isFocused || showsPlaceholderUnfocused, hasMarkedText() == false else { return }
    let attributes: [NSAttributedString.Key: Any] = [
      .font: placeholderFont,
      .foregroundColor: NoteTheme.inkMuted.withAlphaComponent(0.55),
      .paragraphStyle: (typingAttributes[.paragraphStyle] as? NSParagraphStyle) ?? NSParagraphStyle.default,
      .baselineOffset: (typingAttributes[.baselineOffset] as? CGFloat) ?? 0
    ]
    (placeholder as NSString).draw(in: bounds, withAttributes: attributes)
  }

  override func setSelectedRanges(_ ranges: [NSValue], affinity: NSSelectionAffinity, stillSelecting: Bool) {
    super.setSelectedRanges(ranges, affinity: affinity, stillSelecting: stillSelecting)
    if !stillSelecting { controller?.textViewSelectionChanged(self) }
  }

  /// The rect of a character range in this view's coordinates.
  func rect(for range: NSRange) -> NSRect {
    guard let layoutManager, let textContainer else { return bounds }
    let length = (string as NSString).length
    if length == 0 {
      return NSRect(x: textContainerOrigin.x, y: textContainerOrigin.y, width: 1, height: max(bounds.height, 20))
    }
    let clamped = NSRange(location: min(range.location, length), length: min(range.length, length - min(range.location, length)))
    var glyphRange = layoutManager.glyphRange(forCharacterRange: clamped, actualCharacterRange: nil)
    if glyphRange.length == 0 {
      if clamped.location >= length {
        glyphRange = layoutManager.glyphRange(forCharacterRange: NSRange(location: length - 1, length: 1), actualCharacterRange: nil)
        var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
        rect.origin.x = rect.maxX
        rect.size.width = 1
        return rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
      }
      glyphRange.length = 1
    }
    var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
    if clamped.length == 0 { rect.size.width = 1 }
    return rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
  }

  /// The caret's line rect, used for moving between blocks at the same horizontal position.
  var caretRect: NSRect { rect(for: NSRange(location: selectedRange().location, length: 0)) }

  /// Whether the caret is on the first visual line.
  var caretOnFirstLine: Bool {
    guard let layoutManager, (string as NSString).length > 0 else { return true }
    let location = selectedRange().location
    if location == 0 { return true }
    let glyph = layoutManager.glyphIndexForCharacter(at: min(location, (string as NSString).length - 1))
    var lineRange = NSRange()
    layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: &lineRange)
    if location >= (string as NSString).length, (string as NSString).character(at: location - 1) == 10 { return false }
    return lineRange.location == 0
  }

  /// Whether the caret is on the last visual line.
  var caretOnLastLine: Bool {
    guard let layoutManager, (string as NSString).length > 0 else { return true }
    let length = (string as NSString).length
    let location = selectedRange().location + selectedRange().length
    if location >= length { return true }
    let glyph = layoutManager.glyphIndexForCharacter(at: location)
    var lineRange = NSRange()
    layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: &lineRange)
    return NSMaxRange(lineRange) >= layoutManager.numberOfGlyphs
  }

  /// The character index nearest a horizontal position on the first or last line.
  func index(atX x: CGFloat, onFirstLine: Bool) -> Int {
    guard let layoutManager, let textContainer, (string as NSString).length > 0 else { return 0 }
    let usedRect = layoutManager.usedRect(for: textContainer)
    let y = onFirstLine ? usedRect.minY + 4 : usedRect.maxY - 4
    return characterIndexForInsertion(at: NSPoint(x: x, y: y + textContainerOrigin.y))
  }

  /// Highlights find matches without changing the text.
  func setFindHighlights(_ ranges: [NSRange], active: NSRange?) {
    guard let layoutManager else { return }
    let full = NSRange(location: 0, length: (string as NSString).length)
    layoutManager.removeTemporaryAttribute(.backgroundColor, forCharacterRange: full)
    for range in ranges where NSMaxRange(range) <= full.length {
      layoutManager.addTemporaryAttribute(.backgroundColor, value: range == active ? NoteTheme.findActive : NoteTheme.findMatch, forCharacterRange: range)
    }
  }
}
