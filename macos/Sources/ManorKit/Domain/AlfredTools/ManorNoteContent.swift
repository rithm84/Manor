import Foundation

/// Note content for Alfred's tools: Markdown into stored blocks, and a note's heading outline for the snapshot.
public enum ManorNoteContent {
  /// Stored blocks for `markdown`, each with a fresh id.
  public static func blocks(fromMarkdown markdown: String) -> [JSONValue] {
    NoteRows.nativeBlocks(NoteDocumentCoding.json(from: NoteMarkdown.blocks(from: markdown)))
  }

  /// Top-level ids of `blocks`, so an append can be taken back out.
  public static func ids(_ blocks: [JSONValue]) -> [String] {
    blocks.compactMap { $0["id"]?.string }
  }

  /// The document's headings in reading order, nested ones included.
  public static func headings(in blocks: [JSONValue]) -> [(level: Int, title: String)] {
    var out: [(level: Int, title: String)] = []
    func visit(_ blocks: [NoteBlock]) {
      for block in blocks {
        if block.type == "heading" {
          let title = block.plainText.trimmingCharacters(in: .whitespacesAndNewlines)
          if !title.isEmpty { out.append((block.props["level"]?.int ?? 1, title)) }
        }
        visit(block.children)
      }
    }
    visit(NoteDocumentCoding.blocks(from: blocks))
    return out
  }
}
