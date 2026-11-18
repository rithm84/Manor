import AppKit
import ManorKit

/// `/alfred`: the composer, generation streaming into an Alfred block, refinement, and the block's actions.
extension NoteEditorController {
  var alfredWriter: any NoteAlfredWriting {
    if let writer = services.alfredWriter { return writer }
    #if DEBUG
    if NoteAlfredDemoWriter.isEnabled { return NoteAlfredDemoWriter.shared }
    #endif
    return NoteAlfredWriterAdapter.shared
  }

  var noteTitle: String { services.noteTitle?() ?? "" }

  func alfredRun(for id: String) -> NoteAlfredRun? { alfredRuns[id] }

  var isAlfredRunning: Bool { alfredRuns.values.contains { $0.isActive } }

  // MARK: Rendering

  /// Chrome heights of an Alfred block, shared by layout and its view.
  enum AlfredChrome {
    static let header: CGFloat = 34
    static let empty: CGFloat = 28
    static let failure: CGFloat = 64
    static let ask: CGFloat = 38
    static let padding: CGFloat = 6
  }

  /// What an Alfred block lays out: its converted blocks, and its chrome above and below them.
  func alfredLayoutContent(_ block: NoteBlock) -> (blocks: [NoteBlock], top: CGFloat, bottom: CGFloat) {
    let run = alfredRuns[block.id]
    let streaming = run?.phase == .streaming
    let source = NoteAlfred.source(of: block)
    let converted: [NoteBlock]
    if let cached = alfredRenderCache[block.id], cached.source == source, cached.streaming == streaming {
      converted = cached.blocks
    } else {
      converted = NoteAlfred.blocks(of: block, streaming: streaming)
      alfredRenderCache[block.id] = (source, streaming, converted)
    }
    var bottom = AlfredChrome.padding
    if converted.isEmpty, run == nil { bottom += AlfredChrome.empty }
    if case .failed = run?.phase { bottom += AlfredChrome.failure }
    if isEditable, run?.isActive != true { bottom += AlfredChrome.ask }
    return (converted, AlfredChrome.header, bottom)
  }

  /// The Alfred block an id belongs to when it names one of its rendered blocks (`<alfred id>/<position>`).
  func alfredOwner(of id: String) -> String? {
    guard !blocks.contains(id: id), let slash = id.firstIndex(of: "/") else { return nil }
    let owner = String(id[..<slash])
    return blocks.block(id: owner)?.kind == .alfred ? owner : nil
  }

  // MARK: Composer

  /// Opens the composer to write a new Alfred block at a block (the one `/alfred` was typed in).
  func openAlfredComposer(insertingAt anchorID: String) {
    guard isEditable else { return }
    model?.alfredComposer = NoteAlfredComposerRequest(target: .insert(anchorID: anchorID), noteTitle: noteTitle, earlierRequests: [])
  }

  /// Opens the composer to change an Alfred block.
  func openAlfredComposer(refining blockID: String) {
    guard isEditable, let block = blocks.block(id: blockID), block.kind == .alfred else { return }
    stopAlfred(blockID)
    model?.alfredComposer = NoteAlfredComposerRequest(target: .refine(blockID: blockID), noteTitle: noteTitle,
                                                      earlierRequests: NoteAlfred.requests(of: block).map(\.prompt))
  }

  func closeAlfredComposer(_ request: NoteAlfredComposerRequest) {
    guard model?.alfredComposer?.id == request.id else { return }
    model?.alfredComposer = nil
    // Back to where the writing happens.
    switch request.target {
    case .insert(let anchorID): if blocks.contains(id: anchorID) { focus(anchorID, at: .end) }
    case .refine(let blockID): if blocks.contains(id: blockID) { selectBlocks([blockID]) }
    case .rewrite(let selection): restoreSelection(selection)
    case .refinePreview: canvas?.window?.makeFirstResponder(canvas)
    }
  }

