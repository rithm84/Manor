import AppKit
import ManorKit
import SwiftUI

/// The solution editor: a native TextKit text view with line numbers, syntax colors, auto-indentation, bracket
/// pairing, and Find, editable at once. Language-server completion, hover, signature help, and diagnostics arrive in
/// place when the shared connection is ready.
struct WorkspaceCodeEditor: NSViewRepresentable {
  let model: ProblemWorkspaceModel
  let language: ProblemLanguage
  /// Bumps when the code is replaced from outside the editor.
  let revision: Int
  let fontSize: Int
  let tabSize: Int
  let diagnostics: [LSPDiagnostic]
  @Environment(\.colorScheme) private var colorScheme

  func makeCoordinator() -> WorkspaceEditorCoordinator {
    WorkspaceEditorCoordinator(model: model, language: language)
  }

  func makeNSView(context: Context) -> NSScrollView {
    let coordinator = context.coordinator
    coordinator.revision = revision
    return coordinator.makeView(text: model.code ?? "", fontSize: fontSize, tabSize: tabSize, dark: colorScheme == .dark, diagnostics: diagnostics)
  }

  func updateNSView(_ view: NSScrollView, context: Context) {
    let coordinator = context.coordinator
    if coordinator.revision != revision {
      coordinator.revision = revision
      coordinator.replaceText(model.code ?? "")
    }
    coordinator.configure(fontSize: fontSize, tabSize: tabSize, dark: colorScheme == .dark)
    coordinator.setDiagnostics(diagnostics)
  }

  static func dismantleNSView(_ view: NSScrollView, coordinator: WorkspaceEditorCoordinator) {
    coordinator.saveViewState()
    coordinator.detach()
  }
}

// MARK: Text view

/// The editing behaviors a code editor needs on top of `NSTextView`: indentation, bracket pairing, comment toggling,
/// and the completion list's keys.
final class WorkspaceTextView: NSTextView {
  weak var editor: WorkspaceEditorCoordinator?

  override func insertNewline(_ sender: Any?) {
    if editor?.acceptCompletion() == true { return }
    guard let editor else { return super.insertNewline(sender) }
    editor.newline()
  }

  override func insertTab(_ sender: Any?) {
    if editor?.acceptCompletion() == true { return }
    guard let editor else { return super.insertTab(sender) }
    editor.indent()
  }

  override func insertBacktab(_ sender: Any?) {
    guard let editor else { return super.insertBacktab(sender) }
    editor.outdent()
  }

  override func moveUp(_ sender: Any?) {
    if editor?.moveCompletion(by: -1) == true { return }
    super.moveUp(sender)
  }

  override func moveDown(_ sender: Any?) {
    if editor?.moveCompletion(by: 1) == true { return }
    super.moveDown(sender)
  }

  /// Escape closes whatever is open and otherwise does nothing (NSTextView's default would open completions).
  override func cancelOperation(_ sender: Any?) {
    guard let editor else { return super.cancelOperation(sender) }
    editor.dismissPopups()
  }

  /// Option-Escape (and Control-Space) ask the language server for completions.
  override func complete(_ sender: Any?) {
    if editor?.dismissPopups() == true { return }
    editor?.requestCompletion(trigger: nil, explicit: true)
  }

  override func keyDown(with event: NSEvent) {
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    if flags == .control, event.charactersIgnoringModifiers == " " {
      editor?.requestCompletion(trigger: nil, explicit: true)
      return
    }
    // Option-Up and Option-Down move lines; with Shift they copy them.
    if let editor, event.keyCode == 126 || event.keyCode == 125, flags == .option || flags == [.option, .shift] {
      let up = event.keyCode == 126
      if flags == .option { editor.moveLines(up: up) } else { editor.copyLines(up: up) }
      return
    }
    super.keyDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    if window?.firstResponder === self, flags == .command, event.charactersIgnoringModifiers == "/" {
      editor?.toggleComment()
      return true
    }
    if window?.firstResponder === self, flags == [.command, .shift], event.charactersIgnoringModifiers?.lowercased() == "k" {
      editor?.deleteLines()
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  override func insertText(_ string: Any, replacementRange: NSRange) {
    if let text = string as? String, replacementRange.location == NSNotFound, let editor, editor.typed(text) { return }
    super.insertText(string, replacementRange: replacementRange)
  }

  override func deleteBackward(_ sender: Any?) {
    if editor?.backspace() == true { return }
    super.deleteBackward(sender)
  }

  override func drawBackground(in rect: NSRect) {
    super.drawBackground(in: rect)
    if let editor, let line = editor.currentLineRect(), line.intersects(rect) {
      editor.colors.lineHighlight.setFill()
      line.fill()
    }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    editor?.appearanceChanged()
  }

  override func becomeFirstResponder() -> Bool {
    let became = super.becomeFirstResponder()
    if became { editor?.noteUse() }
    return became
  }
}

/// Line numbers beside the text, with the caret's line in full ink.
final class WorkspaceLineNumbers: NSRulerView {
  weak var textView: WorkspaceTextView?
  var lineStarts: [Int] = [0] { didSet { updateThickness() } }
  var font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular) { didSet { updateThickness() } }
  var colors = WorkspaceEditorColors(dark: false)

  init(textView: WorkspaceTextView, scrollView: NSScrollView) {
    self.textView = textView
    super.init(scrollView: scrollView, orientation: .verticalRuler)
    clientView = textView
    updateThickness()
  }

  required init(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var isFlipped: Bool { true }

  private func updateThickness() {
    let digits = max(2, String(lineStarts.count).count)
    let width = CGFloat(digits) * ("8" as NSString).size(withAttributes: [.font: font]).width + 28
    if abs(ruleThickness - width) > 0.5 { ruleThickness = width }
  }

  override func drawHashMarksAndLabels(in rect: NSRect) {
    colors.background.setFill()
    bounds.fill()
    guard let textView, let layout = textView.layoutManager, let container = textView.textContainer else { return }
    let length = (textView.string as NSString).length
    let visible = textView.visibleRect
    let origin = textView.textContainerOrigin
    let glyphs = layout.glyphRange(forBoundingRect: visible.offsetBy(dx: -origin.x, dy: -origin.y), in: container)
    let characters = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
    let caretLine = Self.line(of: textView.selectedRange().location, in: lineStarts)
    var line = Self.line(of: characters.location, in: lineStarts)
    func draw(_ number: Int, top: CGFloat, height: CGFloat) {
      let label = "\(number)" as NSString
      let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: number - 1 == caretLine ? colors.text : colors.gutter]
      let size = label.size(withAttributes: attributes)
      let y = convert(NSPoint(x: 0, y: top + origin.y), from: textView).y + (height - size.height) / 2
      label.draw(at: NSPoint(x: ruleThickness - size.width - 12, y: y), withAttributes: attributes)
    }
    while line < lineStarts.count, lineStarts[line] <= NSMaxRange(characters) {
      let start = lineStarts[line]
      if start < length {
        let fragment = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: start), effectiveRange: nil)
        if fragment.minY + origin.y > visible.maxY { break }
        draw(line + 1, top: fragment.minY, height: fragment.height)
      } else {
        let extra = layout.extraLineFragmentRect
        if extra.height > 0 { draw(line + 1, top: extra.minY, height: extra.height) } else if length == 0 { draw(1, top: 0, height: font.boundingRectForFont.height * 1.3) }
      }
      line += 1
    }
  }

  static func line(of offset: Int, in starts: [Int]) -> Int {
    var low = 0, high = starts.count - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if starts[middle] <= offset { low = middle } else { high = middle - 1 }
    }
    return low
  }
}

