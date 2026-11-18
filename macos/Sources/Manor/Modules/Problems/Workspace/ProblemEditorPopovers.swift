import AppKit
import ManorKit
import SwiftUI

/// Hover: resting the pointer on a symbol shows its type and documentation from the language server, together with
/// any diagnostic under the pointer.
@MainActor
final class WorkspaceHover: NSResponder {
  private weak var coordinator: WorkspaceEditorCoordinator?
  private weak var textView: NSTextView?
  private var trackingArea: NSTrackingArea?
  private var pending: Task<Void, Never>?
  private var popover: NSPopover?
  private var shownRange: NSRange?
  private var keyMonitor: Any?

  init(coordinator: WorkspaceEditorCoordinator) {
    self.coordinator = coordinator
    super.init()
  }

  required init?(coder: NSCoder) { nil }

  var isVisible: Bool { popover?.isShown == true }

  func install(on textView: NSTextView) {
    self.textView = textView
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
    textView.addTrackingArea(area)
    trackingArea = area
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { [weak self] event in
      MainActor.assumeIsolated { self?.close() }
      return event
    }
  }

  /// Stops tracking when the editor goes away.
  func uninstall() {
    close()
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
    if let trackingArea, let textView { textView.removeTrackingArea(trackingArea) }
    trackingArea = nil
  }

  override func mouseMoved(with event: NSEvent) {
    guard let textView, let coordinator else { return }
    let point = textView.convert(event.locationInWindow, from: nil)
    guard let offset = coordinator.offset(at: point) else { pending?.cancel(); return }
    if let shownRange, isVisible, offset >= shownRange.location, offset <= NSMaxRange(shownRange) { return }
    close()
    pending = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(450))
      guard !Task.isCancelled else { return }
      await self?.show(at: offset)
    }
  }

  override func mouseExited(with event: NSEvent) { pending?.cancel() }

  func close() {
    pending?.cancel()
    pending = nil
    popover?.performClose(nil)
    popover = nil
    shownRange = nil
  }

  private func show(at offset: Int) async {
    guard let coordinator, let textView else { return }
    let text = textView.string as NSString
    guard offset < text.length else { return }
    let diagnostics = coordinator.diagnostics(at: offset)
    let start = WorkspaceEditorCoordinator.wordStart(in: text, before: offset)
    let end = WorkspaceEditorCoordinator.wordEnd(in: text, after: offset)
    var range = NSRange(location: start, length: end - start)
    var markdown: String?
    if range.length > 0, let connection = await coordinator.syncNow() {
      if let hover = try? await connection.hover(at: coordinator.position(of: offset)) {
        markdown = hover.contents
        if let lspRange = hover.range { range = LSPLineIndex(textView.string).range(of: lspRange) }
      }
    }
    guard !Task.isCancelled, markdown != nil || !diagnostics.isEmpty else { return }
    if range.length == 0 { range = NSRange(location: offset, length: 1) }
    guard let anchor = coordinator.rect(for: range) else { return }
    let popover = NSPopover()
    popover.behavior = .semitransient
    popover.animates = false
    popover.contentViewController = NSHostingController(rootView: WorkspaceHoverContent(diagnostics: diagnostics, markdown: markdown, language: coordinator.language))
    popover.show(relativeTo: anchor, of: textView, preferredEdge: .minY)
    self.popover = popover
    shownRange = range
  }
}

/// Signature help: while typing a call's arguments, the signature floats above the caret with the current
/// parameter emphasized.
@MainActor
final class WorkspaceSignatureHelp {
  private weak var coordinator: WorkspaceEditorCoordinator?
  private var panel: NSPanel?
  private var pending: Task<Void, Never>?
  private let state = WorkspaceSignatureState()

  init(coordinator: WorkspaceEditorCoordinator) { self.coordinator = coordinator }

  var isVisible: Bool { panel?.isVisible == true }

  func textChanged() {
    guard let coordinator, let textView = coordinator.textView else { return }
    let text = textView.string as NSString
    let caret = textView.selectedRange().location
    guard caret > 0, caret <= text.length else { close(); return }
    let previous = text.substring(with: NSRange(location: caret - 1, length: 1))
    let triggers = coordinator.model.services.languageServers.connection(coordinator.language)?.signatureTriggerCharacters ?? ["(", ","]
    if triggers.contains(previous) { request(trigger: previous) } else if isVisible { request(trigger: nil) }
  }

