import AppKit
import ManorKit
import SwiftMath

extension NSAttributedString.Key {
  /// The block styles of a run (`NoteStylesBox`). The source of truth; fonts and colors derive from it.
  static let noteStyles = NSAttributedString.Key("manor.note.styles")
  /// The link a run belongs to (`NoteLinkBox`).
  static let noteLink = NSAttributedString.Key("manor.note.link")
  /// The inline atom an attachment character stands for (`NoteAtomBox`).
  static let noteAtom = NSAttributedString.Key("manor.note.atom")
}

final class NoteStylesBox: NSObject {
  let styles: NoteStyles
  init(_ styles: NoteStyles) { self.styles = styles }
  override func isEqual(_ object: Any?) -> Bool { (object as? NoteStylesBox)?.styles == styles }
  override var hash: Int { styles.hashValue }
}

final class NoteLinkBox: NSObject {
  let href: String
  let other: [String: JSONValue]
  let identity: Int
  init(href: String, other: [String: JSONValue], identity: Int) {
    self.href = href
    self.other = other
    self.identity = identity
  }
  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? NoteLinkBox else { return false }
    return other.href == href && other.other == self.other && other.identity == identity
  }
  override var hash: Int { href.hashValue ^ identity }
}

final class NoteAtomBox: NSObject {
  let inline: NoteInline
  init(_ inline: NoteInline) { self.inline = inline }
}

/// The base look of a text block: font, color, alignment, and line height. Inline styles layer on top.
struct NoteTextStyle: Hashable {
  enum Role: Hashable { case body, heading(Int), code, cell, caption, mathSource }
  var role: Role
  var textColorName: String?
  var alignment: NSTextAlignment = .left
  var isQuote = false
  var muted = false
  /// Header cells read in a heavier weight.
  var strong = false

  var font: NSFont {
    switch role {
    case .body: NoteTheme.ui(NoteTheme.bodySize, strong ? .semibold : .regular)
    case .heading(let level):
      switch level {
      case 1: NoteTheme.display(30)
      case 2: NoteTheme.display(24)
      case 3: NoteTheme.display(20)
      default: NoteTheme.display(17)
      }
    case .code, .mathSource: NoteTheme.mono(13.5)
    case .cell: NoteTheme.ui(14, strong ? .semibold : .regular)
    case .caption: NoteTheme.ui(13)
    }
  }

  var lineHeight: CGFloat {
    switch role {
    case .body: 24
    case .heading(let level): level == 1 ? 38 : level == 2 ? 31 : level == 3 ? 27 : 24
    case .code, .mathSource: 21
    case .cell: 21
    case .caption: 19
    }
  }

  var color: NSColor {
    if let named = NoteTheme.textColor(named: textColorName) { return named }
    if muted { return NoteTheme.inkMuted }
    switch role {
    case .heading: return NoteTheme.ink
    case .code: return NoteTheme.ink
    default: return isQuote ? NoteTheme.inkBody : NoteTheme.inkBody
    }
  }

  var paragraphStyle: NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.minimumLineHeight = lineHeight
    style.alignment = alignment
    style.lineBreakMode = .byWordWrapping
    if role == .code || role == .mathSource {
      style.lineBreakMode = .byCharWrapping
    }
    return style
  }

  /// Raises glyphs so text sits centered in its line instead of on the line's floor.
  var baselineOffset: CGFloat {
    let font = self.font
    let natural = ceil(font.ascender - font.descender + font.leading)
    return max(0, (lineHeight - natural) / 2)
  }

  var baseAttributes: [NSAttributedString.Key: Any] {
    var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraphStyle,
                                                     .baselineOffset: baselineOffset, .noteStyles: NoteStylesBox(.plain)]
    if muted {
      // A checked to-do reads as done: muted and struck through.
      attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      attributes[.strikethroughColor] = NoteTheme.inkMuted.withAlphaComponent(0.6)
    }
    return attributes
  }

  static func `for`(_ block: NoteBlock) -> NoteTextStyle {
    let alignment: NSTextAlignment = switch block.string("textAlignment") {
    case "center": .center
    case "right": .right
    case "justify": .justified
    default: .left
    }
    switch block.kind {
    case .heading:
      return NoteTextStyle(role: .heading(block.props["level"]?.int ?? 1), textColorName: block.string("textColor"), alignment: alignment)
    case .codeBlock: return NoteTextStyle(role: .code)
    case .mathBlock, .diagram, .generativeUI: return NoteTextStyle(role: .mathSource)
    case .quote: return NoteTextStyle(role: .body, textColorName: block.string("textColor"), alignment: alignment, isQuote: true)
    case .checkListItem:
      return NoteTextStyle(role: .body, textColorName: block.string("textColor"), alignment: alignment, muted: block.props["checked"]?.bool == true)
    default: return NoteTextStyle(role: .body, textColorName: block.string("textColor"), alignment: alignment)
    }
  }
}

