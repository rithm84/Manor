import Alfred
import AppKit
import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// The Alfred composer: a centered dialog for writing a request, with images by drag and drop, paste, or the
/// "+" button. Return sends, Shift-Return adds a line, Escape closes.
struct NoteAlfredComposer: View {
  let request: NoteAlfredComposerRequest
  let onSend: (String, [NoteAlfredImage]) -> Void
  let onClose: () -> Void

  @State private var prompt = ""
  @State private var images: [NoteAlfredImage] = []
  @State private var notice: String?
  @State private var dropTargeted = false

  private var placeholder: String {
    switch request.target {
    case .insert: return "Ask Alfred to write anything: an explanation, a diagram, a table"
    case .refine: return "Describe the change, for example: make the diagram left to right"
    case .rewrite: return "Describe how to change the selection, or pick a suggestion"
    case .refinePreview: return "Describe the change, for example: more casual"
    }
  }

  private var canSend: Bool { !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty }

  var body: some View {
    DialogPanel(title, onClose: onClose) {
      VStack(alignment: .leading, spacing: Space.s3) {
        Text(destination)
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkMuted)
        if case .rewrite = request.target {
          // One click sends a common request.
          FlowChips(items: NoteEditorController.alfredSelectionSuggestions) { suggestion in
            onSend(suggestion, images)
          }
        }
        if request.isRefinement, !request.earlierRequests.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("Earlier requests").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
            ForEach(Array(request.earlierRequests.enumerated()), id: \.offset) { _, earlier in
              HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "sparkles").font(.system(size: 10)).foregroundStyle(Palette.inkMuted)
                Text(earlier).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).lineLimit(2)
              }
            }
          }
          .padding(Space.s3)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        }
        NoteComposerTextField(text: $prompt,
                              placeholder: placeholder,
                              onSubmit: send, onCancel: onClose, onImages: add)
          .frame(minHeight: 96, maxHeight: 220)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCanvas))
          .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
            .strokeBorder(dropTargeted ? Palette.focusBorder : Palette.hairlineStrong, lineWidth: dropTargeted ? 1.5 : 1))
        attachments
        if let notice {
          Text(notice).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.overdueError)
        }
      }
      .onDrop(of: [.image, .fileURL], isTargeted: $dropTargeted) { providers in
        load(providers)
        return true
      }
    } footer: {
      Text("Return to send, Shift-Return for a new line")
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(Palette.inkMuted)
      Spacer()
      Button("Cancel", action: onClose).buttonStyle(.secondary)
      Button("Send", action: send).buttonStyle(.primary).disabled(!canSend)
    }
  }

  private var title: String {
    switch request.target {
    case .insert: return "Ask Alfred"
    case .refine: return "Change with Alfred"
    case .rewrite: return "Edit selection with Alfred"
    case .refinePreview: return "Change the suggestion"
    }
  }

  private var destination: String {
    let title = request.noteTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let note = title.isEmpty ? "this note" : "\u{201C}\(title)\u{201D}"
    if request.isSelection { return "Rewrites the selection in \(note). Nothing changes until you apply it." }
    return "Writes into \(note)"
  }

  private var attachments: some View {
    HStack(spacing: Space.s2) {
      ForEach(images) { image in
        Image(nsImage: image.thumbnail)
          .resizable()
          .scaledToFill()
          .frame(width: 56, height: 56)
          .clipShape(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(Palette.hairline))
          .overlay(alignment: .topTrailing) {
            Button { images.removeAll { $0.id == image.id } } label: {
              Image(systemName: "xmark.circle.fill")
                .font(.system(size: 15))
                .symbolRenderingMode(.palette)
                .foregroundStyle(Palette.onPrimary, Palette.ink.opacity(0.75))
            }
            .buttonStyle(.plain)
            .offset(x: 5, y: -5)
            .help("Remove image")
            .accessibilityLabel("Remove image")
          }
      }
      if images.count < AlfredWriter.maxImages {
        Button(action: pick) {
          Image(systemName: "plus")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Palette.inkMuted)
            .frame(width: 56, height: 56)
            .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceSoft))
            .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(Palette.hairlineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        }
        .buttonStyle(.plain)
        .help("Add images")
        .accessibilityLabel("Add images")
      }
      Spacer(minLength: 0)
    }
  }

  private func send() {
    guard canSend else { return }
    onSend(prompt, images)
  }

  /// Adds images within Alfred's limits: six per request and 16 MB in all.
  private func add(_ new: [NoteAlfredImage]) {
    notice = nil
    for image in new {
      guard images.count < AlfredWriter.maxImages else { notice = "Alfred takes up to \(AlfredWriter.maxImages) images per request."; break }
      guard images.reduce(0, { $0 + $1.data.count }) + image.data.count <= AlfredWriter.maxTotalImageBytes else {
        notice = "These images are too large together. Remove one to add another."
        break
      }
      images.append(image)
    }
  }

  private func pick() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.image]
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false
    guard panel.runModal() == .OK else { return }
    let made = panel.urls.compactMap(NoteAlfredImage.make(fromFile:))
    if made.count < panel.urls.count { notice = "Some files couldn't be read as images." }
    add(made)
  }

  private func load(_ providers: [NSItemProvider]) {
    for provider in providers {
      if provider.canLoadObject(ofClass: NSImage.self) {
        _ = provider.loadObject(ofClass: NSImage.self) { object, _ in
          guard let image = object as? NSImage else { return }
          Task { @MainActor in if let made = NoteAlfredImage.make(from: image) { add([made]) } }
        }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
          guard let url else { return }
          Task { @MainActor in if let made = NoteAlfredImage.make(fromFile: url) { add([made]) } else { notice = "That file isn't an image." } }
        }
      }
    }
  }
}

