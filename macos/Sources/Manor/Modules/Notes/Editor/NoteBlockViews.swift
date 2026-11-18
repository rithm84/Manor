import AppKit
import ManorKit

/// The view of one block on the canvas. Children are separate views; containers only draw their chrome.
class NoteBlockView: NSView {
  weak var controller: NoteEditorController?
  private(set) var block: NoteBlock
  private(set) var item: NoteLayoutItem

  override var isFlipped: Bool { true }

  required init(item: NoteLayoutItem, controller: NoteEditorController) {
    self.block = item.block
    self.item = item
    self.controller = controller
    super.init(frame: item.frame)
    wantsLayer = true
    setUp()
    blockDidChange(from: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  /// Builds subviews once.
  func setUp() {}

  /// Applies a new layout item; re-renders only when the block changed.
  func apply(_ item: NoteLayoutItem) {
    let previous = block
    if self.item.number != item.number || self.item.nesting != item.nesting || self.item.childrenVisible != item.childrenVisible { needsDisplay = true }
    self.item = item
    if frame != item.frame { frame = item.frame }
    if previous != item.block {
      block = item.block
      blockDidChange(from: previous)
    }
    needsLayout = true
  }

  func blockDidChange(from previous: NoteBlock?) { needsDisplay = true }

  /// Whether the reader can change this block: never for the blocks an Alfred block renders from its source.
  var isEditable: Bool { !item.isAlfredContent && (controller?.isEditable ?? false) }

  /// The vertical center of the first line, where the block handle sits.
  var handleAnchorY: CGFloat { 14 }

  /// The text view to focus when the caret enters this block.
  var primaryTextView: NoteTextView? { nil }

  /// Called when the find matches or the active match changed.
  func refreshFindHighlights() {}

  /// Called when the appearance changed, so cached renderings refresh.
  func appearanceDidChange() { needsDisplay = true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    appearanceDidChange()
  }
}

// MARK: - Text blocks

/// Paragraphs, headings, lists, quotes, callouts, and code blocks.
final class NoteTextBlockView: NoteBlockView {
  let textView = NoteTextView.make()
  private var renderedContent: NoteBlockContent?
  private var renderedStyle: NoteTextStyle?
  private var languageButton: NSButton?
  private var copyButton: NSButton?
  private var hoveringMarker = false
  private var trackingArea: NSTrackingArea?

  override func setUp() {
    textView.controller = controller
    textView.blockID = block.id
    textView.delegate = controller
    addSubview(textView)
  }

  override var primaryTextView: NoteTextView? { textView }

  var insets: NoteTextInsets { NoteTextInsets.for(block) }
  var style: NoteTextStyle { NoteTextStyle.for(block) }
  private var outerMargin: CGFloat { (block.kind == .callout || block.kind == .codeBlock) ? 4 : 0 }

  override var handleAnchorY: CGFloat {
    if block.kind == .codeBlock { return outerMargin + 18 }
    return outerMargin + insets.top + style.lineHeight / 2
  }

  override func blockDidChange(from previous: NoteBlock?) {
    textView.blockID = block.id
    textView.isEditable = isEditable
    textView.isSelectable = true
    let style = self.style
    textView.setPlain(block.kind == .codeBlock)
    textView.placeholder = placeholder
    textView.placeholderFont = style.font
    textView.showsPlaceholderUnfocused = false
    if renderedContent != block.content || renderedStyle != style {
      render(style: style)
    }
    updateCodeChrome()
    needsDisplay = true
    needsLayout = true
  }

  /// Marks the current content as what the text view shows, after the text view itself produced it.
  func acceptEditedContent(_ content: NoteBlockContent) {
    renderedContent = content
  }

  private func render(style: NoteTextStyle) {
    let text: NSMutableAttributedString
    switch block.content {
    case .plain(let value): text = NoteInlineText.plainAttributedString(value, style: style)
    case .inline(let items): text = NoteInlineText.attributedString(items, style: style)
    default: text = NSMutableAttributedString(string: "", attributes: style.baseAttributes)
    }
    if block.kind == .codeBlock { NoteCodeHighlighter.highlight(text, language: block.string("language") ?? "text") }
    let selection = textView.selectedRange()
    let focused = textView.isFocused
    textView.textStorage?.setAttributedString(text)
    textView.typingAttributes = style.baseAttributes
    if focused {
      let length = text.length
      textView.setSelectedRange(NSRange(location: min(selection.location, length), length: min(selection.length, max(0, length - min(selection.location, length)))))
    }
    renderedContent = block.content
    renderedStyle = style
    refreshFindHighlights()
  }

  /// Re-applies code highlighting after typing in a code block.
  func rehighlightCode() {
    guard block.kind == .codeBlock, let storage = textView.textStorage else { return }
    let selection = textView.selectedRange()
    NoteInlineText.restyle(storage, style: style)
    NoteCodeHighlighter.highlight(storage, language: block.string("language") ?? "text")
    textView.setSelectedRange(selection)
  }

  private var placeholder: String? {
    guard isEditable else { return nil }
    switch block.kind {
    case .heading: return "Heading \(min(block.props["level"]?.int ?? 1, 6))"
    case .bulletListItem, .numberedListItem: return "List"
    case .checkListItem: return "To-do"
    case .toggleListItem: return "Toggle"
    case .quote: return "Quote"
    case .callout: return "Callout"
    case .codeBlock: return nil
    default: return controller?.placeholderForParagraph(block.id) ?? "Type / for commands"
    }
  }

  private func updateCodeChrome() {
    guard block.kind == .codeBlock else {
      languageButton?.removeFromSuperview()
      languageButton = nil
      copyButton?.removeFromSuperview()
      copyButton = nil
      return
    }
    if languageButton == nil {
      let button = NSButton(title: "", target: self, action: #selector(chooseLanguage(_:)))
      button.isBordered = false
      button.font = NoteTheme.ui(12, .medium)
      button.contentTintColor = NoteTheme.inkMuted
      button.toolTip = "Change language"
      addSubview(button)
      languageButton = button
      let copy = NSButton(image: NSImage(systemSymbolName: "doc.on.doc", accessibilityDescription: "Copy code") ?? NSImage(), target: self, action: #selector(copyCode(_:)))
      copy.isBordered = false
      copy.contentTintColor = NoteTheme.inkMuted
      copy.toolTip = "Copy code"
      copy.imageScaling = .scaleProportionallyDown
      addSubview(copy)
      copyButton = copy
    }
    let name = NoteSchema.codeLanguageName(block.string("language") ?? "text")
    languageButton?.attributedTitle = NSAttributedString(string: name + "  \u{2304}", attributes: [.font: NoteTheme.ui(12, .medium), .foregroundColor: NoteTheme.inkMuted])
    languageButton?.isEnabled = isEditable
  }

  @objc private func chooseLanguage(_ sender: NSButton) {
    let menu = NSMenu()
    let current = NoteSchema.codeLanguage(for: block.string("language") ?? "text")
    for language in NoteSchema.codeLanguages {
      let item = NSMenuItem(title: language.name, action: #selector(pickLanguage(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = language.id
      item.state = language.id == current ? .on : .off
      menu.addItem(item)
    }
    menu.popUp(positioning: menu.items.first { $0.state == .on }, at: NSPoint(x: 0, y: sender.bounds.height), in: sender)
  }

  @objc private func pickLanguage(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String else { return }
    controller?.updateProps(block.id, ["language": .string(id)])
  }

  @objc private func copyCode(_ sender: Any?) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(block.plainText, forType: .string)
    controller?.showNotice("Code copied")
  }

  override func layout() {
    super.layout()
    let insets = self.insets
    let margin = outerMargin
    let frame = NSRect(x: insets.left, y: margin + insets.top, width: max(10, bounds.width - insets.left - insets.right),
                       height: max(10, bounds.height - insets.top - insets.bottom - margin * 2))
    if textView.frame != frame {
      textView.frame = frame
      textView.textContainer?.size = NSSize(width: frame.width, height: CGFloat.greatestFiniteMagnitude)
    }
    if let languageButton {
      languageButton.sizeToFit()
      languageButton.frame.origin = NSPoint(x: 12, y: margin + 8)
    }
    if let copyButton {
      copyButton.frame = NSRect(x: bounds.width - 34, y: margin + 6, width: 24, height: 22)
    }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseMoved(with event: NSEvent) {
    let hovering = markerRect.contains(convert(event.locationInWindow, from: nil))
    if hovering != hoveringMarker {
      hoveringMarker = hovering
      needsDisplay = true
    }
    if hovering && (block.kind == .checkListItem || block.isToggle) { NSCursor.pointingHand.set() }
  }

  override func mouseExited(with event: NSEvent) {
    if hoveringMarker { hoveringMarker = false; needsDisplay = true }
  }

  private var markerRect: NSRect {
    let line = style.lineHeight
    return NSRect(x: 0, y: outerMargin + insets.top + (line - 22) / 2, width: NoteTheme.markerWidth - 2, height: 22)
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if markerRect.contains(point) {
      if block.kind == .checkListItem, isEditable { controller?.toggleChecked(block.id); return }
      if block.isToggle { controller?.toggleOpen(block.id); return }
    }
    // Clicks in the padding place the caret at the nearest end of the text.
    if point.y < textView.frame.minY || point.x < textView.frame.minX {
      controller?.focus(block.id, at: .start)
    } else {
      controller?.focus(block.id, at: .end)
    }
  }

  override func refreshFindHighlights() {
    guard let controller else { return }
    let (ranges, active) = controller.findRanges(in: block.id, cell: nil)
    textView.setFindHighlights(ranges, active: active)
  }

  override func appearanceDidChange() {
    super.appearanceDidChange()
    renderedStyle = nil
    if !textView.isFocused { render(style: style) }
    updateCodeChrome()
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let insets = self.insets
    let margin = outerMargin
    let line = style.lineHeight
    let firstLineMid = margin + insets.top + line / 2
    switch block.kind {
    case .callout:
      let tone = block.string("tone") ?? "plum"
      let colors = NoteTheme.calloutColors(tone)
      let rect = bounds.insetBy(dx: 0, dy: margin)
      let path = NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control)
      colors.fill.setFill()
      path.fill()
      NoteTheme.hairline.setStroke()
      path.lineWidth = 1
      if let symbol = NSImage(systemSymbolName: NoteTheme.calloutSymbol(tone), accessibilityDescription: nil)?
        .withSymbolConfiguration(.init(pointSize: 15, weight: .medium)) {
        let tinted = symbol.noteTinted(colors.icon)
        tinted.draw(in: NSRect(x: 16, y: firstLineMid - 9, width: 18, height: 18))
      }
    case .codeBlock:
      let rect = bounds.insetBy(dx: 0, dy: margin)
      let path = NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control)
      NoteTheme.surfaceSoft.setFill()
      path.fill()
      NoteTheme.hairline.setStroke()
      path.lineWidth = 1
      path.stroke()
    case .quote:
      NoteTheme.primary.withAlphaComponent(0.75).setFill()
      NSBezierPath(roundedRect: NSRect(x: 2, y: insets.top - 1, width: 3, height: bounds.height - insets.top - insets.bottom + 2), xRadius: 1.5, yRadius: 1.5).fill()
    default:
      if let background = NoteTheme.backgroundColor(named: block.string("backgroundColor")) {
        background.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: Radius.chip, yRadius: Radius.chip).fill()
      }
    }
    drawMarker(firstLineMid: firstLineMid)
  }

  private func drawMarker(firstLineMid: CGFloat) {
    let center = NSPoint(x: NoteTheme.markerWidth / 2 - 2, y: firstLineMid)
    let ink = NoteTheme.textColor(named: block.string("textColor")) ?? NoteTheme.inkBody
    switch block.kind {
    case .bulletListItem:
      ink.setFill()
      ink.setStroke()
      switch item.nesting % 3 {
      case 0: NSBezierPath(ovalIn: NSRect(x: center.x - 2.75, y: center.y - 2.75, width: 5.5, height: 5.5)).fill()
      case 1:
        let ring = NSBezierPath(ovalIn: NSRect(x: center.x - 2.75, y: center.y - 2.75, width: 5.5, height: 5.5))
        ring.lineWidth = 1.2
        ring.stroke()
      default: NSBezierPath(rect: NSRect(x: center.x - 2.5, y: center.y - 2.5, width: 5, height: 5)).fill()
      }
    case .numberedListItem:
      let label = numberLabel(item.number ?? 1, depth: item.nesting) as NSString
      let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(NoteTheme.bodySize).noteTabularDigits(), .foregroundColor: ink]
      let size = label.size(withAttributes: attributes)
      label.draw(at: NSPoint(x: NoteTheme.markerWidth - 6 - size.width, y: firstLineMid - size.height / 2), withAttributes: attributes)
    case .checkListItem:
      let checked = block.props["checked"]?.bool == true
      let box = NSRect(x: center.x - 8, y: center.y - 8, width: 16, height: 16)
      let path = NSBezierPath(roundedRect: box, xRadius: 4, yRadius: 4)
      if checked {
        NoteTheme.primary.setFill()
        path.fill()
        let tick = NSBezierPath()
        tick.move(to: NSPoint(x: box.minX + 4, y: box.midY))
        tick.line(to: NSPoint(x: box.minX + 7, y: box.maxY - 4.5))
        tick.line(to: NSPoint(x: box.maxX - 3.5, y: box.minY + 4.5))
        tick.lineWidth = 1.8
        tick.lineCapStyle = .round
        tick.lineJoinStyle = .round
        NoteTheme.ns(Palette.onPrimary).setStroke()
        tick.stroke()
      } else {
        (hoveringMarker ? NoteTheme.surfaceHover : NoteTheme.surfaceCard).setFill()
        path.fill()
        NoteTheme.ns(Palette.controlBorder).setStroke()
        path.lineWidth = 1.2
        path.stroke()
      }
    case .toggleListItem, .heading:
      // Every toggle list item has a chevron; a heading has one only when it is toggleable.
      guard block.isToggle else { break }
      let open = controller?.isOpen(block.id) ?? false
      if hoveringMarker {
        NoteTheme.surfaceHover.setFill()
        NSBezierPath(roundedRect: NSRect(x: center.x - 10, y: center.y - 10, width: 20, height: 20), xRadius: 4, yRadius: 4).fill()
      }
      let chevron = NSBezierPath()
      if open {
        chevron.move(to: NSPoint(x: center.x - 4, y: center.y - 2))
        chevron.line(to: NSPoint(x: center.x, y: center.y + 2.5))
        chevron.line(to: NSPoint(x: center.x + 4, y: center.y - 2))
      } else {
        chevron.move(to: NSPoint(x: center.x - 2, y: center.y - 4))
        chevron.line(to: NSPoint(x: center.x + 2.5, y: center.y))
        chevron.line(to: NSPoint(x: center.x - 2, y: center.y + 4))
      }
      chevron.lineWidth = 1.6
      chevron.lineCapStyle = .round
      chevron.lineJoinStyle = .round
      (block.children.isEmpty ? NoteTheme.inkMuted.withAlphaComponent(0.6) : NoteTheme.inkBody).setStroke()
      chevron.stroke()
    default:
      break
    }
  }

  /// Numbers by depth: 1., a., i.
  private func numberLabel(_ number: Int, depth: Int) -> String {
    switch depth % 3 {
    case 1: return letters(number) + "."
    case 2: return roman(number) + "."
    default: return "\(number)."
    }
  }

  private func letters(_ number: Int) -> String {
    var value = max(number, 1)
    var out = ""
    while value > 0 {
      value -= 1
      out = String(UnicodeScalar(UInt8(97 + value % 26))) + out
      value /= 26
    }
    return out
  }

  private func roman(_ number: Int) -> String {
    // Roman numerals grow with the number (one "m" per thousand); large starts read as plain numbers.
    guard number <= 3999 else { return String(number) }
    let table: [(Int, String)] = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    var value = max(number, 1)
    var out = ""
    for (amount, symbol) in table { while value >= amount { out += symbol; value -= amount } }
    return out
  }
}

extension NSFont {
  func noteTabularDigits() -> NSFont {
    let descriptor = fontDescriptor.addingAttributes([.featureSettings: [[NSFontDescriptor.FeatureKey.typeIdentifier: kNumberSpacingType,
                                                                          NSFontDescriptor.FeatureKey.selectorIdentifier: kMonospacedNumbersSelector]]])
    return NSFont(descriptor: descriptor, size: pointSize) ?? self
  }
}

extension NSImage {
  func noteTinted(_ color: NSColor) -> NSImage {
    let image = NSImage(size: size, flipped: false) { rect in
      self.draw(in: rect)
      color.set()
      rect.fill(using: .sourceAtop)
      return true
    }
    image.isTemplate = false
    return image
  }
}

// MARK: - Simple blocks

final class NoteDividerView: NoteBlockView {
  override var handleAnchorY: CGFloat { bounds.midY }
  override func draw(_ dirtyRect: NSRect) {
    NoteTheme.ns(Palette.hairlineStrong).setFill()
    NSRect(x: 0, y: floor(bounds.midY), width: bounds.width, height: 1).fill()
  }
  override func mouseDown(with event: NSEvent) { controller?.selectBlocks([block.id]) }
}

/// A block this version does not know how to show. Its stored JSON is kept untouched.
final class NoteUnknownBlockView: NoteBlockView {
  override var handleAnchorY: CGFloat { bounds.midY }
  override func draw(_ dirtyRect: NSRect) {
    let rect = bounds.insetBy(dx: 0, dy: 4)
    let path = NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control)
    NoteTheme.surfaceSoft.setFill()
    path.fill()
    let text = "This block can't be shown here. It stays in the note unchanged." as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.inkMuted]
    let size = text.size(withAttributes: attributes)
    text.draw(at: NSPoint(x: 14, y: rect.midY - size.height / 2), withAttributes: attributes)
  }
  override func mouseDown(with event: NSEvent) { controller?.selectBlocks([block.id]) }
}