/// Converts inline content to attributed text for editing, and back.
enum NoteInlineText {
  // MARK: To attributed text

  static func attributedString(_ items: [NoteInline], style: NoteTextStyle) -> NSMutableAttributedString {
    let output = NSMutableAttributedString()
    let base = style.baseAttributes
    var linkIdentity = 0
    for item in items {
      switch item {
      case .text(let run):
        output.append(NSAttributedString(string: run.text, attributes: attributes(for: run.styles, base: base, style: style)))
      case .link(let href, let runs, let other):
        linkIdentity += 1
        let box = NoteLinkBox(href: href, other: other, identity: linkIdentity)
        for run in runs {
          var attributes = attributes(for: run.styles, base: base, style: style)
          applyLink(box, to: &attributes)
          output.append(NSAttributedString(string: run.text, attributes: attributes))
        }
      case .mention, .math, .other:
        output.append(atom(item, base: base, style: style))
      }
    }
    return output
  }

  static func plainAttributedString(_ text: String, style: NoteTextStyle) -> NSMutableAttributedString {
    NSMutableAttributedString(string: text, attributes: style.baseAttributes)
  }

  static func applyLink(_ box: NoteLinkBox, to attributes: inout [NSAttributedString.Key: Any]) {
    attributes[.noteLink] = box
    attributes[.foregroundColor] = NoteTheme.link
    attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
    attributes[.underlineColor] = NoteTheme.link.withAlphaComponent(0.4)
    attributes[.cursor] = NSCursor.pointingHand
    attributes[.toolTip] = box.href
  }

