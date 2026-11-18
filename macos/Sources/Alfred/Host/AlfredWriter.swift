import Foundation

/// Alfred writing into a document (the Notes editor's `/alfred`). It streams Markdown meant to be inserted as
/// document content: prose, lists, tables, code, ```diagram blocks (render them with `AlfredDiagramView`), and
/// ```ui blocks (render them with `AlfredGenerativeView`). It uses the same keys and model configuration as
/// the overlay, and never captures the screen or audio.
///
/// ```swift
/// let stream = AlfredWriter.shared.write("Explain Dijkstra with a step-through",
///                                        in: .init(title: note.title, before: textAbove, after: textBelow))
/// do {
///     for try await chunk in stream { buffer += chunk }   // append as it arrives
/// } catch let error as AlfredWriter.WriterError { show(error.localizedDescription) }
/// ```
///
/// Cancel by cancelling the consuming task (or breaking out of the loop); the request stops at once.
///
/// **Refining a block.** To change an existing Alfred block ("make the diagram left to right and add a cache
/// layer"), pass the block's current content as `currentSource` and its earlier prompts as `history`. The stream
/// then carries the *complete revised content* of the block (never a diff), in the same format, so the editor
/// replaces the block's `source` with it as it streams:
///
/// ```swift
/// let context = AlfredWriter.DocumentContext(title: note.title, before: above, after: below,
///                                            history: block.requests.map { AlfredWriter.Turn(prompt: $0) },
///                                            currentSource: block.source)
/// for try await chunk in AlfredWriter.shared.write("Make it shorter", in: context) { revised += chunk }
/// ```
///
/// **Rewriting a selection.** Pass the selected content (as Markdown) in `selection` with the text around it in
/// `before` and `after`, and optionally `purpose: .rewriteSelection(.inline)` or `(.blocks)` (inferred otherwise).
/// The stream is only the replacement: inline text for a text range, blocks for selected blocks, with ```diagram
/// or ```ui only when the request asks for a visual. Preview it, then replace the selection or insert it below.
///
/// **Images.** A request (and each earlier `Turn`) can carry `AlfredImage`s: PNG or JPEG bytes the caller has
/// downscaled. They go to the model as image inputs after the text. The writer enforces `maxImages`,
/// `maxImageBytes`, and `maxTotalImageBytes`; earlier turns' images only fill what the current request leaves.
///
/// Split a finished or streaming `source` into prose, diagram, and generative-UI parts with
/// `AlfredContent.segments(of:)`, or render it whole with `AlfredContentView`.
@MainActor
public final class AlfredWriter {
    public static let shared = AlfredWriter()

    /// What the request does with the note.
    public enum Purpose: Sendable, Equatable {
        /// Write new content at the cursor (`/alfred <request>`).
        case insert
        /// Revise an Alfred block: `currentSource` is its content; the reply is the complete revised content.
        case refineBlock
        /// Replace the selection: the reply is only the replacement, shaped like the selection.
        case rewriteSelection(SelectionKind)
    }

    public enum SelectionKind: Sendable, Equatable {
        /// A range of text inside a block: the reply is inline text (no headings or extra paragraphs).
        case inline
        /// One or more whole blocks: the reply is blocks, with ```diagram or ```ui only when asked for a visual.
        case blocks
    }

    /// What the note around the insertion point says. Keep each part to a few thousand characters; longer
    /// text is trimmed (the end of `before`, the start of `after`).
    public struct DocumentContext: Sendable, Equatable {
        public var title: String
        /// Plain text just above the insertion point.
        public var before: String
        /// Plain text just below it.
        public var after: String
        /// The selected content as Markdown (`.rewriteSelection`), or text the request is about.
        public var selection: String?
        /// The block's earlier requests, oldest first, so follow-ups have context. String literals work too:
        /// `history: ["Explain the request flow"]`.
        public var history: [Turn]
        /// The block's current content when refining it; the reply is then the full revised content.
        public var currentSource: String?
        /// Explicit purpose; nil infers it (see `resolvedPurpose`).
        public var purpose: Purpose?

