import Foundation

/// Converts between stored JSON in Manor's block document format (`note_pages.content_json`) and `NoteBlock`.
///
/// The conversion is lossless. Unknown block types, props, top-level keys, inline items, and style keys are
/// kept as they were read. A block whose content the reader has not changed writes back its stored content
/// verbatim; an edited block writes the format's canonical shape, the same JSON the web editor stored.
public enum NoteDocumentCoding {
  // MARK: Decoding

  public static func blocks(from json: [JSONValue]) -> [NoteBlock] {
    json.map(block(from:))
  }

  public static func block(from value: JSONValue) -> NoteBlock {
    guard case .object(var object) = value else {
      // Not a block at all: keep it as an opaque block so it is written back unchanged.
      var source = NoteBlockSource()
      source.other = ["__value": value]
      source.hadProps = false
      source.hadChildren = false
      return NoteBlock(type: "__invalid", content: .absent, source: source)
    }
    let id = object.removeValue(forKey: "id")?.string ?? NoteBlock.newID()
    let type = object.removeValue(forKey: "type")?.string ?? "paragraph"
    var source = NoteBlockSource()
    let propsValue = object.removeValue(forKey: "props")
    var props: [String: JSONValue] = [:]
    if let propsValue {
      if case .object(let values) = propsValue { props = values } else { source.other["props"] = propsValue }
    } else {
      source.hadProps = false
    }
    let contentValue = object.removeValue(forKey: "content")
    let kind = NoteBlockKind(type: type)
    let content: NoteBlockContent = contentValue.map { parseContent($0, kind: kind) } ?? .absent
    source.storedContent = contentValue
    source.parsedContent = contentValue == nil ? nil : content
    var children: [NoteBlock] = []
    if let childrenValue = object.removeValue(forKey: "children") {
      if case .array(let items) = childrenValue { children = items.map(block(from:)) } else { source.other["children"] = childrenValue }
    } else {
      source.hadChildren = false
    }
    source.other.merge(object) { current, _ in current }
    return NoteBlock(id: id, type: type, props: props, content: content, children: children, source: source)
  }

  static func parseContent(_ value: JSONValue, kind: NoteBlockKind) -> NoteBlockContent {
    if kind.hasPlainContent {
      if let text = value.string { return .plain(text) }
      if let items = value.array, let text = plainText(items) { return .plain(text) }
      return .opaque(value)
    }
    if kind == .table {
      if let table = table(from: value) { return .table(table) }
      return .opaque(value)
    }
    switch value {
    case .array(let items):
      // Content arrays on `content: "none"` blocks (media written by importers) and unknown blocks stay as stored.
      guard kind.hasInlineContent else { return .opaque(value) }
      return .inline(inlines(from: items))
    case .string(let text) where kind.hasInlineContent:
      return .inline(text.isEmpty ? [] : [.text(text)])
    default:
      return .opaque(value)
    }
  }

  private static func plainText(_ items: [JSONValue]) -> String? {
    var text = ""
    for item in items {
      if let string = item.string { text += string; continue }
      guard item["type"]?.string == "text", let value = item["text"]?.string else { return nil }
      text += value
    }
    return text
  }

  public static func inlines(from items: [JSONValue]) -> [NoteInline] {
    items.map(inline(from:))
  }

  static func inline(from value: JSONValue) -> NoteInline {
    if let text = value.string { return .text(text) }
    guard case .object(let object) = value, let type = object["type"]?.string else { return .other(value) }
    switch type {
    case "text":
      guard let text = object["text"]?.string else { return .other(value) }
      let styles: NoteStyles
      if let stylesValue = object["styles"] {
        guard case .object(let stylesObject) = stylesValue else { return .other(value) }
        styles = Self.styles(from: stylesObject)
      } else {
        styles = .plain
      }
      if object.keys.contains(where: { !["type", "text", "styles"].contains($0) }) { return .other(value) }
      return .text(NoteTextRun(text, styles))
    case "link":
      guard let href = object["href"]?.string else { return .other(value) }
      var runs: [NoteTextRun] = []
      switch object["content"] {
      case .array(let items)?:
        for item in items {
          guard case .text(let run) = inline(from: item) else { return .other(value) }
          runs.append(run)
        }
      case .string(let text)?: runs = [NoteTextRun(text)]
      case nil: runs = []
      default: return .other(value)
      }
      var other = object
      for key in ["type", "href", "content"] { other.removeValue(forKey: key) }
      return .link(href: href, runs: runs, other: other)
    case "pageMention":
      let props = object["props"]?.object ?? [:]
      return .mention(pageID: props["pageId"]?.string ?? "", title: props["title"]?.string ?? "Untitled", source: object)
    case "math":
      let latex: String
      switch object["content"] {
      case .string(let text)?: latex = text
      case .array(let items)?: guard let text = plainText(items) else { return .other(value) }; latex = text
      case nil: latex = ""
      default: return .other(value)
      }
      return .math(latex: latex, source: object)
    default:
      return .other(value)
    }
  }

