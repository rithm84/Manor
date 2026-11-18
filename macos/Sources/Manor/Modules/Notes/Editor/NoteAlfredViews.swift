import Alfred
import AppKit
import ManorKit
import SwiftUI

/// Alfred's views size text against a 13 pt body; the document reads at 16 pt.
private let alfredScale: CGFloat = NoteTheme.bodySize / 13

// MARK: - Alfred block

@MainActor @Observable
final class NoteAlfredBlockState {
  var hasContent = false
  var latestRequest = ""
  var phase: NoteAlfredRun.Phase?
  var hovering = false
  var selected = false
  var editable = true
  var canOpenSettings = false
}

/// An Alfred block's own view: its header (the request, or the working animation) above the content and its
/// footer (an empty note, an inline error with Try again, and the "Ask Alfred to change…" control) below.
/// The content between is the editor's own read-only block views, laid out by the canvas.
final class NoteAlfredBlockView: NoteBlockView {
  let state = NoteAlfredBlockState()
  private var host: NoteAlfredHostingView<NoteAlfredBlockBody>?
  private var trackingArea: NSTrackingArea?

  override var handleAnchorY: CGFloat { 17 }

  override func setUp() {
    let id = block.id
    let actions = NoteAlfredBlockBody.Actions(
      ask: { [weak self] in self?.controller?.openAlfredComposer(refining: id) },
      retry: { [weak self] in self?.controller?.retryAlfred(id) },
      stop: { [weak self] in self?.controller?.stopAlfred(id) },
      openSettings: { [weak self] in self?.controller?.services.openAlfredSettings?() },
      select: { [weak self] in self?.controller?.selectBlocks([id]) })
    let host = NoteAlfredHostingView(rootView: NoteAlfredBlockBody(state: state, actions: actions))
    host.sizingOptions = []
    addSubview(host)
    self.host = host
  }

  override func blockDidChange(from previous: NoteBlock?) {
    state.hasContent = !NoteAlfred.source(of: block).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    state.latestRequest = NoteAlfred.requests(of: block).last?.prompt ?? ""
    state.editable = isEditable
    state.canOpenSettings = controller?.services.openAlfredSettings != nil
    refreshRun()
  }

  func refreshRun() {
    state.phase = controller?.alfredRun(for: block.id)?.phase
    state.selected = controller?.selectedBlockIDs.contains(block.id) ?? false
    needsDisplay = true
    needsLayout = true
  }

  override func layout() {
    super.layout()
    host?.frame = bounds
    if let content = controller?.alfredLayoutContent(block) { host?.chrome = (content.top, content.bottom) }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { state.hovering = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { state.hovering = false; needsDisplay = true }

  override func draw(_ dirtyRect: NSRect) {
    // A quiet field marks the block as Alfred's on hover; selection draws its own tint.
    guard state.hovering, !state.selected else { return }
    NoteTheme.surfaceSoft.withAlphaComponent(0.55).setFill()
    NSBezierPath(roundedRect: bounds.insetBy(dx: -6, dy: 0), xRadius: Radius.control, yRadius: Radius.control).fill()
  }

  override func menu(for event: NSEvent) -> NSMenu? { controller?.blockMenu(for: [block.id]) }
}

/// Takes clicks in the header and footer (its controls) and lets clicks between them fall through to the canvas,
/// where the content's own views sit. The hosting view reports itself for every point, so the split is by
/// geometry: `chrome` is the height of the header and of the footer.
final class NoteAlfredHostingView<Content: View>: NSHostingView<Content> {
  var chrome: (top: CGFloat, bottom: CGFloat) = (0, 0)

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard let hit = super.hitTest(point) else { return nil }
    let local = superview.map { convert(point, from: $0) } ?? point
    let y = isFlipped ? local.y : bounds.height - local.y
    let inChrome = y <= chrome.top || y >= bounds.height - chrome.bottom
    return inChrome ? hit : nil
  }
}

struct NoteAlfredBlockBody: View {
  struct Actions {
    let ask: () -> Void
    let retry: () -> Void
    let stop: () -> Void
    let openSettings: () -> Void
    let select: () -> Void
  }

  @Bindable var state: NoteAlfredBlockState
  let actions: Actions