        /// For a selection rewrite, `before` and `after` are the text around the selection.
        public init(title: String, before: String = "", after: String = "", selection: String? = nil,
                    history: [Turn] = [], currentSource: String? = nil, purpose: Purpose? = nil) {
            self.title = title
            self.before = before
            self.after = after
            self.selection = selection
            self.history = history
            self.currentSource = currentSource
            self.purpose = purpose
        }

        /// `purpose` when given; otherwise refining when `currentSource` has content, rewriting when there's a
        /// selection (blocks when it spans paragraphs or starts with block Markdown, inline otherwise), else inserting.
        public var resolvedPurpose: Purpose {
            if let purpose { return purpose }
            if isRefinement { return .refineBlock }
            guard let selection = selection?.trimmingCharacters(in: .whitespacesAndNewlines), !selection.isEmpty else { return .insert }
            return .rewriteSelection(AlfredWriter.looksLikeBlocks(selection) ? .blocks : .inline)
        }

        /// True when the request revises an Alfred block.
        public var isRefinement: Bool { !(currentSource ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// One earlier request of a block: its prompt and any images it carried.
    public struct Turn: Sendable, Equatable, ExpressibleByStringLiteral {
        public var prompt: String
        public var images: [AlfredImage]

        public init(prompt: String, images: [AlfredImage] = []) {
            self.prompt = prompt
            self.images = images
        }

        public init(stringLiteral prompt: String) { self.init(prompt: prompt) }
    }

    /// At most this many images go with one request, counting the current request's first; earlier turns'
    /// images fill what's left, newest first.
    nonisolated public static let maxImages = 6
    /// Per-image and total limits on encoded image bytes (callers downscale before sending).
    nonisolated public static let maxImageBytes = 4 * 1024 * 1024
    nonisolated public static let maxTotalImageBytes = 16 * 1024 * 1024

    public enum WriterError: LocalizedError, Equatable {
        /// No key for the answer provider. Settings ▸ Alfred fixes it.
        case notConfigured
        case emptyPrompt
        /// More images than `maxImages` on the request itself.
        case tooManyImages
        /// An image over `maxImageBytes`, or the request's images over `maxTotalImageBytes`.
        case imageTooLarge
        /// The model stopped early (output limit, content filter).
        case cutShort(String)
        /// The provider or network failed; the message is reader-facing.
        case failed(String)

        public var errorDescription: String? {
            switch self {
            case .notConfigured: "Add an OpenAI key in Settings, under Alfred, to write with Alfred."
            case .emptyPrompt: "Tell Alfred what to write."
            case .tooManyImages: "Alfred takes up to \(AlfredWriter.maxImages) images at a time."
            case .imageTooLarge: "That image is too large. Try a smaller one."
            case .cutShort(let reason): "Alfred stopped early (\(reason))."
            case .failed(let message): message
            }
        }
    }

    /// Characters of surrounding text sent with each request.
    nonisolated static let contextBudget = 4_000

    private var client: (id: String, client: LLMClient)?
    private var tierUnsupported = false

    private init() {}

    /// Whether a key for the answer provider is set (show `/alfred` as unavailable otherwise).
    public var isAvailable: Bool { config.answerReady }

    /// The model that writes, for the block's provenance (`model` prop).
    public var modelName: String { config.answerModel }

    /// Streams document content for `prompt`. Deltas arrive in order; the stream finishes when the answer is
    /// complete and throws `WriterError` on failure.
    /// - Parameters:
    ///   - images: images the user attached to this request (pasted, dropped, or picked), already downscaled.
    ///     Sent to the model as image inputs; a request with only images and no text is fine.
    public func write(_ prompt: String, images: [AlfredImage] = [], in document: DocumentContext) -> AsyncThrowingStream<String, Error> {
        let prompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let config = config
        let (stream, continuation) = AsyncThrowingStream<String, Error>.makeStream()
        guard !prompt.isEmpty || !images.isEmpty else { continuation.finish(throwing: WriterError.emptyPrompt); return stream }
        let parts: [OpenAIClient.Part]
        do { parts = try Self.parts(prompt: prompt, images: images, document: document) }
        catch { continuation.finish(throwing: error); return stream }
        guard let client = client(for: config) else { continuation.finish(throwing: WriterError.notConfigured); return stream }

        let knowledge = KnowledgeStore.promptBlock(AlfredHost.shared.knowledge.docs)
        let extra = AlfredHost.shared.preferences.extraInstructions
        var request = LLMRequest(
            model: config.answerModel,
            instructions: Prompts.writerInstructions(knowledge: knowledge, extra: extra, purpose: document.resolvedPurpose),
            parts: parts,
            serviceTier: tierUnsupported ? nil : config.answerTier,
            effort: config.answerEffort,
            maxOutputTokens: config.answerMaxOutputTokens,
            promptCacheKey: "alfred-writer")

        let task = Task { @MainActor [weak self] in
            do {
                do {
                    try await Self.forward(client.stream(request), to: continuation)
                } catch let error as LLMError where error.isTierRejection && request.serviceTier != nil {
                    self?.tierUnsupported = true
                    request.serviceTier = nil
                    try await Self.forward(client.stream(request), to: continuation)
                }
                continuation.finish()
            } catch is CancellationError {
                continuation.finish()
            } catch let error as URLError where error.code == .cancelled {
                continuation.finish()
            } catch let error as WriterError {
                continuation.finish(throwing: error)
            } catch {
                Log.llm.error("Writer failed: \(error.localizedDescription, privacy: .public)")
                continuation.finish(throwing: WriterError.failed(error.localizedDescription))
            }
        }
        continuation.onTermination = { _ in task.cancel() }
        return stream
    }

    private static func forward(_ events: AsyncThrowingStream<LLMEvent, Error>,
                                to continuation: AsyncThrowingStream<String, Error>.Continuation) async throws {
        var finished = false
        for try await event in events {
            try Task.checkCancellation()
            switch event {
            case .delta(let text): continuation.yield(text)
            case .completed: finished = true
            case .incomplete(let reason): throw WriterError.cutShort(reason)
            }
        }
        try Task.checkCancellation()
        if !finished { throw WriterError.failed("The connection dropped before Alfred finished.") }
    }

    /// The user message: the text sections, then each earlier turn's images (labelled), then this request's images.
    /// Text-only requests are a single text part, exactly as before images existed.
    nonisolated static func parts(prompt: String, images: [AlfredImage], document: DocumentContext) throws -> [OpenAIClient.Part] {
        guard images.count <= maxImages else { throw WriterError.tooManyImages }
        guard images.allSatisfy({ $0.data.count <= maxImageBytes }),
              images.reduce(0, { $0 + $1.data.count }) <= maxTotalImageBytes else { throw WriterError.imageTooLarge }
        var parts: [OpenAIClient.Part] = [.text(input(prompt: prompt.isEmpty ? "(see the attached images)" : prompt, document: document))]

        // Earlier turns' images fill the remaining budget, newest turn first, then go out in order.
        var budget = (count: maxImages - images.count, bytes: maxTotalImageBytes - images.reduce(0) { $0 + $1.data.count })
        var earlier: [(index: Int, prompt: String, images: [AlfredImage])] = []
        for (index, turn) in document.history.enumerated().reversed() {
            var kept: [AlfredImage] = []
            for image in turn.images where budget.count > 0 && image.data.count <= min(maxImageBytes, budget.bytes) {
                kept.append(image)
                budget.count -= 1
                budget.bytes -= image.data.count
            }
            if !kept.isEmpty { earlier.insert((index + 1, turn.prompt, kept), at: 0) }
        }
        for turn in earlier {
            parts.append(.text("Images attached to earlier request \(turn.index) (\(String(turn.prompt.prefix(120)))):"))
            parts += turn.images.map { .image(dataURL: $0.dataURL) }
        }
        if !images.isEmpty {
            parts.append(.text(images.count == 1 ? "Image attached to this request:" : "Images attached to this request:"))
            parts += images.map { .image(dataURL: $0.dataURL) }
        }
        return parts
    }

    /// Whether selected Markdown is whole blocks rather than a run of text inside one.
    nonisolated static func looksLikeBlocks(_ markdown: String) -> Bool {
        if markdown.contains("\n\n") { return true }
        let first = markdown.trimmingCharacters(in: .whitespaces)
        return ["#", "- ", "* ", "> ", "```", "|"].contains { first.hasPrefix($0) }
            || first.range(of: #"^\d+[.)] "#, options: .regularExpression) != nil
            || markdown.contains("\n- ") || markdown.contains("\n* ")
    }

    nonisolated static func input(prompt: String, document: DocumentContext) -> String {
        let purpose = document.resolvedPurpose
        let rewriting: SelectionKind? = { if case .rewriteSelection(let kind) = purpose { kind } else { nil } }()
        var sections = ["## Note title\n\(document.title.isEmpty ? "(untitled)" : document.title)"]
        let before = String(document.before.suffix(contextBudget)).trimmingCharacters(in: .whitespacesAndNewlines)
        let after = String(document.after.prefix(contextBudget / 2)).trimmingCharacters(in: .whitespacesAndNewlines)
        let place = rewriting == nil ? "the insertion point" : "the selection"
        if !before.isEmpty { sections.append("## Text above \(place)\n\(before)") }
        if !after.isEmpty { sections.append("## Text below \(place)\n\(after)") }
        if let kind = rewriting, let selection = document.selection?.trimmingCharacters(in: .whitespacesAndNewlines) {
            let shape = kind == .inline
                ? "inline text that replaces a run of text inside a paragraph"
                : "Markdown blocks that replace the selected blocks"
            sections.append("## Selected content (replace this)\n\(String(selection.prefix(contextBudget * 4)))")
            sections.append("## Change requested\n\(prompt)")
            sections.append("## Reply with\nOnly the replacement: \(shape).")
            return sections.joined(separator: "\n\n")
        }
        if let selection = document.selection?.trimmingCharacters(in: .whitespacesAndNewlines), !selection.isEmpty {
            sections.append("## Selected text (the request is about this)\n\(String(selection.prefix(contextBudget)))")
        }
        let earlier = document.history.map { $0.prompt.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if !earlier.isEmpty {
            sections.append("## Earlier requests for this block (oldest first)\n" + earlier.suffix(10).map { "- \($0)" }.joined(separator: "\n"))
        }
        if purpose == .refineBlock, let source = document.currentSource {
            sections.append("## Current block content (revise this; reply with the complete new content)\n\(String(source.prefix(contextBudget * 4)))")
            sections.append("## Change requested\n\(prompt)")
        } else {
            sections.append("## Request\n\(prompt)")
        }
        return sections.joined(separator: "\n\n")
    }

    // MARK: Configuration

    private var config: Config { AlfredHost.shared.currentState?.config ?? AlfredHost.shared.settings.config }

    /// One client per provider, key, and endpoint, reused so later requests skip the TLS handshake.
    private func client(for config: Config) -> LLMClient? {
        let provider = config.answerProvider
        guard let key = config.key(for: provider), !key.isEmpty else { return nil }
        let id = "\(provider.rawValue)|\(key)|\(config.baseURL(for: provider))"
        if let client, client.id == id { return client.client }
        client?.client.invalidate()
        let made: LLMClient = provider == .openai ? OpenAIClient(apiKey: key, baseURL: config.baseURL(for: provider))
            : ChatCompletionsClient(apiKey: key, baseURL: config.baseURL(for: provider), providerName: provider.title)
        client = (id, made)
        return made
    }
}

/// An image attached to a writing request: PNG or JPEG bytes the caller has already downscaled (a long edge
/// around 2048 px keeps detail and uploads fast).
public struct AlfredImage: Sendable, Equatable {
    public let data: Data
    /// `image/png` or `image/jpeg`.
    public let mimeType: String

    /// Nil for anything other than PNG or JPEG.
    public init?(data: Data, mimeType: String) {
        let type = mimeType.lowercased()
        guard ["image/png", "image/jpeg", "image/jpg"].contains(type), !data.isEmpty else { return nil }
        self.data = data
        self.mimeType = type == "image/jpg" ? "image/jpeg" : type
    }

    var dataURL: String { "data:\(mimeType);base64,\(data.base64EncodedString())" }
}
