import AppKit
import ManorKit
import SwiftUI

/// The native block editor. The Notes page hands it a note's stored document, the block
/// array (`note_pages.content_json`), and receives the edited array back after each edit (once per run loop turn).
/// Everything inside (the block model, rendering, editing, menus) is the editor's own; only this boundary
/// is shared.
///
/// Conversion is lossless: blocks, props, inline items, and styles the editor does not understand are kept
/// verbatim, and an untouched block is written back exactly as it was stored.
///
/// Optional parameters (all defaulted, so `NoteEditor(blocks:documentID:externalRevision:isEditable:onChange:)`
/// keeps working):
/// - `services`: attachment resolving and uploading, the `@` mention catalog, opening another note, "Move to
///   note", "Copy link to block", and opening web links. See `NoteEditorServices`.
/// - `findRequest`: increment to open the editor's own find bar (Command-F inside the editor opens it too).
/// - `findQuery`, `findIndex`, `onFindCommand`: for a page that shows its own find bar. A non-nil `findQuery`
///   highlights its matches (`NoteFind.matches`, the same order the page counts) and scrolls to match
///   `findIndex`; `onFindCommand` replaces the editor's own bar when the reader presses Command-F.
/// - `revealFragment` and `revealRequest`: a deep-link fragment (`#block=<id>` or a heading slug) to scroll to
///   and focus; increment `revealRequest` to reveal again.
struct NoteEditor: View {
  /// The stored block array. The editor reads it when it appears and when `documentID` or `externalRevision` changes.
  let blocks: [JSONValue]
  /// Identifies the open note; a new value resets the editor's state (selection, undo).
  let documentID: String
  /// Increments when the page applies a change from outside the editor (a merge or a restore).
  let externalRevision: Int
  var isEditable: Bool = true
  var services = NoteEditorServices()
  var findRequest = 0
  var findQuery: String?
  var findIndex = 0
  var onFindCommand: (() -> Void)?
  var revealFragment: String?
  var revealRequest = 0
  /// Shown above the first block and scrolled with the document (the page passes the note title).
  var header: AnyView?
  /// Called with the full block array after each edit.
  let onChange: ([JSONValue]) -> Void

  @State private var model = NoteEditorModel()

  init(blocks: [JSONValue], documentID: String, externalRevision: Int, isEditable: Bool = true, services: NoteEditorServices = NoteEditorServices(),
       findRequest: Int = 0, findQuery: String? = nil, findIndex: Int = 0, onFindCommand: (() -> Void)? = nil,
       revealFragment: String? = nil, revealRequest: Int = 0, header: AnyView? = nil, onChange: @escaping ([JSONValue]) -> Void) {
    self.header = header
    self.blocks = blocks
    self.documentID = documentID
    self.externalRevision = externalRevision
    self.isEditable = isEditable
    self.services = services
    self.findRequest = findRequest
    self.findQuery = findQuery
    self.findIndex = findIndex
    self.onFindCommand = onFindCommand
    self.revealFragment = revealFragment
    self.revealRequest = revealRequest
    self.onChange = onChange
  }

  var body: some View {
    @Bindable var model = model
    NoteEditorSurface(model: model, blocks: blocks, documentID: documentID, externalRevision: externalRevision, isEditable: isEditable,
                      services: services, findQuery: findQuery, findIndex: findIndex, onFindCommand: onFindCommand, header: header, onChange: onChange)
      .overlay(alignment: .topTrailing) {
        if model.findVisible {
          NoteEditorFindBar(model: model)
            .padding(.top, Space.s3)
            .padding(.trailing, Space.s5)
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
      }
      .overlay(alignment: .bottom) {
        if let notice = model.notice {
          Text(notice)
            .font(.ui(Typography.Size.sm, weight: .medium))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2)
            .background(Palette.surfaceCard, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.hairline))
            .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
            .padding(.bottom, Space.s5)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
      }
      .animation(Motion.fast, value: model.findVisible)
      .animation(Motion.fast, value: model.notice)
      .onChange(of: DialogPresence.shared.isAnyOpen) { _, open in if open { model.controller.toolbar.hide() } }
      .manorDialog(item: $model.alfredComposer, width: 620, onDismiss: {
        if let request = model.alfredComposer { model.controller.closeAlfredComposer(request) }
      }) { request in
        NoteAlfredComposer(request: request, onSend: { prompt, images in
          model.controller.sendAlfred(request, prompt: prompt, images: images)
        }, onClose: { model.controller.closeAlfredComposer(request) })
      }
      .onChange(of: findRequest) { _, _ in model.controller.openFind() }
      .onChange(of: revealRequest) { _, _ in if let revealFragment { model.controller.revealFragment(revealFragment) } }
      .onChange(of: documentID) { _, _ in
        if let revealFragment { DispatchQueue.main.async { model.controller.revealFragment(revealFragment) } }
      }
      .onAppear {
        if let revealFragment { DispatchQueue.main.async { model.controller.revealFragment(revealFragment) } }
      }
  }
}

