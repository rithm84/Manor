import Alfred
import AppKit
import ManorKit
import UniformTypeIdentifiers

/// An image attached to an Alfred request, downscaled and encoded the way Alfred accepts it (PNG or JPEG,
/// about 2048 px on the long edge, within Alfred's size cap).
struct NoteAlfredImage: Identifiable, Equatable {
  let id = UUID()
  let data: Data
  let mimeType: String
  let thumbnail: NSImage
  /// The note attachment holding the image once uploaded (`manor-attachment://…`).
  var stableURL: String?

  static func == (lhs: NoteAlfredImage, rhs: NoteAlfredImage) -> Bool { lhs.id == rhs.id && lhs.stableURL == rhs.stableURL }

  static let longEdge: CGFloat = 2048

  /// Downscales and encodes an image. Images with transparency stay PNG; others become JPEG, lowering quality
  /// until they fit Alfred's per-image cap.
  @MainActor static func make(from image: NSImage) -> NoteAlfredImage? {
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let width = CGFloat(cg.width), height = CGFloat(cg.height)
    guard width > 0, height > 0 else { return nil }
    let scale = min(1, longEdge / max(width, height))
    let target = NSSize(width: max(1, (width * scale).rounded()), height: max(1, (height * scale).rounded()))
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(target.width), pixelsHigh: Int(target.height), bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    NSImage(cgImage: cg, size: target).draw(in: NSRect(origin: .zero, size: target))
    NSGraphicsContext.restoreGraphicsState()
    let hasAlpha = cg.alphaInfo != .none && cg.alphaInfo != .noneSkipFirst && cg.alphaInfo != .noneSkipLast
    var data: Data?
    var mime = "image/jpeg"
    if hasAlpha, let png = rep.representation(using: .png, properties: [:]), png.count <= AlfredWriter.maxImageBytes {
      data = png
      mime = "image/png"
    } else {
      for quality in [0.85, 0.7, 0.55, 0.4] {
        if let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]), jpeg.count <= AlfredWriter.maxImageBytes {
          data = jpeg
          break
        }
      }
    }
    guard let data else { return nil }
    let thumbnail = NSImage(size: target)
    thumbnail.addRepresentation(rep)
    return NoteAlfredImage(data: data, mimeType: mime, thumbnail: thumbnail)
  }

  @MainActor static func make(fromFile url: URL) -> NoteAlfredImage? {
    guard let image = NSImage(contentsOf: url) else { return nil }
    return make(from: image)
  }

  var fileExtension: String { mimeType == "image/png" ? "png" : "jpg" }
}

/// One turn of an Alfred conversation: a prompt and the images sent with it.
struct NoteAlfredTurn: Equatable {
  var prompt: String
  var images: [NoteAlfredImage] = []
}

/// What a request does with the note.
enum NoteAlfredPurpose: Equatable {
  /// New content in a new Alfred block.
  case insert
  /// A revision of an Alfred block: the reply is its complete new content.
  case refineBlock
  /// A replacement for selected text inside one block: the reply is inline text.
  case rewriteInline
  /// A replacement for selected blocks: the reply is blocks.
  case rewriteBlocks
}

/// What the note around the block says.
struct NoteAlfredContext: Equatable {
  var title: String
  var before: String
  var after: String
  var history: [NoteAlfredTurn]
  /// The block's current content when refining it, or the preview's when refining a selection rewrite.
  var currentSource: String?
  /// The selected content as Markdown, for selection rewrites.
  var selection: String?
  var purpose: NoteAlfredPurpose = .insert
}

/// The writing service behind `/alfred`. The app uses Alfred's writer; tests script one.
@MainActor
protocol NoteAlfredWriting: AnyObject {
  var isAvailable: Bool { get }
  var modelName: String { get }
  func write(_ turn: NoteAlfredTurn, in context: NoteAlfredContext) -> AsyncThrowingStream<String, Error>
}

/// Adapts Alfred's writer to the editor.
@MainActor
final class NoteAlfredWriterAdapter: NoteAlfredWriting {
  static let shared = NoteAlfredWriterAdapter()

  var isAvailable: Bool { AlfredWriter.shared.isAvailable }
  var modelName: String { AlfredWriter.shared.modelName }

