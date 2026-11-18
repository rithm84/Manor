import Foundation

/// Inline styles of Manor's block document format. Booleans are present only when on; colors carry the format's
/// color names (`red`, `blue`, ...) or any CSS color a document already holds.
public struct NoteStyles: Hashable, Sendable {
  public var bold = false
  public var italic = false
  public var underline = false
  public var strike = false
  public var code = false
  public var textColor: String?
  public var backgroundColor: String?
  /// Style keys this editor does not edit, kept exactly as stored.
  public var other: [String: JSONValue] = [:]

  public init(bold: Bool = false, italic: Bool = false, underline: Bool = false, strike: Bool = false, code: Bool = false,
              textColor: String? = nil, backgroundColor: String? = nil, other: [String: JSONValue] = [:]) {
    self.bold = bold
    self.italic = italic
    self.underline = underline
    self.strike = strike
    self.code = code
    self.textColor = textColor
    self.backgroundColor = backgroundColor
    self.other = other
  }

  public static let plain = NoteStyles()
  public var isPlain: Bool { self == .plain }
}

/// A run of styled text.
public struct NoteTextRun: Hashable, Sendable {
  public var text: String
  public var styles: NoteStyles
  public init(_ text: String, _ styles: NoteStyles = .plain) {
    self.text = text
    self.styles = styles
  }
}

/// One item of a block's inline content.
public enum NoteInline: Hashable, Sendable {
  case text(NoteTextRun)
  /// A link with its styled runs. `other` keeps keys besides `type`, `href`, and `content`.
  case link(href: String, runs: [NoteTextRun], other: [String: JSONValue])
  /// An internal page mention. `source` is the stored object, so props this editor does not use survive.
  case mention(pageID: String, title: String, source: [String: JSONValue])
  /// Inline LaTeX. `source` is the stored object.
  case math(latex: String, source: [String: JSONValue])
  /// Inline content this editor does not understand, kept verbatim and shown as an atom.
  case other(JSONValue)

  public static func text(_ value: String, _ styles: NoteStyles = .plain) -> NoteInline { .text(NoteTextRun(value, styles)) }
  public static func mention(pageID: String, title: String) -> NoteInline {
    .mention(pageID: pageID, title: title, source: ["type": "pageMention", "props": ["pageId": .string(pageID), "title": .string(title)]])
  }
  public static func math(_ latex: String) -> NoteInline { .math(latex: latex, source: ["type": "math", "props": [:]]) }

  /// The text a reader sees for this item, used by search, find, slugs, and plain-text copy.
  public var plainText: String {
    switch self {
    case .text(let run): return run.text
    case .link(_, let runs, _): return runs.map(\.text).joined()
    case .mention(_, let title, _): return title
    case .math(let latex, _): return latex
    case .other(let value): return NoteInline.fallbackText(value)
    }
  }

  public static func fallbackText(_ value: JSONValue) -> String {
    if let text = value["text"]?.string { return text }
    if let content = value["content"]?.string { return content }
    if let title = value["props"]?["title"]?.string { return title }
    if let items = value["content"]?.array { return items.map(fallbackText).joined() }
    return ""
  }
}

public extension Array where Element == NoteInline {
  var plainText: String { map(\.plainText).joined() }
}

/// A table cell. Legacy cells stored as bare inline arrays keep that shape until edited.
public struct NoteTableCell: Hashable, Sendable {
  public var props: [String: JSONValue]
  public var content: [NoteInline]
  public var other: [String: JSONValue]
  public init(content: [NoteInline] = [], props: [String: JSONValue] = NoteTableCell.defaultProps, other: [String: JSONValue] = [:]) {
    self.content = content
    self.props = props
    self.other = other
  }
  public static let defaultProps: [String: JSONValue] = [
    "colspan": 1, "rowspan": 1, "backgroundColor": "default", "textColor": "default", "textAlignment": "left"
  ]
}

public struct NoteTableRow: Hashable, Sendable {
  public var cells: [NoteTableCell]
  public var other: [String: JSONValue]
  public init(cells: [NoteTableCell], other: [String: JSONValue] = [:]) {
    self.cells = cells
    self.other = other
  }
}

/// The format's `tableContent`.
public struct NoteTable: Hashable, Sendable {
  public var columnWidths: [JSONValue]
  public var headerRows: Int?
  public var headerCols: Int?
  public var rows: [NoteTableRow]
  public var other: [String: JSONValue]

