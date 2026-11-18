import AppKit
import ManorKit

/// Editing a selection with Alfred: the composer opens for the selected text or blocks, the result streams
/// into a preview under the selection, and nothing in the note changes until Replace or Insert below, each one
/// undo step.
extension NoteEditorController {
  /// Quick requests the composer offers as chips.
  static let alfredSelectionSuggestions = ["Improve writing", "Shorter", "Longer", "Fix spelling and grammar", "Simplify",
                                           "Make a list", "Make a table", "Visualize as a diagram"]

  // MARK: Starting

  /// Command-J or "Ask Alfred" in the toolbar: the selected text, or the whole block when nothing is selected.
  func askAlfredAboutSelection(in textView: NoteTextView) {
    guard isEditable, textView.role == .block, alfredOwner(of: textView.blockID) == nil,
          let block = blocks.block(id: textView.blockID) else { return }
    let range = textView.selectedRange()
    let selection: NoteAlfredSelection
    if range.length > 0, block.kind.hasInlineContent {
      selection = .inline(blockID: block.id, range: range)
    } else {
      selection = .blocks([block.id])
    }
    toolbar.hide()
    openSelectionComposer(selection)
  }

  /// "Ask Alfred" for selected blocks.
  func askAlfredAboutBlocks(_ ids: [String]) {
    guard isEditable else { return }
    let outermost = blocks.outermost(Set(ids)).map(\.id).filter { blocks.block(id: $0)?.kind != .alfred }
    guard !outermost.isEmpty else { return }
    openSelectionComposer(.blocks(outermost))
  }

  private func openSelectionComposer(_ selection: NoteAlfredSelection) {
    discardSelectionEdit()
    model?.alfredComposer = NoteAlfredComposerRequest(target: .rewrite(selection), noteTitle: noteTitle, earlierRequests: [])
  }

  /// Back to the selection after closing the composer.
  func restoreSelection(_ selection: NoteAlfredSelection) {
    switch selection {
    case .inline(let blockID, let range): apply(.text(blockID, range))
    case .blocks(let ids): selectBlocks(ids.filter { blocks.contains(id: $0) })
    }
  }

  /// The selected content as Markdown, for the request.
  func markdown(of selection: NoteAlfredSelection) -> String {
    switch selection {
    case .inline(let blockID, let range):
      guard let block = blocks.block(id: blockID) else { return "" }
      let text = NoteInlineText.attributedString(block.inlines, style: NoteTextStyle.for(block))
      let clamped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
      return NoteMarkdown.inlineMarkdown(NoteInlineText.inlines(from: text.attributedSubstring(from: clamped)))
    case .blocks(let ids):
      return NoteMarkdown.markdown(from: blocks.outermost(Set(ids)), document: blocks)
    }
  }

  func startSelectionEdit(_ selection: NoteAlfredSelection, with turn: NoteAlfredTurn) {
    guard isEditable, let anchor = selection.anchorID, blocks.contains(id: anchor) else { return }
    discardSelectionEdit()
    let edit = NoteAlfredSelectionEdit(selection: selection, selectionMarkdown: markdown(of: selection))
    selectionEdit = edit
    // The selection stays highlighted while the preview takes the keyboard.
    if case .blocks(let ids) = selection { setBlockSelection(ids) }
    canvas?.window?.makeFirstResponder(canvas)
    runSelectionEdit(edit, turn: turn, refining: false)
  }

  /// A follow-up ("more casual") changes the preview, with the earlier requests as context.
  func refineSelectionEdit(with turn: NoteAlfredTurn) {
    guard let edit = selectionEdit else { return }
    edit.task?.cancel()
    canvas?.window?.makeFirstResponder(canvas)
    runSelectionEdit(edit, turn: turn, refining: !edit.source.isEmpty)
  }

  /// Try again: the latest request once more, from the original selection.
  func retrySelectionEdit() {
    guard let edit = selectionEdit, let latest = edit.turns.last else { return }
    edit.task?.cancel()
    edit.turns.removeLast()
    runSelectionEdit(edit, turn: latest, refining: false)
  }

  func openPreviewComposer() {
    guard let edit = selectionEdit, !edit.isRunning else { return }
    model?.alfredComposer = NoteAlfredComposerRequest(target: .refinePreview, noteTitle: noteTitle, earlierRequests: edit.turns.map(\.prompt))
  }

  private func runSelectionEdit(_ edit: NoteAlfredSelectionEdit, turn: NoteAlfredTurn, refining: Bool) {
    guard let anchor = edit.selection.anchorID else { return }
    var context = alfredContext(around: anchor, history: edit.turns, currentSource: refining ? edit.source : nil)
    context.selection = edit.selectionMarkdown
    if case .inline = edit.selection { context.purpose = .rewriteInline } else { context.purpose = .rewriteBlocks }
    edit.turns.append(turn)
    edit.phase = .thinking
    var buffer = ""
    let stream = alfredWriter.write(turn, in: context)
    canvas?.layoutDocument()
    edit.task = Task { [weak self, weak edit] in
      var failure: Error?
      do {
        for try await chunk in stream {
          guard let self, let edit, self.selectionEdit === edit else { return }
          if edit.phase == .thinking {
            edit.phase = .streaming
            buffer = ""
          }
          buffer += chunk
          edit.source = buffer
          self.schedulePreviewLayout(edit)
        }
      } catch {
        failure = error
      }
      guard let self, let edit, self.selectionEdit === edit else { return }
      if let failure, !(failure is CancellationError) {
        edit.phase = .failed(message: failure.localizedDescription, needsKey: NoteAlfredWriterAdapter.isNotConfigured(failure))
      } else {
        edit.phase = nil
      }
      edit.task = nil
      self.canvas?.layoutDocument()
    }
  }