  func write(_ turn: NoteAlfredTurn, in context: NoteAlfredContext) -> AsyncThrowingStream<String, Error> {
    func images(_ items: [NoteAlfredImage]) -> [AlfredImage] { items.compactMap { AlfredImage(data: $0.data, mimeType: $0.mimeType) } }
    let purpose: AlfredWriter.Purpose = switch context.purpose {
    case .insert: .insert
    case .refineBlock: .refineBlock
    case .rewriteInline: .rewriteSelection(.inline)
    case .rewriteBlocks: .rewriteSelection(.blocks)
    }
    let document = AlfredWriter.DocumentContext(
      title: context.title, before: context.before, after: context.after, selection: context.selection,
      history: context.history.map { AlfredWriter.Turn(prompt: $0.prompt, images: images($0.images)) },
      currentSource: context.currentSource, purpose: purpose)
    return AlfredWriter.shared.write(turn.prompt, images: images(turn.images), in: document)
  }

  /// Whether an error means Alfred has no key, so the block offers Settings.
  static func isNotConfigured(_ error: Error) -> Bool {
    (error as? AlfredWriter.WriterError) == .notConfigured
  }
}

/// What opens the Alfred composer: a new block at an anchor, or a change to an existing block.
struct NoteAlfredComposerRequest: Identifiable, Equatable {
  enum Target: Equatable {
    /// Insert a new Alfred block where `/alfred` was typed (replacing that block when it is empty).
    case insert(anchorID: String)
    /// Rewrite an existing Alfred block.
    case refine(blockID: String)
    /// Rewrite the selection (text in one block, or whole blocks) through a preview.
    case rewrite(NoteAlfredSelection)
    /// Change the preview of a selection rewrite before applying it.
    case refinePreview
  }

  let id = UUID()
  let target: Target
  let noteTitle: String
  /// The block's earlier prompts, oldest first (refinement only).
  let earlierRequests: [String]

  var isRefinement: Bool {
    switch target {
    case .refine, .refinePreview: return true
    default: return false
    }
  }

  var isSelection: Bool {
    switch target {
    case .rewrite, .refinePreview: return true
    default: return false
    }
  }
}

/// A generation in flight (or one that failed) for an Alfred block. Status is view state, never stored.
@MainActor
final class NoteAlfredRun {
  enum Phase: Equatable {
    case thinking
    case streaming
    case failed(message: String, needsKey: Bool)
  }

  let blockID: String
  var phase: Phase = .thinking
  var turn: NoteAlfredTurn
  var context: NoteAlfredContext
  var buffer = ""
  var task: Task<Void, Never>?
  var uploads: Task<[String], Never>?
  /// Restores what the document was before this run, for its single undo step.
  let undoPatch: ([NoteBlock]) -> [NoteBlock]
  let focusBefore: NoteFocus
  var flushScheduled = false
  var committed = false

  init(blockID: String, turn: NoteAlfredTurn, context: NoteAlfredContext, focusBefore: NoteFocus, undoPatch: @escaping ([NoteBlock]) -> [NoteBlock]) {
    self.blockID = blockID
    self.turn = turn
    self.context = context
    self.focusBefore = focusBefore
    self.undoPatch = undoPatch
  }

  var isActive: Bool { phase == .thinking || phase == .streaming }
}

/// What the reader selected for Alfred to rewrite.
enum NoteAlfredSelection: Equatable {
  /// A range of a block's displayed text.
  case inline(blockID: String, range: NSRange)
  /// Whole blocks, outermost first in document order.
  case blocks([String])

  /// The block the preview goes under.
  var anchorID: String? {
    switch self {
    case .inline(let blockID, _): return blockID
    case .blocks(let ids): return ids.last
    }
  }
}

/// A selection rewrite in progress: the preview's content and its conversation. Nothing in the note changes
/// until it is applied.
@MainActor
final class NoteAlfredSelectionEdit {
  static let previewID = "__alfred-preview"

  let selection: NoteAlfredSelection
  /// The selected content as Markdown, sent with every turn.
  let selectionMarkdown: String
  var turns: [NoteAlfredTurn] = []
  var source = ""
  var phase: NoteAlfredRun.Phase?
  var task: Task<Void, Never>?
  var flushScheduled = false

  init(selection: NoteAlfredSelection, selectionMarkdown: String) {
    self.selection = selection
    self.selectionMarkdown = selectionMarkdown
  }

  var isRunning: Bool { phase == .thinking || phase == .streaming }

  /// The preview as a block the layout can render.
  var previewBlock: NoteBlock {
    NoteBlock(id: Self.previewID, type: "alfred", props: ["source": .string(source),
                                                          "requests": .array(turns.map { NoteAlfredRequest(prompt: $0.prompt).json }), "model": ""],
              content: .absent)
  }
}