  func selectionChanged() {
    guard isVisible else { return }
    request(trigger: nil)
  }

  func request(trigger: String?) {
    pending?.cancel()
    pending = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(trigger == nil ? 120 : 30))
      guard !Task.isCancelled, let self, let coordinator = self.coordinator, let textView = coordinator.textView else { return }
      let caret = textView.selectedRange().location
      guard let connection = await coordinator.syncNow() else { self.close(); return }
      let help = try? await connection.signatureHelp(at: coordinator.position(of: caret), trigger: trigger)
      guard !Task.isCancelled, textView.selectedRange().location == caret else { return }
      guard let help else { self.close(); return }
      self.show(help, at: caret)
    }
  }

  /// A plain floating panel sized and placed by hand: its width is the signature's (capped), its height is measured
  /// once at that width, and it sits just above the caret's line. Nothing sizes itself from its content, so layout
  /// can't loop.
  private func show(_ help: LSPSignatureHelp, at caret: Int) {
    guard let coordinator, let textView = coordinator.textView, let window = textView.window,
          help.signatures.indices.contains(help.activeSignature),
          let caretRect = coordinator.rect(for: NSRange(location: caret, length: 0)) else { close(); return }
    state.help = help
    let panel = self.panel ?? makePanel()
    self.panel = panel
    let width = WorkspaceSignatureContent.width(for: help.signatures[help.activeSignature])
    // Measured once at the pinned width with a throwaway host; the panel's own host never sizes the window.
    let measured = NSHostingController(rootView: WorkspaceSignatureContent(state: state))
      .sizeThatFits(in: CGSize(width: width, height: WorkspacePopoverSizing.maxHeight))
    let height = min(max(measured.height, 24), WorkspacePopoverSizing.maxHeight)
    let line = window.convertToScreen(textView.convert(caretRect, to: nil))
    var origin = NSPoint(x: line.minX - 12, y: line.maxY + 4)
    if let visible = window.screen?.visibleFrame {
      if origin.y + height > visible.maxY { origin.y = line.minY - height - 4 }
      origin.x = min(max(visible.minX + 4, origin.x), visible.maxX - width - 4)
    }
    panel.setFrame(NSRect(x: origin.x, y: origin.y, width: width, height: ceil(height)), display: true)
    if panel.parent !== window {
      panel.parent?.removeChildWindow(panel)
      window.addChildWindow(panel, ordered: .above)
    }
    panel.orderFront(nil)
  }

  private func makePanel() -> NSPanel {
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 40), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isFloatingPanel = true
    panel.becomesKeyOnlyIfNeeded = true
    panel.hidesOnDeactivate = true
    panel.hasShadow = true
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.ignoresMouseEvents = true
    let host = NSHostingView(rootView: WorkspaceSignatureContent(state: state))
    host.sizingOptions = []
    panel.contentView = host
    return panel
  }

  func close() {
    pending?.cancel()
    guard let panel, panel.isVisible else { return }
    panel.parent?.removeChildWindow(panel)
    panel.orderOut(nil)
  }
}

@MainActor
@Observable
final class WorkspaceSignatureState {
  var help: LSPSignatureHelp?
}

// MARK: Popover content

struct WorkspaceHoverContent: View {
  let diagnostics: [LSPDiagnostic]
  let markdown: String?
  let language: ProblemLanguage

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Space.s2) {
        ForEach(Array(diagnostics.enumerated()), id: \.offset) { _, diagnostic in
          HStack(alignment: .firstTextBaseline, spacing: Space.s2) {
            Image(systemName: diagnostic.severity == .error ? "xmark.octagon.fill" : diagnostic.severity == .warning ? "exclamationmark.triangle.fill" : "info.circle.fill")
              .foregroundStyle(diagnostic.severity == .error ? Palette.overdueError : diagnostic.severity == .warning ? Palette.warning : Palette.frozenInfo)
              .font(.system(size: 12))
            Text(diagnostic.message + (diagnostic.source.map { "  \($0)" } ?? ""))
              .font(.ui(Typography.Size.sm))
              .foregroundStyle(Palette.inkBody)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        if !diagnostics.isEmpty, markdown != nil { Hairline() }
        if let markdown { WorkspaceHoverMarkdown(markdown: markdown, language: language) }
      }
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      .frame(width: WorkspacePopoverSizing.hoverWidth, alignment: .leading)
      .textSelection(.enabled)
    }
    // A fixed width, so wrapped text sets the height without feeding back into the width; tall content scrolls.
    .frame(width: WorkspacePopoverSizing.hoverWidth)
    .frame(maxHeight: WorkspacePopoverSizing.maxHeight)
    .fixedSize(horizontal: false, vertical: true)
  }
}