  /// Visual attributes for a run's styles on top of the block's base.
  static func attributes(for styles: NoteStyles, base: [NSAttributedString.Key: Any], style: NoteTextStyle) -> [NSAttributedString.Key: Any] {
    var attributes = base
    attributes[.noteStyles] = NoteStylesBox(styles)
    let baseFont = style.font
    var font = baseFont
    if styles.code {
      font = NoteTheme.mono(max(12, baseFont.pointSize * 0.86), styles.bold ? .semibold : .regular)
      attributes[.backgroundColor] = NoteTheme.codeInlineBackground
      if styles.textColor == nil { attributes[.foregroundColor] = NoteTheme.codeInlineText }
    } else if styles.bold || styles.italic {
      if baseFont.familyName == "Outfit" {
        // Outfit has no italic, so italic heading text uses the system italic at the heading's weight.
        font = styles.italic
          ? NoteTheme.ui(baseFont.pointSize, styles.bold ? .bold : .semibold, italic: true)
          : NoteTheme.display(baseFont.pointSize, styles.bold ? .bold : .semibold)
      } else {
        let weight: NSFont.Weight = styles.bold ? (style.strong ? .bold : .semibold) : (style.strong ? .semibold : .regular)
        font = NoteTheme.ui(baseFont.pointSize, weight, italic: styles.italic)
      }
    }
    attributes[.font] = font
    if styles.underline { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if styles.strike {
      attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
    }
    if let color = NoteTheme.textColor(named: styles.textColor) { attributes[.foregroundColor] = color }
    if let color = NoteTheme.backgroundColor(named: styles.backgroundColor) { attributes[.backgroundColor] = color }
    return attributes
  }

  static func atom(_ item: NoteInline, base: [NSAttributedString.Key: Any], style: NoteTextStyle) -> NSAttributedString {
    let attachment = NSTextAttachment()
    let cell = NoteAtomCell(item: item, font: style.font, color: style.color)
    attachment.attachmentCell = cell
    var attributes = base
    attributes[.attachment] = attachment
    attributes[.noteAtom] = NoteAtomBox(item)
    attributes[.noteStyles] = NoteStylesBox(.plain)
    if case .mention = item { attributes[.cursor] = NSCursor.pointingHand }
    return NSAttributedString(string: NoteFind.atom, attributes: attributes)
  }

  /// Re-derives fonts and colors from each run's `.noteStyles`, after styles changed in place.
  static func restyle(_ text: NSMutableAttributedString, range: NSRange? = nil, style: NoteTextStyle) {
    let range = range ?? NSRange(location: 0, length: text.length)
    guard range.length > 0 else { return }
    let base = style.baseAttributes
    text.beginEditing()
    text.enumerateAttributes(in: range) { attrs, subrange, _ in
      if attrs[.noteAtom] != nil { return }
      let styles = (attrs[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
      var next = attributes(for: styles, base: base, style: style)
      if let link = attrs[.noteLink] as? NoteLinkBox { applyLink(link, to: &next) }
      text.setAttributes(next, range: subrange)
    }
    text.endEditing()
  }

  // MARK: From attributed text

  static func inlines(from text: NSAttributedString) -> [NoteInline] {
    var items: [NoteInline] = []
    var currentLink: NoteLinkBox?
    var linkRuns: [NoteTextRun] = []
    func closeLink() {
      if let link = currentLink {
        items.append(.link(href: link.href, runs: mergeRuns(linkRuns), other: link.other))
      }
      currentLink = nil
      linkRuns = []
    }
    let string = text.string as NSString
    text.enumerateAttributes(in: NSRange(location: 0, length: text.length)) { attrs, range, _ in
      if let atom = attrs[.noteAtom] as? NoteAtomBox {
        // One atom per attachment character.
        closeLink()
        for _ in 0..<range.length { items.append(atom.inline) }
        return
      }
      var segment = string.substring(with: range)
      if attrs[.attachment] != nil { segment = segment.replacingOccurrences(of: NoteFind.atom, with: "") }
      guard !segment.isEmpty else { return }
      let styles = (attrs[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
      if let link = attrs[.noteLink] as? NoteLinkBox {
        if let current = currentLink, current != link { closeLink() }
        currentLink = link
        linkRuns.append(NoteTextRun(segment, styles))
      } else {
        closeLink()
        items.append(.text(NoteTextRun(segment, styles)))
      }
    }
    closeLink()
    return NoteMarkdownMerge.merged(items)
  }

  private static func mergeRuns(_ runs: [NoteTextRun]) -> [NoteTextRun] {
    var out: [NoteTextRun] = []
    for run in runs where !run.text.isEmpty {
      if let last = out.last, last.styles == run.styles { out[out.count - 1].text += run.text } else { out.append(run) }
    }
    return out
  }

  /// Imports foreign rich text (pasted RTF or HTML) as inline content: bold, italic, underline,
  /// strikethrough, monospace as code, and links.
  static func inlines(fromForeign text: NSAttributedString) -> [NoteInline] {
    var items: [NoteInline] = []
    let string = text.string as NSString
    var linkItems: [(href: String, run: NoteTextRun)] = []
    func closeLink() {
      guard let href = linkItems.first?.href else { return }
      items.append(.link(href: href, runs: mergeRuns(linkItems.map(\.run)), other: [:]))
      linkItems = []
    }
    text.enumerateAttributes(in: NSRange(location: 0, length: text.length)) { attrs, range, _ in
      let segment = string.substring(with: range).replacingOccurrences(of: NoteFind.atom, with: "")
      guard !segment.isEmpty else { return }
      var styles = NoteStyles()
      if let font = attrs[.font] as? NSFont {
        let traits = font.fontDescriptor.symbolicTraits
        styles.bold = traits.contains(.bold)
        styles.italic = traits.contains(.italic)
        styles.code = traits.contains(.monoSpace)
      }
      if let underline = attrs[.underlineStyle] as? Int, underline != 0, attrs[.link] == nil { styles.underline = true }
      if let strike = attrs[.strikethroughStyle] as? Int, strike != 0 { styles.strike = true }
      let href: String? = (attrs[.link] as? URL)?.absoluteString ?? (attrs[.link] as? String)
      if let href {
        if linkItems.first?.href != href { closeLink() }
        linkItems.append((href, NoteTextRun(segment, styles)))
      } else {
        closeLink()
        items.append(.text(NoteTextRun(segment, styles)))
      }
    }
    closeLink()
    return NoteMarkdownMerge.merged(items)
  }
}

/// Adjacent text with equal styles merges, keeping the format's canonical shape.
enum NoteMarkdownMerge {
  static func merged(_ items: [NoteInline]) -> [NoteInline] { NoteMarkdown.merged(items) }
}

/// Draws an inline atom: a page mention pill, an inline equation, or an unknown inline item.
final class NoteAtomCell: NSTextAttachmentCell {
  let item: NoteInline
  let baseFont: NSFont
  let color: NSColor
  private var mathImage: NSImage?
  private var imageDescent: CGFloat = 0

  init(item: NoteInline, font: NSFont, color: NSColor) {
    self.item = item
    self.baseFont = font
    self.color = color
    super.init(textCell: "")
    if case .math(let latex, _) = item {
      if let rendered = NoteMath.render(latex, fontSize: font.pointSize * 1.05, color: NoteTheme.ink, display: false) {
        mathImage = rendered.image
        imageDescent = rendered.descent
      }
    }
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private var label: String {
    switch item {
    case .mention(_, let title, _): return title.isEmpty ? "Untitled" : title
    case .math(let latex, _): return latex.isEmpty ? "New equation" : latex
    default: return NoteInline.fallbackText(itemValue).isEmpty ? "Inline item" : NoteInline.fallbackText(itemValue)
    }
  }

  private var itemValue: JSONValue {
    if case .other(let value) = item { return value }
    return .null
  }

  private var labelFont: NSFont {
    switch item {
    case .mention: return NoteTheme.ui(baseFont.pointSize * 0.94, .semibold)
    default: return NoteTheme.ui(baseFont.pointSize * 0.9)
    }
  }

  override func cellSize() -> NSSize {
    if let image = mathImage { return NSSize(width: image.size.width + 4, height: image.size.height) }
    let width = (label as NSString).size(withAttributes: [.font: labelFont]).width
    return NSSize(width: ceil(width) + 12, height: ceil(baseFont.ascender - baseFont.descender) + 2)
  }

  override func cellBaselineOffset() -> NSPoint {
    if mathImage != nil { return NSPoint(x: 0, y: -imageDescent) }
    return NSPoint(x: 0, y: baseFont.descender - 1)
  }

  override func draw(withFrame cellFrame: NSRect, in controlView: NSView?) {
    if let image = mathImage {
      image.draw(in: NSRect(x: cellFrame.minX + 2, y: cellFrame.minY, width: image.size.width, height: image.size.height),
                 from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
      return
    }
    let fill: NSColor
    let ink: NSColor
    switch item {
    case .mention: fill = NoteTheme.primaryTint; ink = NoteTheme.primary
    case .math: fill = NoteTheme.surfaceSoft; ink = NoteTheme.error
    default: fill = NoteTheme.surfaceSoft; ink = NoteTheme.inkMuted
    }
    let pill = NSBezierPath(roundedRect: cellFrame.insetBy(dx: 1, dy: 1), xRadius: 5, yRadius: 5)
    fill.setFill()
    pill.fill()
    let attributes: [NSAttributedString.Key: Any] = [.font: labelFont, .foregroundColor: ink]
    let size = (label as NSString).size(withAttributes: attributes)
    (label as NSString).draw(at: NSPoint(x: cellFrame.minX + 6, y: cellFrame.midY - size.height / 2), withAttributes: attributes)
  }

  override func draw(withFrame cellFrame: NSRect, in controlView: NSView?, characterIndex charIndex: Int, layoutManager: NSLayoutManager) {
    draw(withFrame: cellFrame, in: controlView)
  }

  override func wantsToTrackMouse() -> Bool { false }
}

/// LaTeX rendering through SwiftMath, cached by source, size, color, and mode.
enum NoteMath {
  struct Rendered {
    let image: NSImage
    let descent: CGFloat
  }

  private static let cache = NSCache<NSString, RenderedBox>()

  private final class RenderedBox {
    let value: Rendered?
    init(_ value: Rendered?) { self.value = value }
  }

  static func render(_ latex: String, fontSize: CGFloat, color: NSColor, display: Bool) -> Rendered? {
    let trimmed = latex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let resolved = color.usingColorSpace(.sRGB) ?? color
    let key = "\(display)|\(fontSize)|\(resolved.redComponent),\(resolved.greenComponent),\(resolved.blueComponent)|\(trimmed)" as NSString
    if let cached = cache.object(forKey: key) { return cached.value }
    var math = MathImage(latex: trimmed, fontSize: fontSize, textColor: resolved, labelMode: display ? .display : .text, textAlignment: .left)
    let (error, image, info) = math.asImage()
    let value: Rendered? = (error == nil && image != nil) ? Rendered(image: image!, descent: info?.descent ?? 0) : nil
    cache.setObject(RenderedBox(value), forKey: key)
    return value
  }
}