/// The editor's palette resolved for one appearance.
struct WorkspaceEditorColors {
  let text: NSColor
  let gutter: NSColor
  let background: NSColor
  let lineHighlight: NSColor
  let selection: NSColor
  /// The tint on a bracket and its match beside the caret.
  let bracketMatch: NSColor
  let insertion: NSColor
  let syntax: [ProblemSyntax.Kind: NSColor]
  let error: NSColor
  let warning: NSColor
  let information: NSColor

  init(dark: Bool) {
    func resolve(_ value: Color) -> NSColor {
      var resolved = NSColor(value)
      NSAppearance(named: dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
        resolved = NSColor(value).usingColorSpace(.sRGB) ?? NSColor(value)
      }
      return resolved
    }
    text = resolve(Palette.ink)
    gutter = resolve(Palette.inkMuted).withAlphaComponent(0.7)
    background = resolve(Palette.surfaceCanvas)
    lineHighlight = resolve(Palette.surfacePaper)
    selection = resolve(Palette.selection)
    bracketMatch = resolve(Palette.selection).withAlphaComponent(0.55)
    insertion = resolve(Palette.primary)
    var syntax: [ProblemSyntax.Kind: NSColor] = [:]
    for kind in [ProblemSyntax.Kind.keyword, .type, .function, .string, .number, .comment, .attribute, .constant] {
      syntax[kind] = resolve(WorkspaceCodeColorizer.color(kind))
    }
    self.syntax = syntax
    error = resolve(Palette.overdueError)
    warning = resolve(Palette.warning)
    information = resolve(Palette.frozenInfo)
  }
}

// MARK: Coordinator

/// Connects one editor to its language server and implements the editor's behaviors.
@MainActor
final class WorkspaceEditorCoordinator: NSObject, NSTextViewDelegate, NSTextStorageDelegate {
  let model: ProblemWorkspaceModel
  let language: ProblemLanguage
  var revision = 0
  private(set) var textView: WorkspaceTextView!
  private(set) var scrollView: NSScrollView!
  private var ruler: WorkspaceLineNumbers!
  private(set) var colors = WorkspaceEditorColors(dark: false)
  private var fontSize = 14
  private var tabSize = 4
  private var dark = false
  private var diagnostics: [LSPDiagnostic] = []
  private var highlighter: ProblemSyntaxHighlighter
  /// False while a long text is lexed off the main thread; edits then wait for that pass instead of re-lexing.
  private var highlightReady = false
  private var highlightGeneration = 0
  private var syncTask: Task<Void, Never>?
  private var lastEdit: (range: NSRange, text: String)?
  /// Offsets of closing brackets and quotes the editor inserted itself, which typing steps over and Backspace removes
  /// with their opener. Kept in step with every edit; forgotten once the caret leaves.
  private var autoClosed: Set<Int> = []
  /// The bracket pair highlighted beside the caret.
  private var bracketHighlight: [NSRange] = []
  private var hover: WorkspaceHover?
  private var signature: WorkspaceSignatureHelp?
  private let completion = WorkspaceCompletion()

  init(model: ProblemWorkspaceModel, language: ProblemLanguage) {
    self.model = model
    self.language = language
    highlighter = ProblemSyntaxHighlighter(language: language)
    super.init()
  }

  private var servers: ProblemLanguageServers { model.services.languageServers }
  private var problemId: String { model.detail?.problem.id ?? model.problemId }
  var text: String { textView?.string ?? "" }
  private var font: NSFont { NSFont.monospacedSystemFont(ofSize: CGFloat(fontSize), weight: .regular) }
  var triggerCharacters: Set<String> { servers.connection(language)?.triggerCharacters ?? [".", ":", ">"] }

  func session(bound: Bool) -> ProblemLanguageServers.SessionSource {
    let sessions = model.services.editorSessions
    let language = language
    let problemId = bound ? problemId : nil
    return { try await sessions.session(language, problemId: problemId) }
  }

