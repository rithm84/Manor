import AppKit
import AVKit
import ManorKit
import WebKit

/// Loads and caches images for image blocks.
@MainActor
final class NoteImageLoader {
  static let shared = NoteImageLoader()
  private let cache = NSCache<NSURL, NSImage>()

  func cached(_ url: URL) -> NSImage? { cache.object(forKey: url as NSURL) }

  func image(for url: URL) async throws -> NSImage {
    if let cached = cache.object(forKey: url as NSURL) { return cached }
    let data: Data
    if url.isFileURL {
      data = try Data(contentsOf: url)
    } else {
      let (body, response) = try await URLSession.shared.data(from: url)
      if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw NoteEditorError.message("This image could not load. Check its link or replace the file.")
      }
      data = body
    }
    guard let image = NSImage(data: data) else { throw NoteEditorError.message("This file is not an image Manor can show.") }
    cache.setObject(image, forKey: url as NSURL)
    return image
  }
}

enum NoteEditorError: LocalizedError {
  case message(String)
  var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

// MARK: - Shared pieces

/// A small field inside a block (a link to capture). Command-Z undoes the field's own typing first, then
/// reaches the note's history, so undoing right after inserting a block takes the block back out.
final class NoteCaptureField: NSTextField {
  weak var controller: NoteEditorController?

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
    if let editor = currentEditor(), event.charactersIgnoringModifiers?.lowercased() == "z", flags == .command || flags == [.command, .shift],
       let controller, editor.undoManager?.canUndo != true || flags.contains(.shift) {
      if flags.contains(.shift) { controller.redo() } else { controller.undo() }
      return true
    }
    return super.performKeyEquivalent(with: event)
  }
}

/// The empty state of a media block: upload a file or paste a link.
final class NoteMediaCaptureView: NSView, NSTextFieldDelegate {
  private let icon = NSImageView()
  private let uploadButton = NSButton()
  private let field = NoteCaptureField()
  private let addButton = NSButton()
  private let message = NSTextField(labelWithString: "")
  weak var controller: NoteEditorController? { didSet { field.controller = controller } }
  var onUpload: (() -> Void)?
  var onLink: ((URL) -> Void)?
  var allowsUpload = true

  override var isFlipped: Bool { true }

  init(symbol: String, uploadTitle: String, linkPlaceholder: String) {
    super.init(frame: .zero)
    wantsLayer = true
    icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 15, weight: .regular))
    icon.contentTintColor = NoteTheme.inkMuted
    addSubview(icon)
    uploadButton.title = uploadTitle
    uploadButton.bezelStyle = .rounded
    uploadButton.controlSize = .small
    uploadButton.font = NoteTheme.ui(12, .medium)
    uploadButton.target = self
    uploadButton.action = #selector(upload)
    addSubview(uploadButton)
    field.placeholderString = linkPlaceholder
    field.font = NoteTheme.ui(13)
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.delegate = self
    field.target = self
    field.action = #selector(addLink)
    addSubview(field)
    addButton.title = "Add"
    addButton.bezelStyle = .rounded
    addButton.controlSize = .small
    addButton.font = NoteTheme.ui(12, .semibold)
    addButton.target = self
    addButton.action = #selector(addLink)
    addButton.isEnabled = false
    addSubview(addButton)
    message.font = NoteTheme.ui(12)
    message.textColor = NoteTheme.error
    addSubview(message)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func setBusy(_ busy: Bool) {
    uploadButton.isEnabled = !busy
    uploadButton.title = busy ? "Uploading" : uploadButton.title
  }

  func setUploadTitle(_ title: String) { uploadButton.title = title }

  /// Puts the caret in the link field, right after the block is inserted.
  func focusField() { window?.makeFirstResponder(field) }

  func showError(_ text: String?) { message.stringValue = text ?? "" }

  func controlTextDidChange(_ obj: Notification) {
    addButton.isEnabled = !field.stringValue.trimmingCharacters(in: .whitespaces).isEmpty
    message.stringValue = ""
  }

  @objc private func upload() { onUpload?() }

  @objc private func addLink() {
    let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return }
    guard let url = URL(string: value), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http", url.host != nil else {
      message.stringValue = "Enter a complete web address."
      return
    }
    onLink?(url)
  }

  override func layout() {
    super.layout()
    let mid: CGFloat = 23
    icon.frame = NSRect(x: 12, y: mid - 9, width: 18, height: 18)
    var x: CGFloat = 38
    uploadButton.isHidden = !allowsUpload
    if allowsUpload {
      uploadButton.sizeToFit()
      uploadButton.frame.origin = NSPoint(x: x, y: mid - uploadButton.frame.height / 2)
      x = uploadButton.frame.maxX + 10
    }
    addButton.sizeToFit()
    addButton.frame.origin = NSPoint(x: bounds.width - addButton.frame.width - 8, y: mid - addButton.frame.height / 2)
    field.frame = NSRect(x: x, y: mid - 10, width: max(60, addButton.frame.minX - x - 8), height: 20)
    message.frame = NSRect(x: 38, y: 40, width: bounds.width - 46, height: 16)
  }

  override func draw(_ dirtyRect: NSRect) {
    let rect = NSRect(x: 0.5, y: 0.5, width: bounds.width - 1, height: 45)
    let path = NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control)
    NoteTheme.surfaceCard.setFill()
    path.fill()
    NoteTheme.hairline.setStroke()
    path.stroke()
  }
}