  private typealias Chrome = NoteEditorController.AlfredChrome
  private var isThinking: Bool { state.phase == .thinking }
  private var isRunning: Bool { state.phase == .thinking || state.phase == .streaming }
  private var showsAsk: Bool { state.editable && !isRunning && (state.hovering || state.selected) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Group {
        if isThinking {
          HStack {
            NoteAlfredThinking(request: state.latestRequest)
            Spacer(minLength: Space.s2)
            stopButton
          }
        } else {
          header
        }
      }
      .frame(height: Chrome.header, alignment: .center)
      .contentShape(Rectangle())
      .onTapGesture { actions.select() }
      Spacer(minLength: 0)
      VStack(alignment: .leading, spacing: 0) {
        if !state.hasContent, state.phase == nil {
          Text("Alfred didn't write anything for this request.")
            .font(.ui(Typography.Size.sm))
            .foregroundStyle(Palette.inkMuted)
            .frame(height: Chrome.empty, alignment: .leading)
        }
        if case .failed(let message, let needsKey) = state.phase {
          failure(message, needsKey: needsKey)
            .frame(height: Chrome.failure, alignment: .center)
        }
        if state.editable && !isRunning {
          askControl
            .opacity(showsAsk ? 1 : 0)
            .allowsHitTesting(showsAsk)
            .animation(Motion.fast, value: showsAsk)
            .frame(height: Chrome.ask, alignment: .leading)
        }
      }
      .padding(.bottom, Chrome.padding)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private var header: some View {
    HStack(spacing: 6) {
      Image(systemName: "sparkles")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(Palette.primary)
      Text(firstLine(state.latestRequest).isEmpty ? "Alfred" : firstLine(state.latestRequest))
        .font(.ui(Typography.Size.xs, weight: .medium))
        .foregroundStyle(Palette.inkMuted)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: Space.s2)
      if isRunning { stopButton }
    }
  }

  private var stopButton: some View {
    Button(action: actions.stop) {
      HStack(spacing: 4) {
        Image(systemName: "stop.fill").font(.system(size: 8, weight: .bold))
        Text("Stop")
      }
    }
    .buttonStyle(.manor(.ghost, size: .small))
    .help("Stop writing (Escape)")
  }

  private func failure(_ message: String, needsKey: Bool) -> some View {
    HStack(alignment: .center, spacing: Space.s2) {
      Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.overdueError)
      Text(message)
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(Palette.ink)
        .lineLimit(2)
      Spacer(minLength: 0)
      if needsKey, state.canOpenSettings {
        Button("Open Settings", action: actions.openSettings).buttonStyle(.manor(.secondary, size: .small))
      }
      Button("Try again", action: actions.retry).buttonStyle(.manor(.secondary, size: .small))
    }
    .padding(.horizontal, Space.s3)
    .frame(maxHeight: .infinity)
    .background(Palette.overdueErrorTint.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .padding(.vertical, 4)
  }

  private var askControl: some View {
    Button(action: actions.ask) {
      HStack(spacing: 6) {
        Image(systemName: "sparkles").font(.system(size: 11, weight: .medium))
        Text("Ask Alfred to change…").font(.ui(Typography.Size.sm))
      }
      .foregroundStyle(Palette.inkMuted)
      .padding(.horizontal, Space.s2)
      .padding(.vertical, 5)
      .background(Palette.surfaceSoft, in: Capsule())
      .overlay(Capsule().strokeBorder(Palette.hairline))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .help("Change this with Alfred")
  }

  private func firstLine(_ text: String) -> String {
    text.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
  }
}

/// The working state before content arrives: the request's first line under a slow shimmer, with a softly
/// pulsing glyph. With Reduce Motion it holds still.
struct NoteAlfredThinking: View {
  let request: String
  var size: CGFloat = NoteTheme.bodySize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var line: String {
    let first = request.split(separator: "\n").first.map(String.init) ?? ""
    return first.isEmpty ? "Writing" : first
  }

  var body: some View {
    HStack(spacing: Space.s2) {
      if reduceMotion {
        Image(systemName: "sparkle").foregroundStyle(Palette.primary)
        Text(line).foregroundStyle(Palette.inkMuted)
      } else {
        TimelineView(.animation) { context in
          let t = context.date.timeIntervalSinceReferenceDate
          let phase = CGFloat(t.truncatingRemainder(dividingBy: 1.8) / 1.8)
          let pulse = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 2 * .pi / 1.6))
          HStack(spacing: Space.s2) {
            Image(systemName: "sparkle")
              .foregroundStyle(Palette.primary)
              .opacity(pulse)
            Text(line)
              .foregroundStyle(LinearGradient(
                stops: [.init(color: Palette.inkMuted.opacity(0.55), location: 0),
                        .init(color: Palette.ink, location: 0.5),
                        .init(color: Palette.inkMuted.opacity(0.55), location: 1)],
                startPoint: UnitPoint(x: phase * 2.4 - 1.2, y: 0.5),
                endPoint: UnitPoint(x: phase * 2.4 - 0.2, y: 0.5)))
          }
        }
      }
    }
    .font(.ui(size))
    .lineLimit(1)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Alfred is working")
  }
}

// MARK: - Diagram and generative UI blocks