/// Hosts the AppKit canvas.
private struct NoteEditorSurface: NSViewRepresentable {
  let model: NoteEditorModel
  let blocks: [JSONValue]
  let documentID: String
  let externalRevision: Int
  let isEditable: Bool
  let services: NoteEditorServices
  let findQuery: String?
  let findIndex: Int
  let onFindCommand: (() -> Void)?
  let header: AnyView?
  let onChange: ([JSONValue]) -> Void

  func makeNSView(context: Context) -> NoteEditorScrollView {
    NoteEditorScrollView(controller: model.controller)
  }

  func updateNSView(_ view: NoteEditorScrollView, context: Context) {
    let controller = model.controller
    controller.onChange = onChange
    controller.services = services
    controller.isEditable = isEditable
    controller.onFindCommand = onFindCommand
    controller.load(blocks, documentID: documentID, externalRevision: externalRevision)
    controller.setExternalFind(query: findQuery, index: findIndex)
    view.setHeader(header)
  }

  static func dismantleNSView(_ view: NoteEditorScrollView, coordinator: ()) {
    view.controller.flushChanges()
    view.controller.toolbar.hide()
    view.controller.dialogs.dismiss()
    view.controller.suggestions.close()
  }
}

/// The scroll view around the canvas. Scrolling repositions floating controls; resizing reflows blocks.
final class NoteEditorScrollView: NSScrollView {
  let controller: NoteEditorController
  let canvas: NoteCanvasView
  private var observers: [NSObjectProtocol] = []

  init(controller: NoteEditorController) {
    self.controller = controller
    self.canvas = NoteCanvasView(controller: controller)
    super.init(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    drawsBackground = false
    hasVerticalScroller = true
    hasHorizontalScroller = false
    autohidesScrollers = true
    scrollerStyle = .overlay
    borderType = .noBorder
    automaticallyAdjustsContentInsets = false
    documentView = canvas
    canvas.autoresizingMask = [.width]
    contentView.postsBoundsChangedNotifications = true
    controller.canvas = canvas
    controller.scrollView = self
    observers.append(NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: contentView, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.canvas.clipBoundsChanged()
        self.controller.toolbar.reposition()
        if self.controller.suggestions.isOpen { self.controller.suggestions.close() }
      }
    })
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private var headerHost: NSHostingView<AnyView>?

  /// Installs or updates the header above the first block. The hosting view keeps its identity across
  /// updates, so a focused title field stays focused while the page re-renders.
  func setHeader(_ header: AnyView?) {
    guard let header else {
      if headerHost != nil { headerHost = nil; canvas.measureHeader = nil; canvas.headerView = nil; canvas.layoutDocument() }
      return
    }
    if let headerHost {
      headerHost.rootView = header
      canvas.headerChanged()
      return
    }
    let host = NSHostingView(rootView: header)
    // The canvas places the header by frame, but measures it through `fittingSize`, which reads zero
    // without the intrinsic size (the title then overlapped the first block).
    host.sizingOptions = [.intrinsicContentSize]
    headerHost = host
    canvas.measureHeader = { [weak host] width in
      guard let host else { return 0 }
      // Measures at the column width: a temporary width constraint makes the title wrap as it will be drawn.
      let constraint = host.widthAnchor.constraint(equalToConstant: width)
      constraint.isActive = true
      defer { constraint.isActive = false }
      return host.fittingSize.height
    }
    canvas.headerView = host
    canvas.layoutDocument()
  }