/// Media blocks resolve their stored URL (an attachment or a web address) before showing it.
class NoteMediaBlockView: NoteBlockView {
  var capture: NoteMediaCaptureView?
  private var resolvedFor: String?
  private var resolveTask: Task<Void, Never>?
  var resolvedURL: URL?
  var loadError: String?
  /// An attachment with no resolver yet: shown as a quiet placeholder, not an error.
  var awaitingResolver = false

  /// The placeholder card for media that has not loaded.
  func drawPlaceholder(height: CGFloat, symbol: String) {
    let rect = NSRect(x: 0, y: 6, width: min(bounds.width, 480), height: height)
    NoteTheme.surfaceSoft.setFill()
    NSBezierPath(roundedRect: rect, xRadius: Radius.control, yRadius: Radius.control).fill()
    if let icon = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 18, weight: .regular)) {
      icon.noteTinted(NoteTheme.inkMuted.withAlphaComponent(0.7)).draw(in: NSRect(x: rect.midX - 11, y: rect.midY - 18, width: 22, height: 20))
    }
    let name = (block.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? "") as NSString
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    style.lineBreakMode = .byTruncatingMiddle
    name.draw(in: NSRect(x: rect.minX + 12, y: rect.midY + 8, width: rect.width - 24, height: 18),
              withAttributes: [.font: NoteTheme.ui(12), .foregroundColor: NoteTheme.inkMuted, .paragraphStyle: style])
  }

  var storedURL: String { block.string("url") ?? "" }
  var caption: String { block.string("caption") ?? "" }

  /// Starts resolving the stored URL when it changed.
  func resolveIfNeeded() {
    let stored = storedURL
    let isAttachment = stored.hasPrefix("manor-attachment://")
    let canResolve = !isAttachment || controller?.services.resolveAttachment != nil
    // A resolver arriving later resolves again.
    let key = "\(stored)|\(canResolve)"
    guard key != resolvedFor else { return }
    resolvedFor = key
    resolvedURL = nil
    loadError = nil
    resolveTask?.cancel()
    awaitingResolver = !canResolve
    guard !stored.isEmpty, canResolve, let controller else { mediaDidResolve(); return }
    resolveTask = Task { [weak self] in
      do {
        let url = try await controller.resolveURL(stored)
        guard !Task.isCancelled, let self, self.resolvedFor == key else { return }
        self.resolvedURL = url
        self.mediaDidResolve()
      } catch {
        guard !Task.isCancelled, let self, self.resolvedFor == key else { return }
        self.loadError = error.localizedDescription
        self.mediaDidResolve()
      }
    }
  }

  /// Forces the next `resolveIfNeeded` to resolve again (retry).
  func resetResolution() { resolvedFor = nil }

  func mediaDidResolve() { needsDisplay = true; needsLayout = true }

  func ensureCapture(symbol: String, uploadTitle: String, linkPlaceholder: String, uploadKind: NoteUploadKind) {
    let editable = isEditable
    if storedURL.isEmpty && editable {
      if capture == nil {
        let view = NoteMediaCaptureView(symbol: symbol, uploadTitle: uploadTitle, linkPlaceholder: linkPlaceholder)
        view.controller = controller
        view.allowsUpload = controller?.services.uploadAttachment != nil
        view.onUpload = { [weak self] in
          guard let self else { return }
          self.controller?.chooseAndUpload(for: self.block.id, kind: uploadKind)
        }
        view.onLink = { [weak self] url in
          guard let self else { return }
          self.controller?.updateProps(self.block.id, ["url": .string(url.absoluteString), "name": .string(url.lastPathComponent)])
        }
        addSubview(view)
        capture = view
      }
      capture?.setUploadTitle(controller?.isUploading(block.id) == true ? "Uploading" : uploadTitle)
      capture?.showError(controller?.uploadError(for: block.id))
    } else if let capture {
      // Once the block has its media, the caret leaves the link field and the block stays selected.
      let hadFocus = (window?.firstResponder as? NSView)?.isDescendant(of: capture) ?? false
      capture.removeFromSuperview()
      self.capture = nil
      if hadFocus { let id = block.id; DispatchQueue.main.async { [weak self] in self?.controller?.selectBlocks([id]) } }
    }
  }

  override func layout() {
    super.layout()
    capture?.frame = NSRect(x: 0, y: 4, width: bounds.width, height: 62)
  }

  func drawEmptyReadOnly(_ text: String) {
    let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.inkMuted]
    (text as NSString).draw(at: NSPoint(x: 0, y: 12), withAttributes: attributes)
  }

  func drawCaption(at y: CGFloat, alignment: NSTextAlignment = .center) {
    guard !caption.isEmpty else { return }
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    (caption as NSString).draw(in: NSRect(x: 0, y: y + 6, width: bounds.width, height: 20),
                               withAttributes: [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.inkMuted, .paragraphStyle: style])
  }

  func drawError(at y: CGFloat) {
    guard let loadError else { return }
    (loadError as NSString).draw(at: NSPoint(x: 0, y: y), withAttributes: [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.error])
  }
}