@MainActor @Observable
final class NoteVisualBlockState {
  var source = ""
  var width: CGFloat = 600
  var isDiagram = true
}

/// A standalone diagram or generative-UI block: Alfred's view of its source, and a source editor on
/// double-click for hand-editing.
final class NoteVisualBlockView: NoteBlockView {
  let state = NoteVisualBlockState()
  let sourceView = NoteTextView.make()
  private var host: NSHostingView<NoteVisualBlockBody>?
  private var renderedSource: String?

  override var handleAnchorY: CGFloat { 16 }
  override var primaryTextView: NoteTextView? { (controller?.isEditingMath(block.id) ?? false) ? sourceView : nil }

  override func setUp() {
    let id = block.id
    let host = NSHostingView(rootView: NoteVisualBlockBody(state: state, select: { [weak self] in if self?.item.isAlfredContent == false { self?.controller?.selectBlocks([id]) } },
                                                          edit: { [weak self] in if self?.isEditable == true { self?.controller?.setMathEditing(id, true) } },
                                                          height: { [weak self] height in self?.controller?.reportHeight(id, height) }))
    host.sizingOptions = []
    addSubview(host)
    self.host = host
    sourceView.controller = controller
    sourceView.blockID = id
    sourceView.role = .mathSource
    sourceView.delegate = controller
    sourceView.setPlain(true)
    sourceView.placeholder = "Write the source"
    sourceView.placeholderFont = NoteTheme.mono(13.5)
    addSubview(sourceView)
  }

  override func blockDidChange(from previous: NoteBlock?) {
    let source = block.string("source") ?? ""
    state.source = source
    state.isDiagram = block.kind == .diagram
    sourceView.blockID = block.id
    sourceView.isEditable = isEditable
    if renderedSource != source, !sourceView.isFocused {
      sourceView.textStorage?.setAttributedString(NoteInlineText.plainAttributedString(source, style: NoteTextStyle(role: .mathSource)))
      sourceView.typingAttributes = NoteTextStyle(role: .mathSource).baseAttributes
    }
    renderedSource = source
    sourceView.isHidden = !(controller?.isEditingMath(block.id) ?? false)
    needsLayout = true
  }

  func acceptEditedSource(_ source: String) { renderedSource = source }

  override func layout() {
    super.layout()
    let rendered = controller?.measuredHeight(block.id) ?? 180
    host?.frame = NSRect(x: 0, y: 0, width: bounds.width, height: min(rendered, bounds.height))
    if abs(state.width - bounds.width) > 0.5 { state.width = bounds.width }
    sourceView.frame = NSRect(x: 16, y: rendered + 10, width: max(20, bounds.width - 32), height: max(20, bounds.height - rendered - 22))
    sourceView.textContainer?.size = NSSize(width: sourceView.frame.width, height: CGFloat.greatestFiniteMagnitude)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard controller?.isEditingMath(block.id) == true else { return }
    NoteTheme.surfaceHover.withAlphaComponent(0.6).setFill()
    NSBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: 2), xRadius: Radius.control, yRadius: Radius.control).fill()
  }

  override func menu(for event: NSEvent) -> NSMenu? { controller?.blockMenu(for: [block.id]) }
}

struct NoteVisualBlockBody: View {
  @Bindable var state: NoteVisualBlockState
  let select: () -> Void
  let edit: () -> Void
  let height: (CGFloat) -> Void

  var body: some View {
    Group {
      if state.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        Text(state.isDiagram ? "Empty diagram. Double-click to write one." : "Empty view. Double-click to write one.")
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkMuted)
          .padding(.vertical, Space.s3)
      } else if state.isDiagram {
        AlfredDiagramView(source: state.source, width: max(120, state.width))
      } else {
        AlfredGenerativeView(source: state.source, width: max(120, state.width), scale: alfredScale)
      }
    }
    .padding(.vertical, Space.s1)
    .fixedSize(horizontal: false, vertical: true)
    .frame(width: max(120, state.width), alignment: .leading)
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height(ceil($0)) }
    .frame(maxHeight: .infinity, alignment: .top)
    .contentShape(Rectangle())
    .onTapGesture(count: 2) { edit() }
    .onTapGesture { select() }
  }
}

// MARK: - Selection preview

@MainActor @Observable
final class NoteAlfredPreviewState {
  var latestRequest = ""
  var phase: NoteAlfredRun.Phase?
  var hasContent = false
  var canOpenSettings = false
  var isInline = false
}

/// The preview of a selection rewrite, under the selection: what Alfred wrote, and Replace selection,
/// Insert below, Try again, Discard, and a follow-up. Nothing in the note changes until it is applied.
final class NoteAlfredPreviewView: NoteBlockView {
  let state = NoteAlfredPreviewState()
  private var host: NoteAlfredHostingView<NoteAlfredPreviewBody>?