  private var outerObserver: NSObjectProtocol?
  private weak var outerClip: NSClipView?

  deinit {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    if let outerObserver { NotificationCenter.default.removeObserver(outerObserver) }
  }

  override func layout() {
    super.layout()
    if abs(canvas.frame.width - contentSize.width) > 0.5 || canvas.items.isEmpty {
      canvas.layoutDocument()
    }
  }

  /// Inside a page that scrolls, the editor reports its document height so it grows instead of scrolling.
  override var intrinsicContentSize: NSSize {
    NSSize(width: NSView.noIntrinsicMetric, height: canvas.isEmbedded ? max(canvas.documentHeight, 120) : NSView.noIntrinsicMetric)
  }

  override func viewDidMoveToSuperview() {
    super.viewDidMoveToSuperview()
    attachToOuterScrollView()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    attachToOuterScrollView()
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor); self.keyMonitor = nil }
    guard window != nil else { return }
    // Down or Return in the title moves into the document.
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      let keyCode = event.keyCode
      let flags = event.modifierFlags
      let windowNumber = event.windowNumber
      let handled = MainActor.assumeIsolated { () -> Bool in
        guard let self, windowNumber == self.window?.windowNumber, let header = self.canvas.headerView,
              let editor = self.window?.firstResponder as? NSTextView, editor.isDescendant(of: header) else { return false }
        return self.controller.handleHeaderKey(keyCode: keyCode, flags: flags, editor: editor)
      }
      return handled ? nil : event
    }
  }

  private var keyMonitor: Any?

  private func attachToOuterScrollView() {
    let outer = superview?.enclosingScrollView
    let embedded = outer != nil
    if canvas.isEmbedded != embedded {
      canvas.isEmbedded = embedded
      hasVerticalScroller = !embedded
      verticalScrollElasticity = embedded ? .none : .automatic
      canvas.onDocumentHeightChange = { [weak self] _ in self?.invalidateIntrinsicContentSize() }
      canvas.layoutDocument()
      invalidateIntrinsicContentSize()
    }
    guard let clip = outer?.contentView, clip !== outerClip else { return }
    if let outerObserver { NotificationCenter.default.removeObserver(outerObserver) }
    outerClip = clip
    clip.postsBoundsChangedNotifications = true
    outerObserver = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: clip, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.canvas.updateVisibleViews()
        self.controller.toolbar.reposition()
        if self.controller.suggestions.isOpen { self.controller.suggestions.close() }
      }
    }
  }

  /// Command-Z with nothing focused (after clicking away) still reaches the note's history.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
    if let window, window.firstResponder === window || window.firstResponder == nil,
       event.charactersIgnoringModifiers?.lowercased() == "z", flags == .command || flags == [.command, .shift] {
      if flags.contains(.shift) { controller.redo() } else { controller.undo() }
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  override func scrollWheel(with event: NSEvent) {
    // While embedded, scrolling belongs to the page.
    if canvas.isEmbedded { nextResponder?.scrollWheel(with: event) } else { super.scrollWheel(with: event) }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    canvas.appearanceChanged()
  }
}