enum NoteUploadKind {
  case image, video, audio, file
  var contentTypes: [String] {
    switch self {
    case .image: ["public.image"]
    case .video: ["public.movie"]
    case .audio: ["public.audio"]
    case .file: []
    }
  }
}

// MARK: - Image

final class NoteImageBlockView: NoteMediaBlockView {
  private var image: NSImage?
  private var hovering = false
  private var trackingArea: NSTrackingArea?
  private var liveWidth: CGFloat?
  private let editButton = NSButton()

  override func setUp() {
    editButton.image = NSImage(systemSymbolName: "pencil", accessibilityDescription: "Edit image")
    editButton.bezelStyle = .accessoryBarAction
    editButton.isBordered = true
    editButton.toolTip = "Edit image"
    editButton.target = self
    editButton.action = #selector(edit)
    editButton.isHidden = true
    addSubview(editButton)
  }

  @objc private func edit() { controller?.requestImageEdit(block.id) }

  override var handleAnchorY: CGFloat { storedURL.isEmpty ? 27 : 16 }

  override func blockDidChange(from previous: NoteBlock?) {
    ensureCapture(symbol: "photo", uploadTitle: "Upload image", linkPlaceholder: "Paste an image link", uploadKind: .image)
    setAccessibilityElement(!storedURL.isEmpty)
    setAccessibilityRole(.image)
    setAccessibilityLabel((block.string("alt").flatMap { $0.isEmpty ? nil : $0 }) ?? (caption.isEmpty ? "Image" : caption))
    resolveIfNeeded()
    reportHeight()
    needsDisplay = true
  }

  override func mediaDidResolve() {
    guard let url = resolvedURL else {
      image = nil
      reportHeight()
      needsDisplay = true
      return
    }
    if let cached = NoteImageLoader.shared.cached(url) {
      image = cached
      reportHeight()
      needsDisplay = true
      return
    }
    Task { [weak self] in
      do {
        let loaded = try await NoteImageLoader.shared.image(for: url)
        guard let self, self.resolvedURL == url else { return }
        self.image = loaded
      } catch {
        guard let self else { return }
        self.loadError = error.localizedDescription
      }
      self?.reportHeight()
      self?.needsDisplay = true
    }
  }