  override var handleAnchorY: CGFloat { 17 }

  override func setUp() {
    let body = NoteAlfredPreviewBody(state: state, actions: .init(
      replace: { [weak self] in self?.controller?.applySelectionEdit(replace: true) },
      insert: { [weak self] in self?.controller?.applySelectionEdit(replace: false) },
      retry: { [weak self] in self?.controller?.retrySelectionEdit() },
      discard: { [weak self] in self?.controller?.discardSelectionEdit() },
      ask: { [weak self] in self?.controller?.openPreviewComposer() },
      stop: { [weak self] in self?.controller?.escapeSelectionEdit() },
      openSettings: { [weak self] in self?.controller?.services.openAlfredSettings?() }))
    let host = NoteAlfredHostingView(rootView: body)
    host.sizingOptions = []
    addSubview(host)
    self.host = host
  }

  override func blockDidChange(from previous: NoteBlock?) {
    let edit = controller?.selectionEdit
    state.latestRequest = edit?.turns.last?.prompt ?? ""
    state.phase = edit?.phase
    state.hasContent = !(edit?.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    state.canOpenSettings = controller?.services.openAlfredSettings != nil
    if case .inline? = edit?.selection { state.isInline = true } else { state.isInline = false }
  }

  override func apply(_ item: NoteLayoutItem) {
    super.apply(item)
    blockDidChange(from: nil)
  }

  override func layout() {
    super.layout()
    host?.frame = bounds
    if let content = controller?.previewLayoutContent(block) { host?.chrome = (content.top, content.bottom) }
  }

  override func draw(_ dirtyRect: NSRect) {
    let path = NSBezierPath(roundedRect: bounds.insetBy(dx: -6, dy: 1), xRadius: Radius.control, yRadius: Radius.control)
    NoteTheme.primaryTint.withAlphaComponent(0.35).setFill()
    path.fill()
    NoteTheme.primary.withAlphaComponent(0.35).setStroke()
    path.lineWidth = 1
    path.stroke()
  }
}

struct NoteAlfredPreviewBody: View {
  struct Actions {
    let replace: () -> Void
    let insert: () -> Void
    let retry: () -> Void
    let discard: () -> Void
    let ask: () -> Void
    let stop: () -> Void
    let openSettings: () -> Void
  }

  @Bindable var state: NoteAlfredPreviewState
  let actions: Actions

  private typealias Chrome = NoteEditorController.AlfredChrome
  private var isRunning: Bool { state.phase == .thinking || state.phase == .streaming }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        if state.phase == .thinking {
          NoteAlfredThinking(request: state.latestRequest)
        } else {
          Image(systemName: "sparkles").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.primary)
          Text(state.latestRequest.split(separator: "\n").first.map(String.init) ?? "Alfred")
            .font(.ui(Typography.Size.xs, weight: .medium))
            .foregroundStyle(Palette.inkMuted)
            .lineLimit(1)
        }
        Spacer(minLength: Space.s2)
        if isRunning {
          Button(action: actions.stop) { Text("Stop") }.buttonStyle(.manor(.ghost, size: .small)).help("Stop writing (Escape)")
        }
      }
      .frame(height: Chrome.header)
      Spacer(minLength: 0)
      if case .failed(let message, let needsKey) = state.phase {
        HStack(spacing: Space.s2) {
          Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.overdueError)
          Text(message).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(2)
          Spacer(minLength: 0)
          if needsKey, state.canOpenSettings {
            Button("Open Settings", action: actions.openSettings).buttonStyle(.manor(.secondary, size: .small))
          }
        }
        .frame(height: Chrome.failure)
      }
      HStack(spacing: Space.s2) {
        Button(action: actions.replace) { Text("Replace selection") }
          .buttonStyle(.manor(.primary, size: .small))
          .disabled(isRunning || !state.hasContent)
          .help("Replace the selection (Return)")
        Button("Insert below", action: actions.insert)
          .buttonStyle(.manor(.secondary, size: .small))
          .disabled(isRunning || !state.hasContent)
        Button("Try again", action: actions.retry)
          .buttonStyle(.manor(.ghost, size: .small))
          .disabled(isRunning)
        Button("Discard", action: actions.discard)
          .buttonStyle(.manor(.ghost, size: .small))
          .help("Discard (Escape)")
        Spacer(minLength: Space.s2)
        Button(action: actions.ask) {
          HStack(spacing: 4) {
            Image(systemName: "sparkles").font(.system(size: 11))
            Text("Ask for changes…")
          }
        }
        .buttonStyle(.manor(.ghost, size: .small))
        .disabled(isRunning || !state.hasContent)
      }
      .frame(height: Chrome.ask)
      .padding(.bottom, Chrome.padding)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