/// Find in note: highlights every match without changing the text. Return goes to the next match,
/// Shift-Return to the previous one, and Escape closes.
private struct NoteEditorFindBar: View {
  @Bindable var model: NoteEditorModel
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField("Find in note", text: Binding(get: { model.findQuery }, set: { model.controller.updateFind(query: $0) }))
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.body))
        .frame(width: 180)
        .focused($focused)
        .onSubmit { model.controller.stepFind(NSApp.currentEvent?.modifierFlags.contains(.shift) == true ? -1 : 1) }
        .onExitCommand { close() }
      Text(countLabel)
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(Palette.inkMuted)
        .tabular()
        .frame(minWidth: 64, alignment: .trailing)
      Button { model.controller.stepFind(-1) } label: { Image(systemName: "chevron.up") }
        .buttonStyle(.plain).disabled(model.findCount == 0).help("Previous match").accessibilityLabel("Previous match")
      Button { model.controller.stepFind(1) } label: { Image(systemName: "chevron.down") }
        .buttonStyle(.plain).disabled(model.findCount == 0).help("Next match").accessibilityLabel("Next match")
      Button { close() } label: { Image(systemName: "xmark") }
        .buttonStyle(.plain).help("Close find").accessibilityLabel("Close find")
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(Palette.inkBody)
    .padding(.horizontal, Space.s3)
    .frame(height: 36)
    .background(Palette.surfaceCard, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
    .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
    .onAppear { focused = true }
    .onChange(of: model.findFocusToken) { _, _ in focused = true }
  }

  private var countLabel: String {
    if model.findQuery.isEmpty { return "" }
    if model.findCount == 0 { return "No matches" }
    return "\(model.findIndex + 1) of \(model.findCount)"
  }

  private func close() {
    model.controller.closeFind()
  }
}

/// Image properties: distinct alt text and caption, width, crop, and focal point, with a live preview.
struct NoteImageDialog: View {
  @State private var draft: NoteImageEditRequest
  let canReplace: Bool
  let onCancel: () -> Void
  let onSave: (NoteImageEditRequest) -> Void
  let onReplace: () -> Void

  init(request: NoteImageEditRequest, canReplace: Bool, onCancel: @escaping () -> Void, onSave: @escaping (NoteImageEditRequest) -> Void, onReplace: @escaping () -> Void) {
    _draft = State(initialValue: request)
    self.canReplace = canReplace
    self.onCancel = onCancel
    self.onSave = onSave
    self.onReplace = onReplace
  }

  private func string(_ key: String) -> Binding<String> {
    Binding(get: { draft.props[key]?.string ?? "" }, set: { draft.props[key] = .string(String($0.prefix(2000))) })
  }

  private func number(_ key: String, default value: Double) -> Binding<Double> {
    Binding(get: { draft.props[key]?.double ?? value }, set: { draft.props[key] = .number($0.rounded()) })
  }

  private var crop: String { draft.props["crop"]?.string ?? "original" }

  private var aspect: CGFloat? {
    switch crop {
    case "square": 1
    case "landscape": 16.0 / 9.0
    case "portrait": 3.0 / 4.0
    default: nil
    }
  }

  var body: some View {
    DialogPanel("Image", onClose: onCancel) {
      VStack(alignment: .leading, spacing: Space.s4) {
        if let image = draft.image {
          preview(image)
        }
        row("Alt text") {
          TextField("Describe the image for screen readers", text: string("alt")).textFieldStyle(.manor)
        }
        row("Caption") {
          TextField("Shown under the image", text: string("caption")).textFieldStyle(.manor)
        }
        row("Width") {
          HStack(spacing: Space.s2) {
            TextField("Full width", value: Binding(get: { draft.props["previewWidth"]?.double }, set: { value in
              if let value { draft.props["previewWidth"] = .number(min(1600, max(80, value.rounded()))) } else { draft.props.removeValue(forKey: "previewWidth") }
            }), format: .number)
            .textFieldStyle(.manor)
            .frame(width: 120)
            Text("points").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
            Spacer()
            if draft.props["previewWidth"] != nil {
              Button("Use full width") { draft.props.removeValue(forKey: "previewWidth") }.buttonStyle(.manor(.ghost, size: .small))
            }
          }
        }
        row("Crop") {
          SegmentedTabs([("original", "Original"), ("square", "Square"), ("landscape", "Landscape"), ("portrait", "Portrait")],
                        selection: Binding(get: { crop }, set: { draft.props["crop"] = .string($0) }))
            .accessibilityLabel("Crop")
        }
        if crop != "original" {
          row("Horizontal position") { Slider(value: number("focalX", default: 50), in: 0...100) }
          row("Vertical position") { Slider(value: number("focalY", default: 50), in: 0...100) }
        }
        row("Alignment") {
          SegmentedTabs([("left", "Left"), ("center", "Center"), ("right", "Right")],
                        selection: Binding(get: { draft.props["textAlignment"]?.string ?? "left" }, set: { draft.props["textAlignment"] = .string($0) }))
            .accessibilityLabel("Alignment")
        }
        if canReplace {
          Button("Replace image", action: onReplace).buttonStyle(.manor(.secondary, size: .small))
        }
      }
    } footer: {
      Button("Cancel", action: onCancel).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      Button("Save") { onSave(draft) }.buttonStyle(.primary).keyboardShortcut(.defaultAction)
    }
  }