  private var aspect: CGFloat {
    switch block.string("crop") ?? "original" {
    case "square": return 1
    case "landscape": return 16.0 / 9.0
    case "portrait": return 3.0 / 4.0
    default:
      guard let image, image.size.height > 0 else { return 16.0 / 10.0 }
      return image.size.width / image.size.height
    }
  }

  private var imageRect: NSRect {
    let maxWidth = bounds.width
    let stored = block.props["previewWidth"]?.double.map { CGFloat($0) }
    let width = min(maxWidth, max(80, liveWidth ?? stored ?? min(maxWidth, image.map { $0.size.width } ?? maxWidth)))
    let height = width / aspect
    let x: CGFloat = switch block.string("textAlignment") {
    case "center": (maxWidth - width) / 2
    case "right": maxWidth - width
    default: 0
    }
    return NSRect(x: x, y: 6, width: width, height: height)
  }

  private func reportHeight() {
    let height: CGFloat
    if storedURL.isEmpty {
      height = isEditable ? 70 : 36
    } else if image != nil {
      height = imageRect.height + 12 + (caption.isEmpty ? 0 : 26) + (loadError == nil ? 0 : 20)
    } else if loadError != nil {
      height = 64
    } else {
      height = 160
    }
    controller?.reportHeight(block.id, height)
  }

  override func layout() {
    super.layout()
    let rect = imageRect
    editButton.frame = NSRect(x: rect.maxX - 34, y: rect.minY + 8, width: 26, height: 22)
    editButton.isHidden = !(hovering && image != nil && isEditable)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { hovering = true; needsLayout = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hovering = false; needsLayout = true; needsDisplay = true; NSCursor.arrow.set() }

  private func resizeEdge(at point: NSPoint) -> CGFloat? {
    guard image != nil, isEditable else { return nil }
    let rect = imageRect
    guard point.y > rect.minY + 10, point.y < rect.maxY - 10 else { return nil }
    if abs(point.x - rect.minX) < 7 { return -1 }
    if abs(point.x - rect.maxX) < 7 { return 1 }
    return nil
  }

  override func mouseMoved(with event: NSEvent) {
    if resizeEdge(at: convert(event.locationInWindow, from: nil)) != nil { NSCursor.resizeLeftRight.set() } else { NSCursor.arrow.set() }
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if let edge = resizeEdge(at: point), let window {
      let start = imageRect
      let centered = block.string("textAlignment") == "center"
      while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
        let x = convert(next.locationInWindow, from: nil).x
        let delta = (x - point.x) * edge * (centered ? 2 : 1)
        liveWidth = min(bounds.width, max(80, start.width + delta))
        reportHeight()
        needsDisplay = true
        needsLayout = true
        if next.type == .leftMouseUp { break }
      }
      if let width = liveWidth {
        liveWidth = nil
        controller?.updateProps(block.id, ["previewWidth": .number(Double(width.rounded()))])
      }
      return
    }
    if event.clickCount == 2, image != nil, isEditable {
      controller?.requestImageEdit(block.id)
      return
    }
    controller?.selectBlocks([block.id])
  }