/// The live table of contents: the document's headings, kept current on every edit.
final class NoteTableOfContentsView: NoteBlockView {
  private var headings: [NoteHeading] = []
  private var hovered: Int?
  private var trackingArea: NSTrackingArea?
  override var handleAnchorY: CGFloat { 20 }

  func setHeadings(_ headings: [NoteHeading]) {
    guard headings != self.headings else { return }
    self.headings = headings
    needsDisplay = true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect, .cursorUpdate], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  private func row(at point: NSPoint) -> Int? {
    guard point.y >= 38 else { return nil }
    let index = Int((point.y - 38) / 28)
    return headings.indices.contains(index) ? index : nil
  }

  override func mouseMoved(with event: NSEvent) {
    let row = self.row(at: convert(event.locationInWindow, from: nil))
    if row != hovered { hovered = row; needsDisplay = true }
    if row != nil { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
  }

  override func mouseExited(with event: NSEvent) { hovered = nil; needsDisplay = true }

  override func mouseDown(with event: NSEvent) {
    if let row = row(at: convert(event.locationInWindow, from: nil)) {
      controller?.reveal(headings[row].id, focus: true)
    } else {
      controller?.selectBlocks([block.id])
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let titleAttributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(12, .semibold), .foregroundColor: NoteTheme.inkMuted, .kern: 0.6]
    if let icon = NSImage(systemSymbolName: "list.bullet.indent", accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 12, weight: .medium)) {
      icon.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: 2, y: 13, width: 14, height: 12))
    }
    ("CONTENTS" as NSString).draw(at: NSPoint(x: 22, y: 11), withAttributes: titleAttributes)
    if headings.isEmpty {
      ("Add headings to build the outline." as NSString).draw(at: NSPoint(x: 6, y: 42), withAttributes: [.font: NoteTheme.ui(14), .foregroundColor: NoteTheme.inkMuted])
      return
    }
    for (index, heading) in headings.enumerated() {
      let y = 38 + CGFloat(index) * 28
      let indent = CGFloat(max(heading.level - 1, 0)) * 16
      let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(14, heading.level == 1 ? .medium : .regular),
                                                       .foregroundColor: hovered == index ? NoteTheme.primary : NoteTheme.inkBody]
      let size = (heading.title as NSString).size(withAttributes: attributes)
      let width = min(size.width + 12, bounds.width - indent)
      if hovered == index {
        NoteTheme.primaryTint.setFill()
        NSBezierPath(roundedRect: NSRect(x: indent, y: y + 2, width: width, height: 24), xRadius: Radius.chip, yRadius: Radius.chip).fill()
      }
      let style = NSMutableParagraphStyle()
      style.lineBreakMode = .byTruncatingTail
      var drawAttributes = attributes
      drawAttributes[.paragraphStyle] = style
      (heading.title as NSString).draw(in: NSRect(x: indent + 6, y: y + 14 - size.height / 2, width: width - 12, height: size.height), withAttributes: drawAttributes)
    }
  }
}