  // MARK: Setup

  func makeView(text: String, fontSize: Int, tabSize: Int, dark: Bool, diagnostics: [LSPDiagnostic]) -> NSScrollView {
    self.fontSize = fontSize
    self.tabSize = tabSize
    self.dark = dark
    self.diagnostics = diagnostics

    let storage = NSTextStorage(string: text)
    storage.delegate = self
    let layout = NSLayoutManager()
    layout.allowsNonContiguousLayout = true
    storage.addLayoutManager(layout)
    let container = NSTextContainer(size: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
    container.widthTracksTextView = false
    container.lineFragmentPadding = 0
    layout.addTextContainer(container)

    let textView = WorkspaceTextView(frame: .zero, textContainer: container)
    textView.editor = self
    textView.isRichText = false
    textView.importsGraphics = false
    textView.allowsUndo = true
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.isAutomaticTextReplacementEnabled = false
    textView.isAutomaticSpellingCorrectionEnabled = false
    textView.isContinuousSpellCheckingEnabled = false
    textView.isGrammarCheckingEnabled = false
    textView.isAutomaticLinkDetectionEnabled = false
    textView.smartInsertDeleteEnabled = false
    textView.usesFindBar = true
    textView.isIncrementalSearchingEnabled = true
    textView.isHorizontallyResizable = true
    textView.isVerticallyResizable = true
    textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    textView.minSize = .zero
    textView.autoresizingMask = [.width]
    textView.textContainerInset = NSSize(width: 12, height: 12)
    textView.setAccessibilityLabel("Problem solution code")
    textView.delegate = self
    self.textView = textView

    let scrollView = NSScrollView()
    scrollView.documentView = textView
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = true
    scrollView.autohidesScrollers = true
    scrollView.drawsBackground = true
    scrollView.borderType = .noBorder
    self.scrollView = scrollView

    let ruler = WorkspaceLineNumbers(textView: textView, scrollView: scrollView)
    scrollView.verticalRulerView = ruler
    scrollView.hasVerticalRuler = true
    scrollView.rulersVisible = true
    // Views no longer clip by default; without this the ruler's edge line runs up through the toolbar and header.
    ruler.clipsToBounds = true
    scrollView.clipsToBounds = true
    self.ruler = ruler
    scrollView.contentView.postsBoundsChangedNotifications = true
    NotificationCenter.default.addObserver(self, selector: #selector(scrolled), name: NSView.boundsDidChangeNotification, object: scrollView.contentView)

    applyAppearance()
    rehighlightAll()

    servers.attachDocument(language) { [weak self] in self?.text }
    // Connecting reuses any recent session, such as a prewarmed one; binding the open problem to the lease follows
    // it, so a slow renewal never delays the editor or its language server.
    let connecting = servers.connect(language, session: session(bound: false))
    let bound = session(bound: true)
    Task { _ = try? await connecting.value; _ = try? await bound() }
    let hover = WorkspaceHover(coordinator: self)
    hover.install(on: textView)
    self.hover = hover
    signature = WorkspaceSignatureHelp(coordinator: self)
    restoreViewState()
    return scrollView
  }

  func configure(fontSize: Int, tabSize: Int, dark: Bool) {
    guard fontSize != self.fontSize || tabSize != self.tabSize || dark != self.dark else { return }
    self.fontSize = fontSize
    self.tabSize = tabSize
    self.dark = dark
    applyAppearance()
    rehighlightAll()
  }

  func appearanceChanged() {
    let isDark = textView.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    guard isDark != dark else { return }
    dark = isDark
    applyAppearance()
    rehighlightAll()
  }

  private var paragraph: NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.lineHeightMultiple = 1.3
    style.tabStops = []
    style.defaultTabInterval = CGFloat(tabSize) * (" " as NSString).size(withAttributes: [.font: font]).width
    return style
  }

  private var baseAttributes: [NSAttributedString.Key: Any] {
    [.font: font, .foregroundColor: colors.text, .paragraphStyle: paragraph]
  }

  private func applyAppearance() {
    colors = WorkspaceEditorColors(dark: dark)
    textView.font = font
    textView.backgroundColor = colors.background
    textView.insertionPointColor = colors.insertion
    textView.selectedTextAttributes = [.backgroundColor: colors.selection]
    textView.typingAttributes = baseAttributes
    textView.defaultParagraphStyle = paragraph
    scrollView.backgroundColor = colors.background
    ruler.colors = colors
    ruler.font = NSFont.monospacedDigitSystemFont(ofSize: max(12, CGFloat(fontSize) - 2), weight: .regular)
    ruler.needsDisplay = true
    textView.needsDisplay = true
  }

  func detach() {
    NotificationCenter.default.removeObserver(self)
    hover?.uninstall()
    signature?.close()
    completion.hide()
    highlightGeneration += 1
    syncTask?.cancel()
    servers.attachDocument(language, text: nil)
  }

  @objc private func scrolled() {
    ruler?.needsDisplay = true
    hover?.close()
    completion.hide()
  }

  // MARK: Highlighting and diagnostics

  /// Texts up to this many UTF-16 units are lexed on the main thread in one pass (well under a frame); longer ones
  /// are lexed in the background and painted when ready.
  private static let synchronousLexLimit = 60_000

  /// Lexes the whole text again, as on open or when the theme changes.
  private func rehighlightAll() {
    guard let storage = textView.textStorage else { return }
    highlightGeneration += 1
    let units = Array(storage.string.utf16)
    if units.count <= Self.synchronousLexLimit {
      let tokens = highlighter.reset(units: units)
      highlightReady = true
      paint(NSRange(location: 0, length: storage.length), tokens: tokens, standalone: true)
      applyDiagnostics()
      return
    }
    highlightReady = false
    let generation = highlightGeneration
    let language = language
    Task { [weak self] in
      let lexed = await Task.detached(priority: .userInitiated) { () -> (ProblemSyntaxHighlighter, [ProblemSyntax.Token]) in
        let fresh = ProblemSyntaxHighlighter(language: language)
        return (fresh, fresh.reset(units: units))
      }.value
      guard let self, self.highlightGeneration == generation, let storage = self.textView?.textStorage else { return }
      self.highlighter = lexed.0
      self.highlightReady = true
      self.paint(NSRange(location: 0, length: storage.length), tokens: lexed.1, standalone: true)
      self.applyDiagnostics()
    }
  }

  /// Resets a range to plain text and colors its tokens. Inside `processEditing` the storage is already editing.
  private func paint(_ range: NSRange, tokens: [ProblemSyntax.Token], standalone: Bool) {
    guard let storage = textView.textStorage else { return }
    let length = storage.length
    let range = NSIntersectionRange(range, NSRange(location: 0, length: length))
    if standalone { storage.beginEditing() }
    storage.setAttributes(baseAttributes, range: range)
    for token in tokens where NSMaxRange(token.range) <= length {
      if let color = colors.syntax[token.kind] { storage.addAttribute(.foregroundColor, value: color, range: token.range) }
    }
    if standalone { storage.endEditing() }
    ruler?.lineStarts = highlighter.lineStarts
    ruler?.needsDisplay = true
  }

  /// Re-lexes only what an edit touched: the edited lines, and further lines only while their starting state
  /// (inside a comment or a multi-line string) changed.
  nonisolated func textStorage(_ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions, range editedRange: NSRange, changeInLength delta: Int) {
    guard editedMask.contains(.editedCharacters) else { return }
    MainActor.assumeIsolated {
      guard highlightReady else {
        // A background pass is still running on an older text; start over on this one.
        rehighlightAll()
        return
      }
      if editedRange.length > Self.synchronousLexLimit { rehighlightAll(); return }
      let units = Array(textStorage.string.utf16)
      let replaced = NSRange(location: editedRange.location, length: editedRange.length - delta)
      let result = highlighter.edit(units: units, replaced: replaced, insertedLength: editedRange.length)
      paint(result.range, tokens: result.tokens, standalone: false)
    }
  }

  /// Dotted underlines for the server's errors, warnings, and notes; hints stay unmarked.
  private func applyDiagnostics() {
    guard let storage = textView.textStorage else { return }
    let length = storage.length
    let full = NSRange(location: 0, length: length)
    storage.beginEditing()
    storage.removeAttribute(.underlineStyle, range: full)
    storage.removeAttribute(.underlineColor, range: full)
    if !diagnostics.isEmpty {
      let index = LSPLineIndex(storage.string)
      for diagnostic in diagnostics where diagnostic.severity != .hint {
        var range = index.range(of: diagnostic.range)
        if range.length == 0, length > 0 { range = NSRange(location: min(range.location, length - 1), length: 1) }
        guard range.length > 0, NSMaxRange(range) <= length else { continue }
        let color = diagnostic.severity == .error ? colors.error : diagnostic.severity == .warning ? colors.warning : colors.information
        storage.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue, .underlineColor: color], range: range)
      }
    }
    storage.endEditing()
  }

  func setDiagnostics(_ next: [LSPDiagnostic]) {
    guard next != diagnostics else { return }
    diagnostics = next
    applyDiagnostics()
  }

  func diagnostics(at offset: Int) -> [LSPDiagnostic] {
    let index = LSPLineIndex(text)
    return diagnostics.filter { diagnostic in
      guard diagnostic.severity != .hint else { return false }
      let range = index.range(of: diagnostic.range)
      return offset >= range.location && offset <= max(NSMaxRange(range), range.location + 1)
    }
  }

  // MARK: Text and view state

  func replaceText(_ value: String) {
    guard textView.string != value else { return }
    completion.hide()
    textView.string = value
    textView.undoManager?.removeAllActions()
    scheduleSync()
  }

  func saveViewState() {
    guard textView != nil else { return }
    model.editorViewStates[language] = WorkspaceEditorViewState(selection: textView.selectedRange(), scroll: scrollView.contentView.bounds.origin)
  }

  private func restoreViewState() {
    let state = model.editorViewStates[language]
    DispatchQueue.main.async { [weak self] in
      guard let self, let textView = self.textView else { return }
      if let state {
        let length = (textView.string as NSString).length
        let location = min(state.selection.location, length)
        textView.setSelectedRange(NSRange(location: location, length: min(state.selection.length, length - location)))
        self.scrollView.contentView.scroll(to: state.scroll)
        self.scrollView.reflectScrolledClipView(self.scrollView.contentView)
      }
      textView.window?.makeFirstResponder(textView)
    }
  }

  func currentLineRect() -> NSRect? {
    guard let textView, textView.selectedRange().length == 0, let layout = textView.layoutManager else { return nil }
    let location = textView.selectedRange().location
    let length = (textView.string as NSString).length
    let fragment: NSRect
    if location >= length, layout.extraLineFragmentRect.height > 0 {
      fragment = layout.extraLineFragmentRect
    } else if length > 0 {
      fragment = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: min(location, length - 1)), effectiveRange: nil)
    } else {
      return nil
    }
    return NSRect(x: 0, y: fragment.minY + textView.textContainerOrigin.y, width: max(textView.bounds.width, scrollView.contentView.bounds.width), height: fragment.height)
  }

  /// The view rectangle of a character range.
  func rect(for range: NSRange) -> NSRect? {
    guard let layout = textView.layoutManager, let container = textView.textContainer else { return nil }
    let length = (textView.string as NSString).length
    if range.location >= length, range.length == 0 {
      let extra = layout.extraLineFragmentRect
      if extra.height > 0 { return NSRect(x: extra.minX, y: extra.minY, width: 1, height: extra.height).offsetBy(dx: textView.textContainerOrigin.x, dy: textView.textContainerOrigin.y) }
    }
    // A caret before a character uses that character's box, so a word at the start of a line anchors on its own
    // line rather than at the end of the previous one.
    let probe = range.length == 0 && range.location < length ? NSRange(location: range.location, length: 1) : range
    let glyphs = layout.glyphRange(forCharacterRange: probe, actualCharacterRange: nil)
    var rect = layout.boundingRect(forGlyphRange: glyphs.length == 0 ? NSRange(location: max(0, glyphs.location - 1), length: min(1, layout.numberOfGlyphs)) : glyphs, in: container)
    if range.length == 0 {
      rect.origin.x = glyphs.length == 0 && glyphs.location > 0 ? rect.maxX : rect.minX
      rect.size.width = 1
    }
    return rect.offsetBy(dx: textView.textContainerOrigin.x, dy: textView.textContainerOrigin.y)
  }

  /// The character under a point in the text view, or nil past a line's end.
  func offset(at point: NSPoint) -> Int? {
    guard let layout = textView.layoutManager, let container = textView.textContainer, layout.numberOfGlyphs > 0 else { return nil }
    let origin = textView.textContainerOrigin
    let local = NSPoint(x: point.x - origin.x, y: point.y - origin.y)
    var fraction: CGFloat = 0
    let glyph = layout.glyphIndex(for: local, in: container, fractionOfDistanceThroughGlyph: &fraction)
    let bounds = layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
    guard bounds.insetBy(dx: -2, dy: 0).contains(local) else { return nil }
    return layout.characterIndexForGlyph(at: glyph)
  }

  // MARK: NSTextViewDelegate

  func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
    lastEdit = (affectedCharRange, replacementString ?? "")
    let delta = ((replacementString ?? "") as NSString).length - affectedCharRange.length
    autoClosed = Set(autoClosed.compactMap { offset in
      if offset >= NSMaxRange(affectedCharRange) { return offset + delta }
      return offset < affectedCharRange.location ? offset : nil
    })
    return true
  }

  func textDidChange(_ notification: Notification) {
    model.edited(textView.string)
    hover?.close()
    scheduleSync()
    noteUse()
    completionAfterEdit()
    signature?.textChanged()
    lastEdit = nil
  }

  func textViewDidChangeSelection(_ notification: Notification) {
    textView.needsDisplay = true
    ruler?.needsDisplay = true
    noteUse()
    let selection = textView.selectedRange()
    // The list belongs to the word being typed; leaving it (an arrow key, a click, stepping over a closer) closes it,
    // so Return or Tab can't replace text the list no longer refers to.
    if completion.isVisible, let start = completion.wordStart {
      if selection.location < start || selection.length > 0
        || Self.wordStart(in: text as NSString, before: selection.location) != start { completion.hide() }
    }
    // Auto-inserted closers count only while the caret stays on their line, before them.
    if !autoClosed.isEmpty {
      let source = text as NSString
      let line = source.lineRange(for: NSRange(location: selection.location, length: 0))
      autoClosed = autoClosed.filter { $0 >= selection.location && NSLocationInRange($0, line) }
    }
    highlightMatchingBracket()
    signature?.selectionChanged()
    #if DEBUG
    if ProcessInfo.processInfo.environment["MANOR_QA_HOVER"] != nil, textView.selectedRange().length == 0 {
      hover?.qaShow(at: textView.selectedRange().location)
    }
    #endif
  }

  func noteUse() { servers.noteUse(language, session: session(bound: true)) }

  // MARK: Language server

  /// Sends the document a moment after typing stops; requests send it at once first.
  private func scheduleSync() {
    syncTask?.cancel()
    syncTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(120))
      guard !Task.isCancelled else { return }
      await self?.syncNow()
    }
  }

  @discardableResult
  func syncNow() async -> LanguageServerConnection? {
    guard textView != nil, let connection = servers.connection(language) else { return nil }
    syncTask?.cancel()
    do { try await connection.sync(text: text); return connection } catch { return nil }
  }

  func position(of offset: Int) -> LSPPosition { LSPLineIndex(text).position(of: offset) }

  // MARK: Completion

  nonisolated static func isIdentifier(_ unit: UInt16) -> Bool {
    (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || (unit >= 48 && unit <= 57) || unit == 95 || unit == 36 || unit > 127
  }

  nonisolated static func wordStart(in text: NSString, before offset: Int) -> Int {
    var start = min(offset, text.length)
    while start > 0, isIdentifier(text.character(at: start - 1)) { start -= 1 }
    return start
  }

  nonisolated static func wordEnd(in text: NSString, after offset: Int) -> Int {
    var end = offset
    while end < text.length, isIdentifier(text.character(at: end)) { end += 1 }
    return end
  }

  private func completionAfterEdit() {
    guard let edit = lastEdit else { completion.hide(); return }
    let source = text as NSString
    let caret = textView.selectedRange().location
    if edit.text.isEmpty {
      // Deleting inside the word keeps the list and refilters it.
      if completion.isVisible, let start = completion.wordStart, caret > start, refilter() { return }
      completion.hide()
      return
    }
    guard (edit.text as NSString).length == 1 else { completion.hide(); return }
    // Like other code editors, typing in a string or comment (notes in a docstring) suggests nothing; asking for
    // suggestions with the shortcut still works there.
    if CodeIndentation.isInsideStringOrComment(source.substring(to: caret), language: language) { completion.hide(); return }
    let unit = (edit.text as NSString).character(at: 0)
    if Self.isIdentifier(unit) {
      if completion.isVisible, let start = completion.wordStart, Self.wordStart(in: source, before: caret) == start, refilter() { return }
      // A number on its own never opens the list.
      if unit >= 48 && unit <= 57, Self.wordStart(in: source, before: caret) == caret - 1 { return }
      requestCompletion(trigger: nil, explicit: false)
    } else if triggerCharacters.contains(edit.text) {
      requestCompletion(trigger: edit.text, explicit: false)
    } else {
      completion.hide()
    }
  }

  /// Asks the language server for completions at the caret, or offers keywords and document words without one.
  func requestCompletion(trigger: String?, explicit: Bool) {
    let source = text as NSString
    let caret = textView.selectedRange().location
    let start = Self.wordStart(in: source, before: caret)
    if start == caret, trigger == nil, !explicit { completion.hide(); return }
    completion.request?.cancel()
    completion.request = Task { [weak self] in
      guard let self else { return }
      var items: [LSPCompletionItem] = []
      if let connection = await self.syncNow() {
        items = (try? await connection.completion(at: self.position(of: caret), trigger: trigger))?.items ?? []
      }
      guard !Task.isCancelled, self.textView.selectedRange().location >= start else { return }
      if items.isEmpty, trigger == nil {
        items = WorkspaceFallbackCompletions.items(language: self.language, text: self.text, excluding: NSRange(location: start, length: caret - start))
      }
      self.completion.items = items
      self.completion.wordStart = start
      if !self.refilter() { self.completion.hide() }
    }
  }

  /// Filters the held items by the word typed so far and shows or moves the list. False when nothing matches.
  @discardableResult
  private func refilter() -> Bool {
    guard let start = completion.wordStart else { return false }
    let source = text as NSString
    let caret = textView.selectedRange().location
    guard caret >= start, caret <= source.length else { return false }
    let prefix = source.substring(with: NSRange(location: start, length: caret - start))
    let filtered = WorkspaceCompletion.filter(completion.items, prefix: prefix)
    guard !filtered.isEmpty, let anchor = rect(for: NSRange(location: start, length: 0)), let window = textView.window else { return false }
    // A single exact match the user already typed adds nothing.
    if filtered.count == 1, filtered[0].insertText == prefix { return false }
    completion.show(filtered, anchor: textView.convert(anchor, to: nil), in: window, font: font) { [weak self] item in self?.apply(item) }
    return true
  }

  func moveCompletion(by step: Int) -> Bool {
    guard completion.isVisible else { return false }
    completion.move(by: step)
    return true
  }

  func acceptCompletion() -> Bool {
    guard completion.isVisible, let item = completion.selectedItem else { return false }
    apply(item)
    return true
  }

  @discardableResult
  func dismissPopups() -> Bool {
    let visible = completion.isVisible || signature?.isVisible == true || hover?.isVisible == true
    completion.hide()
    signature?.close()
    hover?.close()
    return visible
  }

  private func apply(_ item: LSPCompletionItem) {
    guard let start = completion.wordStart else { return }
    completion.hide()
    let index = LSPLineIndex(text)
    let caret = textView.selectedRange().location
    var main = NSRange(location: start, length: max(0, caret - start))
    if let edit = item.edit {
      let range = index.range(of: edit)
      main = NSRange(location: range.location, length: max(NSMaxRange(range), caret) - range.location)
    }
    var edits: [(range: NSRange, text: String, main: Bool)] = [(main, item.insertText, true)]
    for extra in item.additionalEdits {
      let range = index.range(of: extra.range)
      if NSIntersectionRange(range, main).length == 0, range.location != main.location { edits.append((range, extra.newText, false)) }
    }
    edits.sort { $0.range.location > $1.range.location }
    var shift = 0
    for edit in edits where !edit.main && edit.range.location < main.location { shift += (edit.text as NSString).length - edit.range.length }
    textView.undoManager?.beginUndoGrouping()
    for edit in edits where textView.shouldChangeText(in: edit.range, replacementString: edit.text) {
      textView.textStorage?.replaceCharacters(in: edit.range, with: edit.text)
      textView.didChangeText()
    }
    textView.undoManager?.endUndoGrouping()
    let caretOffset = main.location + shift + (item.caretOffset ?? (item.insertText as NSString).length)
    textView.setSelectedRange(NSRange(location: min(caretOffset, (text as NSString).length), length: 0))
    completion.hide()
    if item.insertText.hasSuffix("(") || item.insertText.hasSuffix("()") || item.caretOffset != nil { signature?.request(trigger: "(") }
  }

  // MARK: Editing behaviors

  private func insert(_ value: String, replacing range: NSRange, caret: Int? = nil) {
    guard textView.shouldChangeText(in: range, replacementString: value) else { return }
    textView.textStorage?.replaceCharacters(in: range, with: value)
    textView.didChangeText()
    textView.setSelectedRange(NSRange(location: range.location + (caret ?? (value as NSString).length), length: 0))
    textView.scrollRangeToVisible(textView.selectedRange())
  }

  private var editing: CodeEditing { CodeEditing(language: language, tabSize: tabSize) }

  /// Applies one rule's edit as its own undo step.
  private func perform(_ edit: CodeEdit, undoStep: Bool = true) {
    if undoStep { textView.breakUndoCoalescing() }
    if edit.range.length > 0 || !edit.text.isEmpty {
      guard textView.shouldChangeText(in: edit.range, replacementString: edit.text) else { return }
      textView.textStorage?.replaceCharacters(in: edit.range, with: edit.text)
      textView.didChangeText()
    }
    textView.setSelectedRange(edit.selection)
    textView.scrollRangeToVisible(edit.selection)
  }

  /// Return: indentation, bracket splitting, and comment continuation by the editor's rules.
  func newline() {
    perform(editing.newline(in: text as NSString, selection: textView.selectedRange()))
  }

  func indent() { perform(editing.indent(in: text as NSString, selection: textView.selectedRange())) }

  func outdent() { perform(editing.outdent(in: text as NSString, selection: textView.selectedRange())) }

  func toggleComment() { perform(editing.toggleComment(in: text as NSString, selection: textView.selectedRange())) }

  func moveLines(up: Bool) {
    completion.hide()
    if let edit = editing.moveLines(in: text as NSString, selection: textView.selectedRange(), up: up) { perform(edit) }
  }

  func copyLines(up: Bool) {
    completion.hide()
    perform(editing.copyLines(in: text as NSString, selection: textView.selectedRange(), up: up))
  }

  func deleteLines() {
    completion.hide()
    perform(editing.deleteLines(in: text as NSString, selection: textView.selectedRange()))
  }

  /// A typed character: pairing, stepping over a closer, wrapping a selection, or re-indenting a closer line.
  /// False lets the text view insert it as usual.
  func typed(_ value: String) -> Bool {
    guard (value as NSString).length == 1,
          let result = editing.type(value, in: text as NSString, selection: textView.selectedRange(), autoClosed: autoClosed) else { return false }
    let stepping = result.edit.range.length == 0 && result.edit.text.isEmpty
    if stepping {
      autoClosed.remove(textView.selectedRange().location)
      completion.hide()
    }
    perform(result.edit, undoStep: false)
    if let closer = result.autoCloser { autoClosed.insert(closer) }
    return true
  }

  /// Backspace: an auto-inserted pair together, or leading spaces back to the previous tab stop.
  func backspace() -> Bool {
    guard let edit = editing.backspace(in: text as NSString, selection: textView.selectedRange(), autoClosed: autoClosed) else { return false }
    perform(edit, undoStep: false)
    return true
  }

  /// Tints the bracket beside the caret and its match, as code editors do.
  private func highlightMatchingBracket() {
    guard let layout = textView.layoutManager else { return }
    for range in bracketHighlight where NSMaxRange(range) <= (text as NSString).length {
      layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: range)
    }
    bracketHighlight = []
    let selection = textView.selectedRange()
    let source = text as NSString
    guard selection.length == 0, source.length < 200_000 else { return }
    let units = Array(text.utf16)
    let caret = selection.location
    for offset in [caret - 1, caret] where offset >= 0 && offset < units.count {
      if let match = CodeIndentation.matchingBracket(units, at: offset, language: language) {
        bracketHighlight = [NSRange(location: offset, length: 1), NSRange(location: match, length: 1)]
        for range in bracketHighlight {
          layout.addTemporaryAttribute(.backgroundColor, value: colors.bracketMatch, forCharacterRange: range)
        }
        return
      }
    }
  }
}