  private func preview(_ image: NSImage) -> some View {
    let focalX = CGFloat(draft.props["focalX"]?.double ?? 50) / 100
    let focalY = CGFloat(draft.props["focalY"]?.double ?? 50) / 100
    return Color.clear
      .aspectRatio(aspect ?? (image.size.height > 0 ? image.size.width / image.size.height : 1.6), contentMode: .fit)
      .frame(maxWidth: .infinity, maxHeight: 260)
      .overlay {
        GeometryReader { proxy in
          let size = proxy.size
          let scale = max(size.width / max(image.size.width, 1), size.height / max(image.size.height, 1))
          let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
          Image(nsImage: image)
            .resizable()
            .frame(width: drawn.width, height: drawn.height)
            .offset(x: (size.width - drawn.width) * focalX, y: (size.height - drawn.height) * focalY)
        }
        .clipped()
      }
      .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
      .accessibilityLabel(draft.props["alt"]?.string ?? "Image preview")
  }

  private func row<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    HStack(alignment: .center, spacing: Space.s3) {
      Text(label).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody).frame(width: 136, alignment: .leading)
      content()
    }
  }
}

/// A centered dialog over the whole window, with the page dimmed behind it. The editor may be taller than the
/// window when it grows inside a scrolling page, so its dialogs float in their own layer over the window
/// rather than inside the editor's frame.
@MainActor
final class NoteDialogPresenter {
  private var panel: NoteFloatingPanel?
  private var onDismiss: (() -> Void)?

  func present<Content: View>(over window: NSWindow?, width: CGFloat, onDismiss: @escaping () -> Void, @ViewBuilder content: () -> Content) {
    guard let window else { return }
    dismiss()
    self.onDismiss = onDismiss
    let panel = NoteFloatingPanel()
    panel.allowsKey = true
    panel.hasShadow = false
    panel.level = .floating
    let frame = window.convertToScreen(window.contentLayoutRect)
    panel.setFrame(frame, display: false)
    let chrome = NoteDialogChrome(width: width, dismiss: { [weak self] in self?.cancel() }, content: content())
    panel.contentView = NSHostingView(rootView: chrome)
    window.addChildWindow(panel, ordered: .above)
    panel.makeKeyAndOrderFront(nil)
    self.panel = panel
  }

  /// Closes without running the dismiss handler (after Save).
  func dismiss() {
    guard let panel else { return }
    let parent = panel.parent
    parent?.removeChildWindow(panel)
    panel.orderOut(nil)
    self.panel = nil
    onDismiss = nil
    parent?.makeKey()
  }

  private func cancel() {
    let handler = onDismiss
    dismiss()
    handler?()
  }
}

private struct NoteDialogChrome<Content: View>: View {
  let width: CGFloat
  let dismiss: () -> Void
  let content: Content
  @State private var shown = false

  var body: some View {
    ZStack {
      Palette.overlayBackdrop
        .ignoresSafeArea()
        .onTapGesture { dismiss() }
        .opacity(shown ? 1 : 0)
      content
        .tint(Palette.primary)
        .frame(width: width)
        .fixedSize(horizontal: false, vertical: true)
        .background(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).fill(Palette.surfaceCard))
        .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 30, y: 14)
        .padding(Space.s8)
        .scaleEffect(shown ? 1 : 0.96)
        .opacity(shown ? 1 : 0)
        .onExitCommand { dismiss() }
    }
    .onAppear { withAnimation(Motion.panel) { shown = true } }
  }
}