// MARK: - Layout containers

/// Draws the column gutter of a column layout and lets the reader drag it to resize the columns.
final class NoteColumnsView: NoteBlockView {
  private var hoverGutter = false
  private var trackingArea: NSTrackingArea?
  override var handleAnchorY: CGFloat { 16 }

  private var gutterX: CGFloat? {
    guard block.children.count >= 2, bounds.width >= NoteLayoutEngine.stackBreakpoint else { return nil }
    let engine = NoteLayoutEngine(openToggles: [], activeTabs: [:], measuredHeights: [:], editingMath: [], isEditable: true, headingCount: { 0 })
    let widths = engine.columnWidths(block, total: bounds.width)
    return widths[0] + NoteTheme.columnGap / 2
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  private func nearGutter(_ point: NSPoint) -> Bool {
    guard let gutterX, isEditable, block.kind == .twoColumns else { return false }
    return abs(point.x - gutterX) < 8
  }

  override func mouseMoved(with event: NSEvent) {
    let near = nearGutter(convert(event.locationInWindow, from: nil))
    if near != hoverGutter { hoverGutter = near; needsDisplay = true }
    if near { NSCursor.resizeLeftRight.set() }
  }

  override func mouseExited(with event: NSEvent) {
    if hoverGutter { hoverGutter = false; needsDisplay = true }
    NSCursor.arrow.set()
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    guard nearGutter(point), let window else {
      controller?.clickedEmptyContainerArea(block.id, at: convert(point, to: superview))
      return
    }
    let available = bounds.width - NoteTheme.columnGap
    var ratio = block.props["ratio"]?.double ?? 50
    while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
      let x = convert(next.locationInWindow, from: nil).x - NoteTheme.columnGap / 2
      ratio = (min(75, max(25, Double(x / available * 100))) / 5).rounded() * 5
      if next.type == .leftMouseUp { break }
      controller?.setColumnRatio(block.id, ratio: ratio, final: false)
    }
    controller?.setColumnRatio(block.id, ratio: ratio, final: true)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let gutterX, hoverGutter || (controller?.isDraggingColumns(block.id) ?? false) else { return }
    NoteTheme.primary.withAlphaComponent(0.55).setFill()
    NSBezierPath(roundedRect: NSRect(x: gutterX - 1.5, y: 8, width: 3, height: bounds.height - 16), xRadius: 1.5, yRadius: 1.5).fill()
  }
}