// MARK: Completion list

/// The completion list: a borderless panel under the word being typed that never takes focus from the editor.
@MainActor
final class WorkspaceCompletion {
  @MainActor @Observable final class State {
    var items: [LSPCompletionItem] = []
    var selected = 0
    var font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
  }

  var items: [LSPCompletionItem] = []
  var wordStart: Int?
  var request: Task<Void, Never>?
  private let state = State()
  private var panel: NSPanel?
  private var onPick: ((LSPCompletionItem) -> Void)?

  var isVisible: Bool { panel?.isVisible == true }
  var selectedItem: LSPCompletionItem? { state.items.indices.contains(state.selected) ? state.items[state.selected] : nil }

  /// Prefix matches first (exact case before any case), then subsequence matches; preselected items lead.
  static func filter(_ items: [LSPCompletionItem], prefix: String) -> [LSPCompletionItem] {
    let lower = prefix.lowercased()
    var scored: [(rank: Int, item: LSPCompletionItem)] = []
    for item in items {
      let candidate = item.filterText
      let rank: Int
      if prefix.isEmpty { rank = 1 } else if candidate.hasPrefix(prefix) { rank = 0 } else if candidate.lowercased().hasPrefix(lower) { rank = 1 } else if isSubsequence(lower, of: candidate.lowercased()) { rank = 2 } else { continue }
      scored.append((item.preselect ? -1 : rank, item))
    }
    scored.sort { $0.rank != $1.rank ? $0.rank < $1.rank : $0.item.sortText < $1.item.sortText }
    return scored.prefix(200).map(\.item)
  }