  override func draw(_ dirtyRect: NSRect) {
    if storedURL.isEmpty {
      if !isEditable { drawEmptyReadOnly("Empty image") }
      return
    }
    guard let image else {
      if loadError != nil {
        drawError(at: 10)
        ("Replace the file or check its link." as NSString).draw(at: NSPoint(x: 0, y: 32), withAttributes: [.font: NoteTheme.ui(12), .foregroundColor: NoteTheme.inkMuted])
      } else {
        drawPlaceholder(height: 148, symbol: "photo")
      }
      return
    }
    let rect = imageRect
    let source = cropSource(for: image, target: rect.size)
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(roundedRect: rect, xRadius: Radius.chip, yRadius: Radius.chip).addClip()
    image.draw(in: rect, from: source, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    NSGraphicsContext.restoreGraphicsState()
    if hovering && isEditable {
      NoteTheme.ink.withAlphaComponent(0.35).setFill()
      for x in [rect.minX + 4, rect.maxX - 7] {
        NSBezierPath(roundedRect: NSRect(x: x, y: rect.midY - 18, width: 3, height: 36), xRadius: 1.5, yRadius: 1.5).fill()
      }
    }
    let alignment: NSTextAlignment = block.string("textAlignment") == "left" ? .left : .center
    if !caption.isEmpty {
      let style = NSMutableParagraphStyle()
      style.alignment = alignment == .left ? .left : .center
      (caption as NSString).draw(in: NSRect(x: rect.minX, y: rect.maxY + 6, width: rect.width, height: 20),
                                 withAttributes: [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.inkMuted, .paragraphStyle: style])
    }
  }

  /// The part of the image shown for a crop: cover the target aspect, centered on the focal point.
  private func cropSource(for image: NSImage, target: NSSize) -> NSRect {
    let size = image.size
    guard (block.string("crop") ?? "original") != "original", size.width > 0, size.height > 0, target.height > 0 else {
      return NSRect(origin: .zero, size: size)
    }
    let targetAspect = target.width / target.height
    let imageAspect = size.width / size.height
    let focalX = CGFloat(block.props["focalX"]?.double ?? 50) / 100
    let focalY = CGFloat(block.props["focalY"]?.double ?? 50) / 100
    if imageAspect > targetAspect {
      let width = size.height * targetAspect
      return NSRect(x: (size.width - width) * focalX, y: 0, width: width, height: size.height)
    }
    let height = size.width / targetAspect
    // Image coordinates run bottom-up; focal Y counts from the top.
    return NSRect(x: 0, y: (size.height - height) * (1 - focalY), width: size.width, height: height)
  }

  override func appearanceDidChange() { needsDisplay = true }

  /// The image currently shown, for the image dialog's preview.
  var currentImage: NSImage? { image }
}

// MARK: - Video and audio

final class NoteAVBlockView: NoteMediaBlockView {
  private var playerView: AVPlayerView?
  private var isAudio: Bool { block.kind == .audio }

  override var handleAnchorY: CGFloat { storedURL.isEmpty ? 27 : 18 }

  override func blockDidChange(from previous: NoteBlock?) {
    ensureCapture(symbol: isAudio ? "waveform" : "play.rectangle", uploadTitle: isAudio ? "Upload audio" : "Upload video",
                  linkPlaceholder: isAudio ? "Paste an audio link" : "Paste a video link", uploadKind: isAudio ? .audio : .video)
    resolveIfNeeded()
    reportHeight()
  }

  override func mediaDidResolve() {
    if let url = resolvedURL {
      if playerView == nil {
        let view = AVPlayerView()
        view.controlsStyle = .inline
        view.showsFullScreenToggleButton = !isAudio
        view.wantsLayer = true
        view.layer?.cornerRadius = Radius.chip
        view.layer?.masksToBounds = true
        addSubview(view)
        playerView = view
      }
      if (playerView?.player?.currentItem?.asset as? AVURLAsset)?.url != url {
        playerView?.player = AVPlayer(url: url)
      }
    } else {
      playerView?.player = nil
      playerView?.removeFromSuperview()
      playerView = nil
    }
    reportHeight()
    needsLayout = true
    needsDisplay = true
  }

  private var playerHeight: CGFloat { isAudio ? 46 : min(bounds.width, 720) * 9 / 16 }

  private func reportHeight() {
    let height: CGFloat
    if storedURL.isEmpty {
      height = isEditable ? 70 : 36
    } else if loadError != nil {
      height = 40
    } else {
      height = playerHeight + 12 + (caption.isEmpty ? 0 : 26)
    }
    controller?.reportHeight(block.id, height)
  }

  override func layout() {
    super.layout()
    let width = isAudio ? bounds.width : min(bounds.width, 720)
    playerView?.frame = NSRect(x: 0, y: 6, width: width, height: playerHeight)
    reportHeight()
  }

  override func draw(_ dirtyRect: NSRect) {
    if storedURL.isEmpty {
      if !isEditable { drawEmptyReadOnly(isAudio ? "Empty audio" : "Empty video") }
      return
    }
    if loadError != nil { drawError(at: 10); return }
    if playerView == nil {
      drawPlaceholder(height: playerHeight, symbol: isAudio ? "waveform" : "play.rectangle")
    }
    drawCaption(at: 6 + playerHeight, alignment: .left)
  }

  override func mouseDown(with event: NSEvent) { controller?.selectBlocks([block.id]) }
}

// MARK: - File

final class NoteFileBlockView: NoteMediaBlockView {
  private var hovering = false
  private var trackingArea: NSTrackingArea?
  override var handleAnchorY: CGFloat { storedURL.isEmpty ? 27 : 26 }