  public init(columnWidths: [JSONValue] = [], headerRows: Int? = nil, headerCols: Int? = nil, rows: [NoteTableRow], other: [String: JSONValue] = [:]) {
    self.columnWidths = columnWidths
    self.headerRows = headerRows
    self.headerCols = headerCols
    self.rows = rows
    self.other = other
  }

  public var columnCount: Int { rows.map(\.cells.count).max() ?? 0 }

  /// An empty table of the given size, the way the slash menu inserts one.
  public static func empty(rows: Int, columns: Int) -> NoteTable {
    NoteTable(columnWidths: Array(repeating: .null, count: columns), rows: (0..<rows).map { _ in
      NoteTableRow(cells: (0..<columns).map { _ in NoteTableCell() })
    })
  }
}

/// What a block holds besides props and children.
public enum NoteBlockContent: Hashable, Sendable {
  /// No `content` key: blocks without content.
  case absent
  /// Styled inline content (`content: "inline"`).
  case inline([NoteInline])
  /// Unstyled text (`content: "plain"`): code and equation blocks.
  case plain(String)
  case table(NoteTable)
  /// Content this editor does not understand, kept verbatim.
  case opaque(JSONValue)

  public var inlines: [NoteInline]? { if case .inline(let items) = self { return items }; return nil }
  public var plainString: String? { if case .plain(let text) = self { return text }; return nil }
  public var table: NoteTable? { if case .table(let table) = self { return table }; return nil }

  /// The reader-visible text of the content.
  public var plainText: String {
    switch self {
    case .absent, .opaque: return ""
    case .inline(let items): return items.plainText
    case .plain(let text): return text
    case .table(let table): return table.rows.map { $0.cells.map(\.content.plainText).joined(separator: "\t") }.joined(separator: "\n")
    }
  }
}

/// How a block was stored, so an unedited block is written back exactly as it was read.
public struct NoteBlockSource: Hashable, Sendable {
  /// Keys besides `id`, `type`, `props`, `content`, and `children`.
  public var other: [String: JSONValue] = [:]
  public var hadProps = true
  public var hadChildren = true
  /// The stored `content` value and what it parsed to. While the block's content still equals `parsed`,
  /// the stored value is written back instead of a canonical re-encoding.
  public var storedContent: JSONValue?
  public var parsedContent: NoteBlockContent?
  public init() {}
}

/// One block of a note in Manor's block document format, with a stable id and nested children.
public struct NoteBlock: Hashable, Sendable, Identifiable {
  public var id: String
  public var type: String
  public var props: [String: JSONValue]
  public var content: NoteBlockContent
  public var children: [NoteBlock]
  public var source: NoteBlockSource

  public init(id: String = NoteBlock.newID(), type: String, props: [String: JSONValue] = [:], content: NoteBlockContent = .absent,
              children: [NoteBlock] = [], source: NoteBlockSource = NoteBlockSource()) {
    self.id = id
    self.type = type
    self.props = props
    self.content = content
    self.children = children
    self.source = source
  }

  /// A fresh, collision-resistant block id in UUID form.
  public static func newID() -> String { UUID().uuidString.lowercased() }

  public subscript(prop key: String) -> JSONValue? {
    get { props[key] }
    set { props[key] = newValue }
  }

  public func string(_ key: String) -> String? { props[key]?.string }
  public func number(_ key: String) -> Double? { props[key]?.double }
  public func bool(_ key: String) -> Bool? { props[key]?.bool }

  public var kind: NoteBlockKind { NoteBlockKind(type: type) }

  /// Inline items for text blocks, and the single text of plain blocks as one run.
  public var inlines: [NoteInline] {
    switch content {
    case .inline(let items): return items
    case .plain(let text): return text.isEmpty ? [] : [.text(text)]
    default: return []
    }
  }

  /// The reader-visible text. An Alfred block reads as the prose of its source (visuals left out), so it
  /// stays searchable.
  public var plainText: String {
    if type == "alfred" { return NoteAlfred.proseText(of: props["source"]?.string ?? "") }
    return content.plainText
  }

  /// A copy of this block and its descendants with fresh ids, for duplication and paste.
  public func withFreshIDs() -> NoteBlock {
    var copy = self
    copy.id = NoteBlock.newID()
    copy.children = children.map { $0.withFreshIDs() }
    return copy
  }
}