  private static func isSubsequence(_ needle: String, of haystack: String) -> Bool {
    var iterator = haystack.makeIterator()
    for character in needle {
      var found = false
      while let next = iterator.next() { if next == character { found = true; break } }
      if !found { return false }
    }
    return true
  }

  func show(_ filtered: [LSPCompletionItem], anchor: NSRect, in window: NSWindow, font: NSFont, onPick: @escaping (LSPCompletionItem) -> Void) {
    let keep = isVisible ? selectedItem?.label : nil
    state.items = filtered
    state.selected = filtered.firstIndex { $0.label == keep } ?? 0
    state.font = font
    self.onPick = onPick
    let panel = self.panel ?? makePanel()
    self.panel = panel
    let rows = min(filtered.count, 8)
    let documented = filtered.contains { $0.documentation != nil || $0.detail != nil }
    let size = NSSize(width: 440, height: CGFloat(rows) * 26 + 8 + (documented ? 64 : 0))
    let screenAnchor = window.convertToScreen(anchor)
    var origin = NSPoint(x: screenAnchor.minX - 30, y: screenAnchor.minY - size.height - 4)
    if let visible = window.screen?.visibleFrame {
      if origin.y < visible.minY { origin.y = screenAnchor.maxY + 4 }
      origin.x = min(max(visible.minX, origin.x), visible.maxX - size.width)
    }
    panel.setFrame(NSRect(origin: origin, size: size), display: true)
    if panel.parent !== window {
      panel.parent?.removeChildWindow(panel)
      window.addChildWindow(panel, ordered: .above)
    }
    panel.orderFront(nil)
  }