  override func blockDidChange(from previous: NoteBlock?) {
    ensureCapture(symbol: "paperclip", uploadTitle: "Upload file", linkPlaceholder: "Paste a file link", uploadKind: .file)
    controller?.reportHeight(block.id, storedURL.isEmpty ? (isEditable ? 70 : 36) : (caption.isEmpty ? 52 : 70))
    needsDisplay = true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect, .cursorUpdate], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hovering = false; needsDisplay = true }
  override func cursorUpdate(with event: NSEvent) { if !storedURL.isEmpty { NSCursor.pointingHand.set() } }

  override func mouseDown(with event: NSEvent) {
    guard !storedURL.isEmpty else { return }
    if event.clickCount == 1 {
      controller?.selectBlocks([block.id])
      controller?.openAttachment(storedURL)
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    if storedURL.isEmpty {
      if !isEditable { drawEmptyReadOnly("Empty file") }
      return
    }
    let row = NSRect(x: 0, y: 6, width: bounds.width, height: 40)
    if hovering {
      NoteTheme.surfaceHover.setFill()
      NSBezierPath(roundedRect: row, xRadius: Radius.chip, yRadius: Radius.chip).fill()
    }
    if let icon = NSImage(systemSymbolName: "doc", accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 15, weight: .regular)) {
      icon.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: 10, y: row.midY - 9, width: 15, height: 18))
    }
    let name = (block.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? URL(string: storedURL)?.lastPathComponent ?? "File") as NSString
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingMiddle
    name.draw(in: NSRect(x: 34, y: row.midY - 10, width: bounds.width - 60, height: 20),
              withAttributes: [.font: NoteTheme.ui(15, .medium), .foregroundColor: NoteTheme.inkBody, .paragraphStyle: style])
    if hovering, let open = NSImage(systemSymbolName: "arrow.up.right", accessibilityDescription: "Open") {
      open.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: bounds.width - 24, y: row.midY - 6, width: 12, height: 12))
    }
    drawCaption(at: row.maxY - 6, alignment: .left)
  }
}

// MARK: - Web bookmark and embed

final class NoteWebBlockView: NoteBlockView, NSTextFieldDelegate, WKNavigationDelegate, WKUIDelegate {
  private var capture: NoteMediaCaptureView?
  private let titleField = NSTextField()
  private let hostLabel = NSTextField(labelWithString: "")
  private let openButton = NSButton()
  private var webView: WKWebView?
  private var loadedURL: URL?

  private var url: URL? {
    guard let value = block.string("url"), let url = URL(string: value), let scheme = url.scheme?.lowercased(),
          scheme == "https" || scheme == "http", url.host != nil else { return nil }
    return url
  }

  private var isEmbed: Bool { block.kind == .webEmbed }
  override var handleAnchorY: CGFloat { url == nil ? 27 : (isEmbed ? 18 : 34) }

  override func setUp() {
    titleField.isBordered = false
    titleField.drawsBackground = false
    titleField.focusRingType = .none
    titleField.font = NoteTheme.ui(isEmbed ? 13 : 15, .semibold)
    titleField.textColor = NoteTheme.inkBody
    titleField.delegate = self
    titleField.lineBreakMode = .byTruncatingTail
    titleField.cell?.truncatesLastVisibleLine = true
    addSubview(titleField)
    hostLabel.font = NoteTheme.ui(12)
    hostLabel.textColor = NoteTheme.inkMuted
    hostLabel.lineBreakMode = .byTruncatingTail
    addSubview(hostLabel)
    openButton.image = NSImage(systemSymbolName: "arrow.up.right.square", accessibilityDescription: "Open in browser")
    openButton.isBordered = false
    openButton.contentTintColor = NoteTheme.inkMuted
    openButton.toolTip = "Open in browser"
    openButton.target = self
    openButton.action = #selector(openExternally)
    addSubview(openButton)
  }