/// The tab strip of an in-document tabs block.
final class NoteTabsStripView: NoteBlockView, NSTextFieldDelegate {
  private var tabFrames: [(id: String, frame: NSRect)] = []
  private var addFrame: NSRect = .zero
  private var hovered: String?
  private var renameField: NSTextField?
  private var renamingID: String?
  private var trackingArea: NSTrackingArea?
  override var handleAnchorY: CGFloat { 22 }

  override func blockDidChange(from previous: NoteBlock?) {
    computeFrames()
    needsDisplay = true
  }

  override func layout() {
    super.layout()
    computeFrames()
  }

  private func title(of tab: NoteBlock, index: Int) -> String {
    let stored = tab.string("title") ?? ""
    return stored.isEmpty ? "Tab \(index + 1)" : stored
  }

  private func computeFrames() {
    var x: CGFloat = 0
    tabFrames = block.children.enumerated().map { index, tab in
      let width = (title(of: tab, index: index) as NSString).size(withAttributes: [.font: NoteTheme.ui(13, .medium)]).width + 24
      defer { x += width + 2 }
      return (tab.id, NSRect(x: x, y: 6, width: width, height: 32))
    }
    addFrame = NSRect(x: x + 2, y: 9, width: 26, height: 26)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseMoved(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let next = tabFrames.first { $0.frame.contains(point) }?.id ?? (addFrame.contains(point) ? "__add" : nil)
    if next != hovered { hovered = next; needsDisplay = true }
  }

  override func mouseExited(with event: NSEvent) { hovered = nil; needsDisplay = true }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if addFrame.contains(point), isEditable {
      controller?.addTab(to: block.id)
      return
    }
    guard let tab = tabFrames.first(where: { $0.frame.contains(point) }) else {
      controller?.selectBlocks([block.id])
      return
    }
    if event.clickCount == 2, isEditable {
      beginRename(tab.id)
    } else {
      controller?.selectTab(tab.id, in: block.id)
    }
  }