  func move(by step: Int) {
    guard !state.items.isEmpty else { return }
    state.selected = (state.selected + step + state.items.count) % state.items.count
  }

  func hide() {
    request?.cancel()
    request = nil
    wordStart = nil
    guard let panel, panel.isVisible else { return }
    panel.parent?.removeChildWindow(panel)
    panel.orderOut(nil)
  }

  private func makePanel() -> NSPanel {
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 220), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isFloatingPanel = true
    panel.becomesKeyOnlyIfNeeded = true
    panel.hidesOnDeactivate = true
    panel.hasShadow = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    let host = NSHostingView(rootView: WorkspaceCompletionList(state: state) { [weak self] index in
      guard let self, self.state.items.indices.contains(index) else { return }
      self.state.selected = index
      if let item = self.selectedItem { self.onPick?(item) }
    })
    // The panel's frame is set by hand; the list never resizes the window (that pair can fight in a layout loop).
    host.sizingOptions = []
    panel.contentView = host
    return panel
  }
}

private struct WorkspaceCompletionList: View {
  let state: WorkspaceCompletion.State
  let pick: (Int) -> Void

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 0) {
            ForEach(Array(state.items.enumerated()), id: \.offset) { index, item in
              row(item, selected: index == state.selected)
                .id(index)
                .contentShape(Rectangle())
                .onTapGesture { pick(index) }
            }
          }
          .padding(4)
        }
        .scrollIndicators(.never)
        .onChange(of: state.selected) { _, selected in proxy.scrollTo(selected) }
      }
      if state.items.indices.contains(state.selected), state.items[state.selected].detail != nil || state.items[state.selected].documentation != nil {
        let item = state.items[state.selected]
        Hairline()
        VStack(alignment: .leading, spacing: 2) {
          if let detail = item.detail { Text(detail).font(.code(Typography.Size.xs)).foregroundStyle(Palette.inkBody).lineLimit(1) }
          if let documentation = item.documentation {
            Text(WorkspaceMarkdownParser.inline(documentation)).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(2)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
        .padding(.horizontal, Space.s3)
        .padding(.vertical, Space.s2)
      }
    }
    .background(Palette.surfaceCard, in: RoundedRectangle(cornerRadius: Radius.control))
    .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.hairlineStrong))
    .clipShape(RoundedRectangle(cornerRadius: Radius.control))
  }

  private func row(_ item: LSPCompletionItem, selected: Bool) -> some View {
    HStack(spacing: Space.s2) {
      Image(systemName: WorkspaceCompletionIcon.symbol(item.kind))
        .font(.system(size: 12))
        .foregroundStyle(WorkspaceCompletionIcon.color(item.kind))
        .frame(width: 16)
      Text(item.label)
        .font(Font(state.font))
        .foregroundStyle(item.deprecated ? Palette.inkMuted : Palette.ink)
        .strikethrough(item.deprecated)
        .lineLimit(1)
      Spacer(minLength: Space.s2)
      if let detail = item.detail {
        Text(detail).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1).truncationMode(.tail)
          .frame(maxWidth: 180, alignment: .trailing)
      }
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 26)
    .background(selected ? Palette.surfaceSelected : .clear, in: RoundedRectangle(cornerRadius: Radius.chip))
  }
}