  static func styles(from object: [String: JSONValue]) -> NoteStyles {
    var styles = NoteStyles()
    for (key, value) in object {
      switch (key, value) {
      case ("bold", .bool(true)): styles.bold = true
      case ("italic", .bool(true)): styles.italic = true
      case ("underline", .bool(true)): styles.underline = true
      case ("strike", .bool(true)): styles.strike = true
      case ("code", .bool(true)): styles.code = true
      case ("textColor", .string(let color)): styles.textColor = color
      case ("backgroundColor", .string(let color)): styles.backgroundColor = color
      default: styles.other[key] = value
      }
    }
    return styles
  }

  static func table(from value: JSONValue) -> NoteTable? {
    guard case .object(var object) = value, object["type"]?.string == "tableContent", case .array(let rowValues)? = object["rows"] else { return nil }
    object.removeValue(forKey: "type")
    object.removeValue(forKey: "rows")
    let widths = object.removeValue(forKey: "columnWidths")
    let headerRows = object.removeValue(forKey: "headerRows")
    let headerCols = object.removeValue(forKey: "headerCols")
    var rows: [NoteTableRow] = []
    for rowValue in rowValues {
      guard case .object(var row) = rowValue, case .array(let cellValues)? = row.removeValue(forKey: "cells") else { return nil }
      var cells: [NoteTableCell] = []
      for cellValue in cellValues {
        switch cellValue {
        case .array(let items):
          cells.append(NoteTableCell(content: inlines(from: items), props: NoteTableCell.defaultProps, other: ["__legacy": true]))
        case .object(var cell) where cell["type"]?.string == "tableCell":
          cell.removeValue(forKey: "type")
          let content: [NoteInline]
          switch cell.removeValue(forKey: "content") {
          case .array(let items)?: content = inlines(from: items)
          case .string(let text)?: content = text.isEmpty ? [] : [.text(text)]
          case nil: content = []
          default: return nil
          }
          let props = cell.removeValue(forKey: "props")?.object ?? [:]
          cells.append(NoteTableCell(content: content, props: props, other: cell))
        default:
          return nil
        }
      }
      rows.append(NoteTableRow(cells: cells, other: row))
    }
    var other = object
    if headerRows != nil, headerRows?.int == nil { other["headerRows"] = headerRows }
    if headerCols != nil, headerCols?.int == nil { other["headerCols"] = headerCols }
    return NoteTable(columnWidths: widths?.array ?? [], headerRows: headerRows?.int, headerCols: headerCols?.int, rows: rows, other: other)
  }

  // MARK: Encoding

  public static func json(from blocks: [NoteBlock]) -> [JSONValue] {
    blocks.map(json(from:))
  }

  public static func json(from block: NoteBlock) -> JSONValue {
    if block.type == "__invalid", let value = block.source.other["__value"] { return value }
    var object = block.source.other
    object["id"] = .string(block.id)
    object["type"] = .string(block.type)
    if !block.props.isEmpty || (block.source.hadProps && block.source.other["props"] == nil) {
      object["props"] = .object(block.props)
    }
    if let stored = block.source.storedContent, block.content == block.source.parsedContent {
      object["content"] = stored
    } else if let encoded = contentJSON(block.content, kind: block.kind) {
      object["content"] = encoded
    }
    if !block.children.isEmpty || (block.source.hadChildren && block.source.other["children"] == nil) {
      object["children"] = .array(block.children.map(json(from:)))
    }
    return .object(object)
  }

  static func contentJSON(_ content: NoteBlockContent, kind: NoteBlockKind) -> JSONValue? {
    switch content {
    case .absent: return nil
    case .opaque(let value): return value
    case .inline(let items): return .array(inlinesJSON(items))
    case .plain(let text): return .array(text.isEmpty ? [] : [textJSON(NoteTextRun(text))])
    case .table(let table): return tableJSON(table)
    }
  }

  public static func inlinesJSON(_ items: [NoteInline]) -> [JSONValue] {
    items.map(inlineJSON)
  }

