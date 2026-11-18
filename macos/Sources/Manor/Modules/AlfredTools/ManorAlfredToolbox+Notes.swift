import Alfred
import Foundation
import ManorKit

// Notes: creating a note through the Notes service, and adding to the note open on the Notes page. An append
// lands the open draft first, writes the committed document plus the new blocks with `update_note` at its
// revision, then shows the result in the open editor the way a restored version is shown.

extension ManorAlfredToolbox {
  private static let emptyDocument: [JSONValue] = [["type": "paragraph", "content": [], "children": []]]

  func notesService() throws -> NotesService {
    guard let service = NotesRuntime.service(for: gateway) else {
      throw ManorToolArgumentError("Manor couldn't open Notes on this Mac.")
    }
    return service
  }

  func createNote(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorCreateNoteArgs.parse(arguments)
    let service = try notesService()
    let blocks = args.markdown.isEmpty ? Self.emptyDocument : ManorNoteContent.blocks(fromMarkdown: args.markdown)
    let result = try await service.createPage(title: args.title, folderId: nil, parentPageId: nil, blocks: blocks.isEmpty ? Self.emptyDocument : blocks)
    let id = result.id
    let title = args.title
    return .done("Created the note \(Self.quoted(title))", output: "Created note [\(id)] \(title) with \(blocks.count) blocks. open_page notes shows the Notes page.", undo: { [weak self] in
      guard let self else { throw Self.closed }
      let service = try self.notesService()
      _ = try await service.load()
      _ = try await service.trashPages([id])
      return "Moved \(Self.quoted(title)) to Trash"
    })
  }

  func appendToCurrentNote(_ arguments: [String: Any]) async throws -> AlfredToolResult {
    let args = try ManorAppendNoteArgs.parse(arguments)
    guard let store = NotesRuntime.activeStore, let noteId = store.selectedId else {
      throw ManorToolArgumentError("No note is open on the Notes page. Ask which note to add to, or create one.")
    }
    let added = ManorNoteContent.blocks(fromMarkdown: args.markdown)
    guard !added.isEmpty else { throw ManorToolArgumentError("That Markdown has no content to add.") }
    let page = try await rewriteNote(noteId, store: store) { blocks in blocks + added }
    let ids = Set(ManorNoteContent.ids(added))
    let title = page.displayTitle
    return .done("Added to \(Self.quoted(title))", output: "Appended \(added.count) blocks to note [\(noteId)] \(title).", undo: { [weak self] in
      guard let self else { throw Self.closed }
      _ = try await self.rewriteNote(noteId, store: NotesRuntime.activeStore) { blocks in
        let kept = blocks.filter { !ids.contains($0["id"]?.string ?? "") }
        guard kept.count < blocks.count else { throw ManorToolArgumentError("The added content is no longer in the note.") }
        return kept.isEmpty ? Self.emptyDocument : kept
      }
      return "Removed the added content from \(Self.quoted(title))"
    })
  }

  /// Replaces a note's committed blocks with `transform` of them. The open draft lands first so nothing typed is
  /// lost; the write carries the note's revision, so a change that lands in between is refused, not overwritten.
  func rewriteNote(_ noteId: String, store: NotesStore?, transform: ([JSONValue]) throws -> [JSONValue]) async throws -> NotePage {
    if let store, store.selectedId == noteId {
      guard await store.runPendingSave() else {
        throw ManorToolArgumentError("The open note has changes that haven't saved yet. Try again once it saves.")
      }
    }
    guard let row = try await gateway.rowsFromServer("note_pages", where: [RowFilter("id", .string(noteId))]).first else {
      throw ManorToolArgumentError("That note is no longer in this account.")
    }
    let page = try NoteRows.page(row)
    guard page.status == .active else {
      throw ManorToolArgumentError("\(Self.quoted(page.displayTitle)) is \(page.status == .trash ? "in Trash" : "archived"). Restore it before adding to it.")
    }
    let blocks = try transform(page.content)
    try NoteLimits.checkContent(blocks)
    let receipt = try await gateway.command("update_note", [
      "id": .string(noteId), "title": .string(try NoteLimits.title(page.title)), "content_json": .array(blocks),
      "expected_revision": .number(Double(page.revision))
    ])
    guard let record = receipt.record else {
      throw ManorRequestError(operation: "Save note", code: "receipt", detail: "Saving the note did not return the committed document.")
    }
    let saved = try NoteRows.page(record)
    // The service learns the new revision, and the open editor shows the saved document unless the user is
    // typing; a pending draft merges with it by block on its next save.
    let service = try notesService()
    _ = try? await service.load()
    if let store, store.selectedId == noteId, store.saveState == .saved {
      store.applied(saved)
    }
    return saved
  }

  // MARK: Snapshot

  func notesSnapshot() -> [String] {
    guard let store = NotesRuntime.activeStore, let noteId = store.selectedId else { return ["No note is open."] }
    let content: NoteContent
    if let draft = store.draft, draft.id == noteId { content = draft }
    else if let page = store.selectedPage { content = NoteContent(id: page.id, title: page.title, blocks: page.content) }
    else { return ["No note is open."] }
    var lines = ["Open note: [\(noteId)] \(content.title.isEmpty ? "Untitled" : content.title)"]
    let headings = ManorNoteContent.headings(in: content.blocks)
    if headings.isEmpty {
      lines.append("No headings.")
    } else {
      lines.append("Outline:")
      for heading in headings.prefix(60) {
        lines.append(String(repeating: "  ", count: max(0, heading.level - 1)) + "- " + heading.title)
      }
      if headings.count > 60 { lines.append("and \(headings.count - 60) more headings") }
    }
    return lines
  }
}