enum WorkspaceCompletionIcon {
  static func symbol(_ kind: LSPCompletionKind?) -> String {
    switch kind {
    case .method, .function, .constructor: return "function"
    case .field, .property: return "square.grid.2x2"
    case .variable, .value, .constant, .enumMember: return "x.squareroot"
    case .class, .struct, .interface, .enum, .typeParameter: return "cube"
    case .module, .folder, .file, .reference: return "shippingbox"
    case .keyword, .operator: return "textformat"
    case .snippet: return "curlybraces"
    default: return "text.alignleft"
    }
  }

  static func color(_ kind: LSPCompletionKind?) -> Color {
    switch kind {
    case .method, .function, .constructor: return Palette.primary
    case .field, .property, .variable, .value, .constant, .enumMember: return Palette.secondary
    case .class, .struct, .interface, .enum, .typeParameter: return Palette.frozenInfo
    default: return Palette.inkMuted
    }
  }
}

/// Keywords and words already in the document, offered when the language server has nothing, so the editor
/// completes before it connects.
enum WorkspaceFallbackCompletions {
  static func items(language: ProblemLanguage, text: String, excluding typed: NSRange) -> [LSPCompletionItem] {
    var seen = Set<String>()
    var items: [LSPCompletionItem] = []
    func add(_ word: String, kind: LSPCompletionKind, sort: String) {
      guard seen.insert(word).inserted else { return }
      items.append(LSPCompletionItem(id: items.count, label: word, kind: kind, detail: nil, documentation: nil, insertText: word, caretOffset: nil, edit: nil, filterText: word, sortText: sort + word, preselect: false, deprecated: false, additionalEdits: []))
    }
    for word in ProblemSyntax.words(language) { add(word, kind: .keyword, sort: "1") }
    let source = text as NSString
    let typedWord = typed.length > 0 && NSMaxRange(typed) <= source.length ? source.substring(with: typed) : ""
    let units = Array(text.utf16)
    var start: Int?
    for index in 0...units.count {
      let unit: UInt16 = index < units.count ? units[index] : 32
      if WorkspaceEditorCoordinator.isIdentifier(unit) { if start == nil { start = index }; continue }
      if let begin = start, index - begin > 2, !(units[begin] >= 48 && units[begin] <= 57) {
        let word = String(decoding: units[begin..<index], as: UTF16.self)
        if word != typedWord { add(word, kind: .text, sort: "2") }
      }
      start = nil
    }
    return items
  }
}