  override func blockDidChange(from previous: NoteBlock?) {
    let editable = isEditable
    if url == nil {
      if editable && capture == nil {
        let view = NoteMediaCaptureView(symbol: "link", uploadTitle: "", linkPlaceholder: "Paste an https:// link")
        view.controller = controller
        view.allowsUpload = false
        view.onLink = { [weak self] url in
          guard let self else { return }
          self.controller?.updateProps(self.block.id, ["url": .string(url.absoluteString), "title": .string(url.host ?? url.absoluteString)])
        }
        addSubview(view)
        capture = view
      }
    } else if let capture {
      // Once the block has its media, the caret leaves the link field and the block stays selected.
      let hadFocus = (window?.firstResponder as? NSView)?.isDescendant(of: capture) ?? false
      capture.removeFromSuperview()
      self.capture = nil
      if hadFocus { let id = block.id; DispatchQueue.main.async { [weak self] in self?.controller?.selectBlocks([id]) } }
    }
    let hasURL = url != nil
    titleField.isHidden = !hasURL
    hostLabel.isHidden = !hasURL || isEmbed
    openButton.isHidden = !hasURL
    titleField.isEditable = editable
    titleField.isSelectable = true
    if titleField.currentEditor() == nil {
      titleField.stringValue = block.string("title").flatMap { $0.isEmpty ? nil : $0 } ?? url?.host ?? ""
    }
    titleField.placeholderString = url?.host
    hostLabel.stringValue = url?.host ?? ""
    if isEmbed, let url {
      if webView == nil {
        let configuration = WKWebViewConfiguration()
        // Sandboxed like the React iframe: no persistent data, no Manor bridge, popups go to the browser.
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.wantsLayer = true
        view.layer?.cornerRadius = 0
        addSubview(view)
        webView = view
      }
      if loadedURL != url {
        loadedURL = url
        var request = URLRequest(url: url)
        request.setValue(nil, forHTTPHeaderField: "Referer")
        webView?.load(request)
      }
    } else {
      webView?.removeFromSuperview()
      webView = nil
      loadedURL = nil
    }
    needsLayout = true
    needsDisplay = true
  }

  @objc private func openExternally() {
    if let url { controller?.openExternal(url) }
  }

  func controlTextDidEndEditing(_ obj: Notification) {
    let title = titleField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if title != (block.string("title") ?? "") { controller?.updateProps(block.id, ["title": .string(title)]) }
  }

  override func layout() {
    super.layout()
    capture?.frame = NSRect(x: 0, y: 4, width: bounds.width, height: 62)
    if isEmbed {
      let head = NSRect(x: 0, y: 4, width: bounds.width, height: 36)
      titleField.frame = NSRect(x: 34, y: head.midY - 9, width: bounds.width - 80, height: 18)
      openButton.frame = NSRect(x: bounds.width - 34, y: head.midY - 12, width: 26, height: 24)
      webView?.frame = NSRect(x: 1, y: head.maxY, width: bounds.width - 2, height: max(0, bounds.height - head.maxY - 5))
    } else {
      let card = NSRect(x: 0, y: 4, width: bounds.width, height: bounds.height - 8)
      titleField.frame = NSRect(x: 42, y: card.minY + 12, width: bounds.width - 92, height: 20)
      hostLabel.frame = NSRect(x: 44, y: card.minY + 34, width: bounds.width - 94, height: 16)
      openButton.frame = NSRect(x: bounds.width - 40, y: card.midY - 13, width: 28, height: 26)
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    guard url != nil else {
      if !isEditable {
        ((isEmbed ? "Empty embed" : "Empty bookmark") as NSString).draw(at: NSPoint(x: 0, y: 12), withAttributes: [.font: NoteTheme.ui(13), .foregroundColor: NoteTheme.inkMuted])
      }
      return
    }
    let card = NSRect(x: 0.5, y: 4.5, width: bounds.width - 1, height: bounds.height - 9)
    let path = NSBezierPath(roundedRect: card, xRadius: Radius.control, yRadius: Radius.control)
    (isEmbed ? NoteTheme.surfaceSoft : NoteTheme.surfaceCard).setFill()
    path.fill()
    NoteTheme.hairline.setStroke()
    path.stroke()
    let globe = NSImage(systemSymbolName: "globe", accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: isEmbed ? 13 : 16, weight: .regular))
    if isEmbed {
      globe?.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: 12, y: 15, width: 14, height: 14))
      NoteTheme.hairline.setFill()
      NSRect(x: 1, y: 40, width: bounds.width - 2, height: 1).fill()
    } else {
      globe?.noteTinted(NoteTheme.inkMuted).draw(in: NSRect(x: 14, y: card.midY - 9, width: 18, height: 18))
    }
  }

  override func mouseDown(with event: NSEvent) { controller?.selectBlocks([block.id]) }

  // Navigation inside the embed stays inside; anything that asks for a new window opens in the browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url { controller?.openExternal(url) }
    return nil
  }
}