/// The composer's prompt: a multi-line text view where Return sends, Shift-Return adds a line, Escape closes,
/// and pasted images attach.
struct NoteComposerTextField: NSViewRepresentable {
  @Binding var text: String
  let placeholder: String
  let onSubmit: () -> Void
  let onCancel: () -> Void
  let onImages: ([NoteAlfredImage]) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    scroll.borderType = .noBorder
    let textView = NoteComposerTextView()
    textView.isRichText = false
    textView.allowsUndo = true
    textView.drawsBackground = false
    textView.font = NoteTheme.ui(15)
    textView.textColor = NoteTheme.ink
    textView.insertionPointColor = NoteTheme.ink
    textView.textContainerInset = NSSize(width: 8, height: 10)
    textView.isVerticallyResizable = true
    textView.isHorizontallyResizable = false
    textView.autoresizingMask = [.width]
    textView.textContainer?.widthTracksTextView = true
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.placeholder = placeholder
    textView.delegate = context.coordinator
    textView.composer = context.coordinator
    scroll.documentView = textView
    DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let textView = scroll.documentView as? NoteComposerTextView else { return }
    if textView.string != text { textView.string = text }
    textView.placeholder = placeholder
  }

  @MainActor
  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: NoteComposerTextField
    init(_ parent: NoteComposerTextField) { self.parent = parent }

    func textDidChange(_ notification: Notification) {
      guard let textView = notification.object as? NSTextView else { return }
      parent.text = textView.string
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      switch selector {
      case #selector(NSResponder.insertNewline(_:)):
        if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
          textView.insertNewlineIgnoringFieldEditor(nil)
        } else {
          parent.onSubmit()
        }
        return true
      case #selector(NSResponder.cancelOperation(_:)):
        parent.onCancel()
        return true
      default:
        return false
      }
    }
  }
}

final class NoteComposerTextView: NSTextView {
  weak var composer: NoteComposerTextField.Coordinator?
  var placeholder = "" { didSet { needsDisplay = true } }

  override func paste(_ sender: Any?) {
    let pasteboard = NSPasteboard.general
    if let files = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true,
                                                                              .urlReadingContentsConformToTypes: [UTType.image.identifier]]) as? [URL], !files.isEmpty {
      composer?.parent.onImages(files.compactMap(NoteAlfredImage.make(fromFile:)))
      return
    }
    if pasteboard.string(forType: .string) == nil, let image = NSImage(pasteboard: pasteboard), let made = NoteAlfredImage.make(from: image) {
      composer?.parent.onImages([made])
      return
    }
    pasteAsPlainText(sender)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard string.isEmpty, !placeholder.isEmpty else { return }
    let rect = NSRect(x: textContainerInset.width + (textContainer?.lineFragmentPadding ?? 0), y: textContainerInset.height,
                      width: bounds.width - textContainerInset.width * 2, height: bounds.height)
    (placeholder as NSString).draw(in: rect, withAttributes: [.font: font ?? NoteTheme.ui(15), .foregroundColor: NoteTheme.inkMuted.withAlphaComponent(0.7)])
  }

  override func didChangeText() {
    super.didChangeText()
    needsDisplay = true
  }
}

/// Suggestion chips that wrap onto as many lines as they need.
struct FlowChips: View {
  let items: [String]
  let action: (String) -> Void

  var body: some View {
    NoteFlowLayout(spacing: 6) {
      ForEach(items, id: \.self) { item in
        Button { action(item) } label: {
          Text(item)
            .font(.ui(Typography.Size.sm))
            .foregroundStyle(Palette.inkBody)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Palette.surfaceSoft, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.hairline))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }
}

/// Lays children out left to right, wrapping to new rows.
struct NoteFlowLayout: SwiftUI.Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
      x += size.width + spacing
      row = max(row, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + row)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      row = max(row, size.height)
    }
  }
}
