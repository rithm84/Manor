import Foundation

/// One find-in-note match: a range of a block's displayed text, or of one table cell's text.
public struct NoteFindMatch: Hashable, Sendable {
  public let blockID: String
  /// The table cell holding the match, as `(row, column)`, or `nil` for the block's own text.
  public let cell: NoteCellAddress?
  /// The range in UTF-16 units of the displayed text (`NoteFind.displayText`).
  public let range: NSRange

  public init(blockID: String, cell: NoteCellAddress? = nil, range: NSRange) {
    self.blockID = blockID
    self.cell = cell
    self.range = range
  }
}

public struct NoteCellAddress: Hashable, Sendable {
  public let row: Int
  public let column: Int
  public init(row: Int, column: Int) {
    self.row = row
    self.column = column
  }
}

/// Find in note: case-insensitive matches inside each block's text, across inline formatting but never
/// across blocks, and never inside controls.
public enum NoteFind {
  /// The object replacement character an inline atom (a mention, an equation) occupies in displayed text.
  public static let atom = "\u{FFFC}"

  /// The text a block displays, with each inline atom as one replacement character, so ranges line up with
  /// the editor's attributed text.
  public static func displayText(_ items: [NoteInline]) -> String {
    items.map { item -> String in
      switch item {
      case .text(let run): return run.text
      case .link(_, let runs, _): return runs.map(\.text).joined()
      case .mention, .math, .other: return atom
      }
    }.joined()
  }

  public static func matches(of query: String, in blocks: [NoteBlock]) -> [NoteFindMatch] {
    guard !query.isEmpty else { return [] }
    var out: [NoteFindMatch] = []
    for entry in blocks.flattened() {
      let block = entry.block
      switch block.content {
      case .inline(let items):
        out.append(contentsOf: ranges(of: query, in: displayText(items)).map { NoteFindMatch(blockID: block.id, range: $0) })
      case .plain(let text):
        out.append(contentsOf: ranges(of: query, in: text).map { NoteFindMatch(blockID: block.id, range: $0) })
      case .table(let table):
        for (rowIndex, row) in table.rows.enumerated() {
          for (columnIndex, cell) in row.cells.enumerated() {
            let address = NoteCellAddress(row: rowIndex, column: columnIndex)
            out.append(contentsOf: ranges(of: query, in: displayText(cell.content)).map { NoteFindMatch(blockID: block.id, cell: address, range: $0) })
          }
        }
      default:
        break
      }
    }
    return out
  }

  public static func ranges(of query: String, in text: String) -> [NSRange] {
    let haystack = text as NSString
    var out: [NSRange] = []
    var searchRange = NSRange(location: 0, length: haystack.length)
    while searchRange.length > 0 {
      let found = haystack.range(of: query, options: [.caseInsensitive], range: searchRange)
      guard found.location != NSNotFound, found.length > 0 else { break }
      out.append(found)
      let next = found.location + found.length
      searchRange = NSRange(location: next, length: haystack.length - next)
    }
    return out
  }
}