  /// Send from the composer: closes it and starts generating in place.
  func sendAlfred(_ request: NoteAlfredComposerRequest, prompt: String, images: [NoteAlfredImage]) {
    model?.alfredComposer = nil
    let turn = NoteAlfredTurn(prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines), images: images)
    switch request.target {
    case .insert(let anchorID): startAlfredBlock(turn, at: anchorID)
    case .refine(let blockID): refineAlfred(blockID, with: turn)
    case .rewrite(let selection): startSelectionEdit(selection, with: turn)
    case .refinePreview: refineSelectionEdit(with: turn)
    }
  }

  // MARK: Starting

  /// A new Alfred block where `/alfred` was typed: it takes the place of an empty block, or goes below one with text.
  func startAlfredBlock(_ turn: NoteAlfredTurn, at anchorID: String) {
    guard isEditable else { return }
    let focusBefore = currentFocus()
    let anchor = blocks.block(id: anchorID)
    let replaces = anchor.map { $0.kind.hasInlineContent && $0.inlines.isEmpty && $0.children.isEmpty } ?? false
    let request = NoteAlfredRequest(prompt: turn.prompt)
    let block = NoteAlfred.block(request: request, model: alfredWriter.modelName, id: replaces ? anchorID : NoteBlock.newID())
    let id = block.id
    var context = alfredContext(around: anchorID, history: [], currentSource: nil)
    context.purpose = .insert
    let undoPatch: ([NoteBlock]) -> [NoteBlock] = { current in
      var restored = current
      if replaces, let anchor {
        restored.update(id: id) { $0 = anchor }
      } else {
        restored.remove(ids: [id])
      }
      return restored
    }
    applyTransient { blocks in
      if replaces {
        blocks.update(id: anchorID) { $0 = block }
      } else if !blocks.insert([block], relativeTo: anchorID, .after) {
        blocks.append(block)
      }
    }
    selectBlocks([id])
    run(NoteAlfredRun(blockID: id, turn: turn, context: context, focusBefore: focusBefore, undoPatch: undoPatch), replacing: true)
  }

  /// Rewrites an Alfred block for a follow-up request, with its history and current content as context.
  func refineAlfred(_ id: String, with turn: NoteAlfredTurn) {
    guard isEditable, let block = blocks.block(id: id), block.kind == .alfred else { return }
    stopAlfred(id)
    let focusBefore = currentFocus()
    let earlier = NoteAlfred.requests(of: block).map { NoteAlfredTurn(prompt: $0.prompt) }
    let source = NoteAlfred.source(of: block)
    var context = alfredContext(around: id, history: earlier, currentSource: source.isEmpty ? nil : source)
    context.purpose = source.isEmpty ? .insert : .refineBlock
    let original = block
    applyTransient { blocks in
      blocks.update(id: id) { target in
        var requests = target.props["requests"]?.array ?? []
        requests.append(NoteAlfredRequest(prompt: turn.prompt).json)
        target.props["requests"] = .array(requests)
      }
    }
    selectBlocks([id])
    run(NoteAlfredRun(blockID: id, turn: turn, context: context, focusBefore: focusBefore, undoPatch: { current in
      var restored = current
      restored.update(id: id) { $0 = original }
      return restored
    }), replacing: source.isEmpty)
  }

  /// Try again: the latest request once more (with its images), written fresh with the earlier requests as context.
  func retryAlfred(_ id: String) {
    guard isEditable, let block = blocks.block(id: id), block.kind == .alfred else { return }
    let previous = alfredRuns[id]
    stopAlfred(id)
    let requests = NoteAlfred.requests(of: block)
    guard let latest = requests.last else { return }
    let focusBefore = currentFocus()
    let original = block
    let turn = NoteAlfredTurn(prompt: latest.prompt, images: previous?.turn.prompt == latest.prompt ? previous?.turn.images ?? [] : [])
    let earlier = requests.dropLast().map { NoteAlfredTurn(prompt: $0.prompt) }
    let context = alfredContext(around: id, history: Array(earlier), currentSource: nil)
    let start = { [weak self] (turn: NoteAlfredTurn) in
      guard let self else { return }
      self.run(NoteAlfredRun(blockID: id, turn: turn, context: context, focusBefore: focusBefore, undoPatch: { current in
        var restored = current
        restored.update(id: id) { $0 = original }
        return restored
      }), replacing: true)
    }
    if turn.images.isEmpty, !latest.images.isEmpty, let resolve = services.resolveAttachment {
      // Images saved with the request come back from their attachments.
      // A placeholder shows the working state while the images load; it records nothing itself.
      let placeholder = NoteAlfredRun(blockID: id, turn: turn, context: context, focusBefore: focusBefore, undoPatch: { $0 })
      placeholder.committed = true
      alfredRuns[id] = placeholder
      refreshAlfredView(id)
      Task { [weak self] in
        var images: [NoteAlfredImage] = []
        for stored in latest.images {
          guard let url = try? await resolve(stored), let data = try? await Self.load(url), let image = NSImage(data: data),
                var made = NoteAlfredImage.make(from: image) else { continue }
          made.stableURL = stored
          images.append(made)
        }
        guard let self, self.alfredRuns[id] === placeholder else { return }
        self.alfredRuns[id] = nil
        start(NoteAlfredTurn(prompt: turn.prompt, images: images))
      }
    } else {
      start(turn)
    }
  }

  private nonisolated static func load(_ url: URL) async throws -> Data {
    if url.isFileURL { return try Data(contentsOf: url) }
    return try await URLSession.shared.data(from: url).0
  }

  /// The note title and plain text just above and below a block.
  func alfredContext(around id: String, history: [NoteAlfredTurn], currentSource: String?) -> NoteAlfredContext {
    let ordered = blocks.flattened().map(\.block)
    let index = ordered.firstIndex { $0.id == id } ?? ordered.count
    let before = ordered[..<min(index, ordered.count)].map(\.plainText).filter { !$0.isEmpty }.joined(separator: "\n")
    let after = ordered.count > index + 1 ? ordered[(index + 1)...].map(\.plainText).filter { !$0.isEmpty }.joined(separator: "\n") : ""
    return NoteAlfredContext(title: noteTitle, before: String(before.suffix(6_000)), after: String(after.prefix(3_000)),
                             history: history, currentSource: currentSource)
  }

  // MARK: Running

  /// Streams a run into its block. `replacing` clears the source as soon as content arrives; a refinement
  /// keeps showing the old content until the revision starts streaming.
  private func run(_ run: NoteAlfredRun, replacing: Bool) {
    let id = run.blockID
    alfredRuns[id] = run
    refreshAlfredView(id)
    if !run.turn.images.isEmpty, let upload = services.uploadAttachment {
      let images = run.turn.images
      run.uploads = Task {
        var urls: [String] = []
        for image in images {
          if let stored = image.stableURL { urls.append(stored); continue }
          let file = FileManager.default.temporaryDirectory.appendingPathComponent("Alfred image \(image.id.uuidString).\(image.fileExtension)")
          guard (try? image.data.write(to: file)) != nil, let stable = try? await upload(file) else { continue }
          urls.append(stable)
          try? FileManager.default.removeItem(at: file)
        }
        return urls
      }
    }
    let stream = alfredWriter.write(run.turn, in: run.context)
    run.task = Task { [weak self, weak run] in
      var failure: Error?
      do {
        for try await chunk in stream {
          guard let self, let run else { return }
          if run.phase == .thinking {
            run.phase = .streaming
            run.buffer = ""
            self.refreshAlfredView(id)
          }
          run.buffer += chunk
          self.scheduleAlfredFlush(run)
        }
      } catch {
        failure = error
      }
      guard let self, let run else { return }
      await self.finishAlfred(run, failure: failure)
    }
  }

  private func scheduleAlfredFlush(_ run: NoteAlfredRun) {
    guard !run.flushScheduled else { return }
    run.flushScheduled = true
    // About 20 updates a second keeps streaming smooth without re-laying out on every token.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak run] in
      guard let self, let run else { return }
      run.flushScheduled = false
      self.flushAlfred(run)
    }
  }

  private func flushAlfred(_ run: NoteAlfredRun) {
    guard !run.committed, run.phase == .streaming || !run.buffer.isEmpty, blocks.contains(id: run.blockID) else { return }
    let source = run.buffer
    guard blocks.block(id: run.blockID).map(NoteAlfred.source(of:)) != source else { return }
    applyTransient { blocks in blocks.update(id: run.blockID) { $0.props["source"] = .string(source) } }
  }

  private func finishAlfred(_ run: NoteAlfredRun, failure: Error?) async {
    guard !run.committed else { return }
    if run.phase == .streaming || !run.buffer.isEmpty { flushAlfred(run) }
    let urls = await run.uploads?.value ?? []
    guard !run.committed else { return }
    run.committed = true
    let id = run.blockID
    guard blocks.contains(id: id) else { alfredRuns[id] = nil; return }
    if !urls.isEmpty {
      // The request's images, saved as note attachments.
      applyTransient { blocks in
        blocks.update(id: id) { block in
          var requests = block.props["requests"]?.array ?? []
          if let last = requests.indices.last, var request = NoteAlfredRequest(requests[last]) {
            request.images = urls
            requests[last] = request.json
            block.props["requests"] = .array(requests)
          }
        }
      }
    }
    commitTransient(undoSnapshot: run.undoPatch(blocks), focusBefore: run.focusBefore)
    if let failure, !(failure is CancellationError) {
      run.phase = .failed(message: failure.localizedDescription, needsKey: NoteAlfredWriterAdapter.isNotConfigured(failure))
      run.task = nil
      alfredRuns[id] = run
    } else {
      alfredRuns[id] = nil
    }
    refreshAlfredView(id)
  }

  /// Stops a running generation, keeping what arrived so far.
  func stopAlfred(_ id: String) {
    guard let run = alfredRuns[id] else { return }
    run.task?.cancel()
    if run.isActive, !run.committed {
      if run.phase == .streaming || !run.buffer.isEmpty { flushAlfred(run) }
      run.committed = true
      commitTransient(undoSnapshot: run.undoPatch(blocks), focusBefore: run.focusBefore)
    }
    alfredRuns[id] = nil
    refreshAlfredView(id)
  }

  /// Escape stops every running generation.
  @discardableResult
  func stopAllAlfred() -> Bool {
    let running = alfredRuns.values.filter(\.isActive).map(\.blockID)
    for id in running { stopAlfred(id) }
    return !running.isEmpty
  }

  func dismissAlfredError(_ id: String) {
    guard let run = alfredRuns[id], !run.isActive else { return }
    alfredRuns[id] = nil
    refreshAlfredView(id)
  }

  /// Re-renders an Alfred block after its run changed: its chrome, and its content (which converts with
  /// streaming rules only while it streams).
  func refreshAlfredView(_ id: String) {
    (canvas?.view(for: id) as? NoteAlfredBlockView)?.refreshRun()
    if blocks.block(id: id)?.kind == .alfred { setNeedsLayout() }
  }

  // MARK: Block actions

  /// "Turn into regular blocks": prose becomes ordinary blocks; visuals become standalone blocks.
  func unwrapAlfred(_ id: String) {
    guard isEditable, let block = blocks.block(id: id), block.kind == .alfred else { return }
    stopAlfred(id)
    var unwrapped = NoteAlfred.unwrap(source: NoteAlfred.source(of: block))
    if unwrapped.isEmpty { unwrapped = [NoteSchema.paragraph()] }
    let first = unwrapped[0]
    let focus: NoteFocus = first.kind.isTextual && first.kind != .mathBlock ? .text(first.id, NSRange(location: 0, length: 0)) : .blocks([first.id])
    mutate(focus: focus) { blocks in
      blocks.insert(unwrapped, relativeTo: id, .after)
      blocks.remove(ids: [id])
    }
  }

  /// Copies an Alfred block's content as Markdown text and as a block other notes can paste.
  func copyAlfred(_ id: String) {
    guard let block = blocks.block(id: id) else { return }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if let data = try? JSONEncoder().encode(NoteDocumentCoding.json(from: [block])) { pasteboard.setData(data, forType: .noteBlocks) }
    pasteboard.setString(NoteAlfred.source(of: block), forType: .string)
    showNotice("Copied")
  }

  func alfredMenuItems(_ id: String, into menu: NoteActionMenu) {
    let running = alfredRuns[id]?.isActive == true
    if isEditable {
      if running {
        menu.add("Stop", symbol: "stop.circle") { [weak self] in self?.stopAlfred(id) }
      } else {
        menu.add("Ask Alfred to change…", symbol: "sparkles") { [weak self] in self?.openAlfredComposer(refining: id) }
        menu.add("Try again", symbol: "arrow.clockwise") { [weak self] in self?.retryAlfred(id) }
      }
    }
    menu.add("Copy", symbol: "doc.on.doc") { [weak self] in self?.copyAlfred(id) }
    if isEditable {
      let unwrap = menu.add("Turn into regular blocks", symbol: "square.split.1x2") { [weak self] in self?.unwrapAlfred(id) }
      unwrap.isEnabled = !running
      menu.add("Delete", symbol: "trash") { [weak self] in
        self?.stopAlfred(id)
        self?.deleteBlocks([id])
      }
    }
  }
}