  private func schedulePreviewLayout(_ edit: NoteAlfredSelectionEdit) {
    guard !edit.flushScheduled else { return }
    edit.flushScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak edit] in
      edit?.flushScheduled = false
      self?.canvas?.layoutDocument()
    }
  }

  /// Escape: stops the preview while it writes, discards it otherwise.
  @discardableResult
  func escapeSelectionEdit() -> Bool {
    guard let edit = selectionEdit else { return false }
    if edit.isRunning {
      edit.task?.cancel()
      edit.task = nil
      edit.phase = nil
      canvas?.layoutDocument()
    } else {
      discardSelectionEdit()
    }
    return true
  }

  func discardSelectionEdit() {
    guard let edit = selectionEdit else { return }
    edit.task?.cancel()
    selectionEdit = nil
    canvas?.layoutDocument()
    restoreSelection(edit.selection)
  }

  // MARK: Applying

  /// Replaces the selection with the preview, or inserts the preview below it, as one undo step.
  func applySelectionEdit(replace: Bool) {
    guard let edit = selectionEdit, !edit.isRunning, isEditable else { return }
    let source = edit.source.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !source.isEmpty else { return }
    let converted = NoteAlfred.unwrap(source: source)
    guard !converted.isEmpty else { return }
    selectionEdit = nil
    switch edit.selection {
    case .blocks(let ids):
      let existing = ids.filter { blocks.contains(id: $0) }
      guard let first = existing.first, let last = existing.last else { canvas?.layoutDocument(); return }
      let focus = Self.endFocus(of: converted)
      mutate(focus: focus) { blocks in
        if replace {
          blocks.insert(converted, relativeTo: first, .before)
          blocks.remove(ids: Set(existing))
        } else {
          blocks.insert(converted, relativeTo: last, .after)
        }
      }
    case .inline(let blockID, let range):
      guard let block = blocks.block(id: blockID) else { canvas?.layoutDocument(); return }
      if replace, converted.count == 1, converted[0].kind == .paragraph {
        // Inline text takes the place of the range, keeping the text around it and its styles.
        let style = NoteTextStyle.for(block)
        let text = NoteInlineText.attributedString(block.inlines, style: style)
        let clamped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
        let replacement = NoteInlineText.attributedString(converted[0].inlines, style: style)
        text.replaceCharacters(in: clamped, with: replacement)
        let merged = NoteInlineText.inlines(from: text)
        mutate(focus: .text(blockID, NSRange(location: clamped.location + replacement.length, length: 0))) { blocks in
          blocks.update(id: blockID) { $0.content = .inline(merged) }
        }
      } else if replace {
        // Blocks in place of a range: the text before stays in the block, the text after follows the new blocks.
        let style = NoteTextStyle.for(block)
        let text = NoteInlineText.attributedString(block.inlines, style: style)
        let clamped = NSIntersectionRange(range, NSRange(location: 0, length: text.length))
        let head = NoteInlineText.inlines(from: text.attributedSubstring(from: NSRange(location: 0, length: clamped.location)))
        let tailRange = NSRange(location: NSMaxRange(clamped), length: text.length - NSMaxRange(clamped))
        let tail = NoteInlineText.inlines(from: text.attributedSubstring(from: tailRange))
        var inserted = converted
        if !tail.isEmpty { inserted.append(NoteSchema.block(block.kind.isListItem ? block.kind : .paragraph, content: .inline(tail))) }
        let focus = Self.endFocus(of: converted)
        mutate(focus: focus) { blocks in
          blocks.insert(inserted, relativeTo: blockID, .after)
          if head.isEmpty && block.children.isEmpty {
            blocks.remove(ids: [blockID])
          } else {
            blocks.update(id: blockID) { $0.content = .inline(head) }
          }
        }
      } else {
        mutate(focus: Self.endFocus(of: converted)) { blocks in blocks.insert(converted, relativeTo: blockID, .after) }
      }
    }
  }

  private static func endFocus(of blocks: [NoteBlock]) -> NoteFocus {
    guard let last = blocks.last else { return .none }
    if last.kind.hasInlineContent { return .text(last.id, NSRange(location: (NoteFind.displayText(last.inlines) as NSString).length, length: 0)) }
    return .blocks(blocks.map(\.id))
  }

  // MARK: Layout

  /// The preview's place in the layout: under the selection's last block.
  var selectionPreview: (anchorID: String, block: NoteBlock)? {
    guard let edit = selectionEdit, let anchor = edit.selection.anchorID else { return nil }
    return (anchor, edit.previewBlock)
  }

  /// What the preview lays out: its converted blocks between its header and its actions.
  func previewLayoutContent(_ block: NoteBlock) -> (blocks: [NoteBlock], top: CGFloat, bottom: CGFloat) {
    guard let edit = selectionEdit else { return ([], AlfredChrome.header, 0) }
    let converted = NoteMarkdown.blocks(from: edit.source, options: .alfred(id: block.id, streaming: edit.phase == .streaming))
    var bottom = AlfredChrome.padding + AlfredChrome.ask
    if case .failed = edit.phase { bottom += AlfredChrome.failure }
    return (converted, AlfredChrome.header, bottom)
  }

  /// Return applies the preview, Escape stops or discards it.
  func handlePreviewKey(_ event: NSEvent) -> Bool {
    guard let edit = selectionEdit else { return false }
    switch event.keyCode {
    case 36, 76:
      if !edit.isRunning { applySelectionEdit(replace: true) }
      return true
    case 53:
      return escapeSelectionEdit()
    default:
      return false
    }
  }
}