  override func menu(for event: NSEvent) -> NSMenu? {
    let point = convert(event.locationInWindow, from: nil)
    guard isEditable, let tab = tabFrames.first(where: { $0.frame.contains(point) }) else { return nil }
    let menu = NSMenu()
    let rename = NSMenuItem(title: "Rename", action: #selector(renameFromMenu(_:)), keyEquivalent: "")
    rename.target = self
    rename.representedObject = tab.id
    menu.addItem(rename)
    let delete = NSMenuItem(title: "Delete tab", action: #selector(deleteFromMenu(_:)), keyEquivalent: "")
    delete.target = self
    delete.representedObject = tab.id
    delete.isEnabled = block.children.count > 1
    menu.addItem(delete)
    menu.autoenablesItems = false
    return menu
  }

  @objc private func renameFromMenu(_ sender: NSMenuItem) {
    if let id = sender.representedObject as? String { beginRename(id) }
  }

  @objc private func deleteFromMenu(_ sender: NSMenuItem) {
    if let id = sender.representedObject as? String { controller?.deleteTab(id, in: block.id) }
  }

  private func beginRename(_ id: String) {
    guard let frame = tabFrames.first(where: { $0.id == id })?.frame, let index = block.children.firstIndex(where: { $0.id == id }) else { return }
    renameField?.removeFromSuperview()
    let field = NSTextField(string: title(of: block.children[index], index: index))
    field.font = NoteTheme.ui(13, .medium)
    field.focusRingType = .none
    field.isBordered = true
    field.bezelStyle = .roundedBezel
    field.delegate = self
    field.frame = NSRect(x: frame.minX, y: frame.minY + 3, width: max(frame.width + 40, 120), height: 26)
    field.target = self
    field.action = #selector(commitRename(_:))
    addSubview(field)
    window?.makeFirstResponder(field)
    field.currentEditor()?.selectAll(nil)
    renameField = field
    renamingID = id
  }

  @objc private func commitRename(_ sender: Any?) {
    guard let field = renameField, let id = renamingID else { return }
    let title = String(field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
    renameField = nil
    renamingID = nil
    field.removeFromSuperview()
    if !title.isEmpty { controller?.renameTab(id, to: title) }
  }

  func controlTextDidEndEditing(_ notification: Notification) { commitRename(nil) }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    if commandSelector == #selector(cancelOperation(_:)) {
      renameField?.removeFromSuperview()
      renameField = nil
      renamingID = nil
      return true
    }
    return false
  }

  override func draw(_ dirtyRect: NSRect) {
    let active = controller?.activeTab(in: block) ?? block.children.first?.id
    NoteTheme.hairline.setFill()
    NSRect(x: 0, y: bounds.height - 1, width: bounds.width, height: 1).fill()
    for (index, tab) in block.children.enumerated() {
      guard let frame = tabFrames.first(where: { $0.id == tab.id })?.frame else { continue }
      let isActive = tab.id == active
      if hovered == tab.id && !isActive {
        NoteTheme.surfaceHover.setFill()
        NSBezierPath(roundedRect: frame.insetBy(dx: 0, dy: 2), xRadius: Radius.chip, yRadius: Radius.chip).fill()
      }
      let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(13, isActive ? .semibold : .medium),
                                                       .foregroundColor: isActive ? NoteTheme.ink : NoteTheme.inkMuted]
      let label = title(of: tab, index: index) as NSString
      let size = label.size(withAttributes: attributes)
      label.draw(at: NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2), withAttributes: attributes)
      if isActive {
        NoteTheme.primary.setFill()
        NSBezierPath(roundedRect: NSRect(x: frame.minX + 6, y: bounds.height - 2.5, width: frame.width - 12, height: 2.5), xRadius: 1.25, yRadius: 1.25).fill()
      }
    }
    if isEditable {
      if hovered == "__add" {
        NoteTheme.surfaceHover.setFill()
        NSBezierPath(roundedRect: addFrame, xRadius: Radius.chip, yRadius: Radius.chip).fill()
      }
      if let plus = NSImage(systemSymbolName: "plus", accessibilityDescription: "Add tab")?.withSymbolConfiguration(.init(pointSize: 12, weight: .medium)) {
        plus.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: addFrame.midX - 6, y: addFrame.midY - 6, width: 12, height: 12))
      }
    }
  }
}