// MARK: - Equation block

final class NoteMathBlockView: NoteBlockView {
  let sourceView = NoteTextView.make()
  private var rendered: NoteMath.Rendered?
  private var renderedLatex: String?
  private var renderedContent: NoteBlockContent?
  private var hovering = false
  private var trackingArea: NSTrackingArea?

  override var primaryTextView: NoteTextView? { (controller?.isEditingMath(block.id) ?? false) ? sourceView : nil }
  override var handleAnchorY: CGFloat { 22 }

  override func setUp() {
    sourceView.controller = controller
    sourceView.blockID = block.id
    sourceView.role = .mathSource
    sourceView.delegate = controller
    sourceView.setPlain(true)
    sourceView.placeholder = "Write LaTeX, for example \\frac{a}{b}"
    sourceView.placeholderFont = NoteTheme.mono(13.5)
    addSubview(sourceView)
  }

  override func blockDidChange(from previous: NoteBlock?) {
    sourceView.blockID = block.id
    sourceView.isEditable = isEditable
    if renderedContent != block.content {
      let style = NoteTextStyle.for(block)
      if !sourceView.isFocused {
        sourceView.textStorage?.setAttributedString(NoteInlineText.plainAttributedString(block.plainText, style: style))
      }
      sourceView.typingAttributes = style.baseAttributes
      renderedContent = block.content
    }
    renderEquation()
    sourceView.isHidden = !(controller?.isEditingMath(block.id) ?? false)
    needsLayout = true
    needsDisplay = true
  }

  func acceptEditedContent(_ content: NoteBlockContent) { renderedContent = content }

  private func renderEquation() {
    let latex = block.plainText
    guard latex != renderedLatex || rendered == nil else { return }
    renderedLatex = latex
    rendered = NoteMath.render(latex, fontSize: 19, color: NoteTheme.ink, display: true)
  }

  override func appearanceDidChange() {
    renderedLatex = nil
    renderEquation()
    needsDisplay = true
  }

  private var renderHeight: CGFloat { (rendered?.image.size.height ?? 22) + 28 }

  override func layout() {
    super.layout()
    let top = renderHeight
    sourceView.frame = NSRect(x: 16, y: top + 10, width: max(20, bounds.width - 32), height: max(20, bounds.height - top - 22))
    sourceView.textContainer?.size = NSSize(width: sourceView.frame.width, height: CGFloat.greatestFiniteMagnitude)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hovering = false; needsDisplay = true }

  override func mouseDown(with event: NSEvent) {
    guard isEditable else { controller?.selectBlocks([block.id]); return }
    controller?.setMathEditing(block.id, true)
  }

  override func draw(_ dirtyRect: NSRect) {
    let editing = controller?.isEditingMath(block.id) ?? false
    let area = NSRect(x: 0, y: 2, width: bounds.width, height: renderHeight - 4)
    if hovering || editing {
      NoteTheme.surfaceHover.withAlphaComponent(editing ? 0.6 : 0.45).setFill()
      NSBezierPath(roundedRect: editing ? bounds.insetBy(dx: 0, dy: 2) : area, xRadius: Radius.control, yRadius: Radius.control).fill()
    }
    if let rendered {
      let size = rendered.image.size
      rendered.image.draw(in: NSRect(x: (bounds.width - size.width) / 2, y: area.midY - size.height / 2, width: size.width, height: size.height),
                          from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    } else {
      let text = (block.plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Add an equation" : "This equation has an error") as NSString
      let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(14), .foregroundColor: block.plainText.isEmpty ? NoteTheme.inkMuted : NoteTheme.error]
      let size = text.size(withAttributes: attributes)
      text.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: area.midY - size.height / 2), withAttributes: attributes)
    }
    if editing {
      NoteTheme.hairline.setFill()
      NSRect(x: 12, y: renderHeight + 2, width: bounds.width - 24, height: 1).fill()
    }
  }
}