  static func inlineJSON(_ item: NoteInline) -> JSONValue {
    switch item {
    case .text(let run): return textJSON(run)
    case .link(let href, let runs, let other):
      var object = other
      object["type"] = "link"
      object["href"] = .string(href)
      object["content"] = .array(runs.map(textJSON))
      return .object(object)
    case .mention(let pageID, let title, let source):
      var object = source
      var props = object["props"]?.object ?? [:]
      if props["pageId"]?.string != pageID { props["pageId"] = .string(pageID) }
      if props["title"]?.string != title { props["title"] = .string(title) }
      object["type"] = "pageMention"
      object["props"] = .object(props)
      return .object(object)
    case .math(let latex, let source):
      var object = source
      object["type"] = "math"
      let storedLatex: String? = switch source["content"] {
      case .string(let text)?: text
      case .array(let items)?: plainText(items)
      case nil: ""
      default: nil
      }
      if storedLatex != latex { object["content"] = .string(latex) }
      return .object(object)
    case .other(let value): return value
    }
  }

  static func textJSON(_ run: NoteTextRun) -> JSONValue {
    .object(["type": "text", "text": .string(run.text), "styles": .object(stylesJSON(run.styles))])
  }

  public static func stylesJSON(_ styles: NoteStyles) -> [String: JSONValue] {
    var object = styles.other
    if styles.bold { object["bold"] = true }
    if styles.italic { object["italic"] = true }
    if styles.underline { object["underline"] = true }
    if styles.strike { object["strike"] = true }
    if styles.code { object["code"] = true }
    if let color = styles.textColor { object["textColor"] = .string(color) }
    if let color = styles.backgroundColor { object["backgroundColor"] = .string(color) }
    return object
  }

  static func tableJSON(_ table: NoteTable) -> JSONValue {
    var object = table.other
    object["type"] = "tableContent"
    object["columnWidths"] = .array(table.columnWidths)
    if let headerRows = table.headerRows { object["headerRows"] = .number(Double(headerRows)) }
    if let headerCols = table.headerCols { object["headerCols"] = .number(Double(headerCols)) }
    object["rows"] = .array(table.rows.map { row in
      var rowObject = row.other
      rowObject["cells"] = .array(row.cells.map { cell in
        if cell.other["__legacy"] == true, cell.props == NoteTableCell.defaultProps {
          return .array(inlinesJSON(cell.content))
        }
        var cellObject = cell.other
        cellObject.removeValue(forKey: "__legacy")
        cellObject["type"] = "tableCell"
        cellObject["content"] = .array(inlinesJSON(cell.content))
        cellObject["props"] = .object(cell.props)
        return .object(cellObject)
      })
      return .object(rowObject)
    })
    return .object(object)
  }
}

/// Encodes a document repeatedly as it is edited, reusing the JSON of blocks that did not change. Unchanged
/// blocks compare cheaply because they share storage with the cached copy.
public final class NoteDocumentEncoder {
  private var cache: [String: (block: NoteBlock, json: JSONValue)] = [:]

  public init() {}

  /// Forgets cached blocks (a document was loaded from outside).
  public func reset() {
    cache = [:]
    lastIDs = []
    lastOutput = []
  }

  /// `changed` names the top-level blocks known to have changed since the last call; every other cached
  /// block is reused without comparing. `nil` compares every block.
  private var lastIDs: [String] = []
  private var lastOutput: [JSONValue] = []

  public func json(from blocks: [NoteBlock], changed: Set<String>? = nil) -> [JSONValue] {
    // Same blocks in the same order with a few known changes: patch the previous output in place.
    if let changed, blocks.count == lastIDs.count, changed.count <= 8, zip(blocks, lastIDs).allSatisfy({ $0.id == $1 }) {
      var out = lastOutput
      for (index, block) in blocks.enumerated() where changed.contains(block.id) {
        let json = NoteDocumentCoding.json(from: block)
        cache[block.id] = (block, json)
        out[index] = json
      }
      lastOutput = out
      return out
    }
    let out = encodeAll(blocks, changed: changed)
    lastIDs = blocks.map(\.id)
    lastOutput = out
    return out
  }

  private func encodeAll(_ blocks: [NoteBlock], changed: Set<String>?) -> [JSONValue] {
    var next: [String: (block: NoteBlock, json: JSONValue)] = [:]
    next.reserveCapacity(blocks.count)
    let out = blocks.map { block -> JSONValue in
      if let cached = cache[block.id], let changed, !changed.contains(block.id) {
        next[block.id] = cached
        return cached.json
      }
      if let cached = cache[block.id], cached.block == block {
        next[block.id] = cached
        return cached.json
      }
      let json = NoteDocumentCoding.json(from: block)
      next[block.id] = (block, json)
      return json
    }
    cache = next
    return out
  }
}