/// Hover Markdown: fenced code keeps its lines in the editor's font and colors; prose wraps.
struct WorkspaceHoverMarkdown: View {
  let markdown: String
  let language: ProblemLanguage

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      ForEach(Array(WorkspaceMarkdownParser.fencedSegments(markdown).enumerated()), id: \.offset) { _, segment in
        if segment.isCode {
          ScrollView(.horizontal, showsIndicators: false) {
            WorkspaceCode(code: segment.text, language: segment.language ?? language, size: Typography.Size.xs)
          }
        } else {
          Text(WorkspaceMarkdownParser.inline(segment.text))
            .font(.ui(Typography.Size.sm))
            .foregroundStyle(Palette.inkBody)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }
}

struct WorkspaceSignatureContent: View {
  let state: WorkspaceSignatureState

  var body: some View {
    if let help = state.help, help.signatures.indices.contains(help.activeSignature) {
      let signature = help.signatures[help.activeSignature]
      VStack(alignment: .leading, spacing: Space.s1) {
        Text(Self.label(signature, active: help.activeParameter))
          .font(.code(Typography.Size.xs))
          .fixedSize(horizontal: false, vertical: true)
        if let documentation = signature.documentation, !documentation.isEmpty {
          Text(WorkspaceMarkdownParser.inline(String(documentation.prefix(400))))
            .font(.ui(Typography.Size.xs))
            .foregroundStyle(Palette.inkMuted)
            .lineLimit(4)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      // A fixed width (the signature's own, capped): the height follows from it and can't feed back into it.
      .frame(width: Self.width(for: signature), alignment: .leading)
      .background(Palette.surfaceCard, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairlineStrong))
    }
  }

  static func width(for signature: LSPSignatureHelp.Signature) -> CGFloat {
    let font = NSFont.monospacedSystemFont(ofSize: Typography.Size.xs, weight: .semibold)
    let text = ceil((signature.label as NSString).size(withAttributes: [.font: font]).width)
    return min(max(text + Space.s3 * 2 + 2, 160), WorkspacePopoverSizing.maxWidth)
  }

  static func label(_ signature: LSPSignatureHelp.Signature, active: Int) -> AttributedString {
    func piece(_ text: Substring, active: Bool) -> AttributedString {
      var value = AttributedString(String(text))
      value.foregroundColor = active ? Palette.primary : Palette.inkBody
      if active { value.font = .code(Typography.Size.xs, weight: .semibold) }
      return value
    }
    let label = signature.label
    let utf16 = label.utf16
    guard signature.parameters.indices.contains(active), signature.parameters[active].upperBound <= utf16.count else { return piece(label[...], active: false) }
    let range = signature.parameters[active]
    let lower = utf16.index(utf16.startIndex, offsetBy: range.lowerBound)
    let upper = utf16.index(utf16.startIndex, offsetBy: range.upperBound)
    guard let start = lower.samePosition(in: label), let end = upper.samePosition(in: label) else { return piece(label[...], active: false) }
    var text = piece(label[..<start], active: false)
    text.append(piece(label[start..<end], active: true))
    text.append(piece(label[end...], active: false))
    return text
  }
}

/// The editor popovers' sizes. Their content always has a fixed width: content whose width and height both
/// follow each other (wrapping text sized to its own ideal) never settles in an `NSPopover`, which keeps resizing and
/// allocating; with the width pinned, the height follows and the popover's preferred size is stable.
enum WorkspacePopoverSizing {
  static let maxWidth: CGFloat = 520
  static let hoverWidth: CGFloat = 440
  static let maxHeight: CGFloat = 320
}
