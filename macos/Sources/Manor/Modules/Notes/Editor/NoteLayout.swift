import AppKit
import ManorKit

/// Where each block's view goes, computed for the whole document so the canvas can create views only for
/// the blocks near the visible rect.
struct NoteLayoutItem {
  var block: NoteBlock
  /// The block's own view frame in canvas coordinates (children are separate items).
  var frame: CGRect
  let depth: Int
  /// The displayed number of a numbered list item.
  let number: Int?
  let parentID: String?
  /// Whether the block's children are showing (toggles may hide them).
  let childrenVisible: Bool
  /// The full vertical extent of the block including its laid-out children.
  var extent: CGRect
  /// How deeply the block is nested inside other blocks (not layout containers); list markers cycle by it.
  var nesting = 0
  /// The Alfred block that renders this block from its source. Such blocks are read-only views, not part of
  /// the document: they can't be selected, dragged, or navigated into as blocks.
  var ownerID: String?

  var isAlfredContent: Bool { ownerID != nil }

  var id: String { block.id }
}

/// Padding and marker space around a text block's text.
struct NoteTextInsets {
  var top: CGFloat
  var bottom: CGFloat
  var left: CGFloat
  var right: CGFloat

  static func `for`(_ block: NoteBlock) -> NoteTextInsets {
    switch block.kind {
    case .heading:
      switch block.props["level"]?.int ?? 1 {
      case 1: return NoteTextInsets(top: 22, bottom: 4, left: block.isToggleHeading ? NoteTheme.markerWidth : 0, right: 0)
      case 2: return NoteTextInsets(top: 16, bottom: 3, left: block.isToggleHeading ? NoteTheme.markerWidth : 0, right: 0)
      case 3: return NoteTextInsets(top: 12, bottom: 2, left: block.isToggleHeading ? NoteTheme.markerWidth : 0, right: 0)
      default: return NoteTextInsets(top: 8, bottom: 2, left: block.isToggleHeading ? NoteTheme.markerWidth : 0, right: 0)
      }
    case .bulletListItem, .numberedListItem, .checkListItem, .toggleListItem:
      return NoteTextInsets(top: 3, bottom: 3, left: NoteTheme.markerWidth, right: 0)
    case .quote: return NoteTextInsets(top: 5, bottom: 5, left: 17, right: 0)
    case .callout: return NoteTextInsets(top: 15, bottom: 15, left: 46, right: 16)
    case .codeBlock: return NoteTextInsets(top: 38, bottom: 16, left: 18, right: 18)
    default:
      let hasBackground = (block.string("backgroundColor") ?? "default") != "default"
      return NoteTextInsets(top: hasBackground ? 5 : 3, bottom: hasBackground ? 5 : 3, left: hasBackground ? 6 : 0, right: hasBackground ? 6 : 0)
    }
  }
}

extension NoteBlock {
  var isToggleHeading: Bool { kind == .heading && props["isToggleable"]?.bool == true }
  /// Toggle list items and toggleable headings fold their children.
  var isToggle: Bool { kind == .toggleListItem || isToggleHeading }
}

/// Measures text the same way the block text views lay it out (TextKit 1, no padding), with a cache.
@MainActor
final class NoteTextMeasurer {
  static let shared = NoteTextMeasurer()

  private let storage = NSTextStorage()
  private let layoutManager = NSLayoutManager()
  private let container = NSTextContainer(size: NSSize(width: 100, height: CGFloat.greatestFiniteMagnitude))
  private struct Entry {
    let content: NoteBlockContent
    let style: NoteTextStyle
    let width: CGFloat
    let height: CGFloat
  }
  private var cache: [String: Entry] = [:]

  private init() {
    container.lineFragmentPadding = 0
    layoutManager.addTextContainer(container)
    storage.addLayoutManager(layoutManager)
  }

  func height(of text: NSAttributedString, width: CGFloat, minimumLineHeight: CGFloat) -> CGFloat {
    container.size = NSSize(width: max(width, 20), height: CGFloat.greatestFiniteMagnitude)
    storage.setAttributedString(text)
    layoutManager.ensureLayout(for: container)
    let used = text.length == 0 ? 0 : layoutManager.usedRect(for: container).height
    return max(ceil(used), minimumLineHeight)
  }

  /// The height of a block's text at a width, cached by the block's content and style.
  func height(for block: NoteBlock, key: String, content: NoteBlockContent, style: NoteTextStyle, width: CGFloat) -> CGFloat {
    if let entry = cache[key], entry.width == width, entry.style == style, entry.content == content { return entry.height }
    let text: NSAttributedString
    switch content {
    case .plain(let value): text = NoteInlineText.plainAttributedString(value, style: style)
    case .inline(let items): text = NoteInlineText.attributedString(items, style: style)
    default: text = NSAttributedString()
    }
    let height = self.height(of: text, width: width, minimumLineHeight: style.lineHeight)
    cache[key] = Entry(content: content, style: style, width: width, height: height)
    return height
  }

  func invalidate() { cache.removeAll() }
}

/// Computes the layout of a document.
@MainActor
struct NoteLayoutEngine {
  let openToggles: Set<String>
  let activeTabs: [String: String]
  /// Heights reported by views whose height depends on loaded media or live state.
  let measuredHeights: [String: CGFloat]
  /// Blocks whose equation source is open for editing.
  let editingMath: Set<String>
  let isEditable: Bool
  /// How many headings the document has, for the live contents block (asked only when one is laid out).
  let headingCount: () -> Int
  /// The blocks an Alfred block renders, and the space its own chrome takes above and below them.
  var alfredContent: (NoteBlock) -> (blocks: [NoteBlock], top: CGFloat, bottom: CGFloat) = { _ in ([], 30, 0) }
  /// A selection rewrite's preview, laid out under the block it follows.
  var selectionPreview: (anchorID: String, block: NoteBlock)?
  var previewContent: (NoteBlock) -> (blocks: [NoteBlock], top: CGFloat, bottom: CGFloat) = { _ in ([], 30, 0) }

  static let stackBreakpoint: CGFloat = 560

  func layout(_ blocks: [NoteBlock], x: CGFloat, width: CGFloat, top: CGFloat) -> (items: [NoteLayoutItem], height: CGFloat) {
    var items: [NoteLayoutItem] = []
    var y = top
    lay(blocks, x: x, width: width, y: &y, depth: 0, nesting: 0, parentID: nil, into: &items)
    return (items, y - top)
  }

  private func lay(_ blocks: [NoteBlock], x: CGFloat, width: CGFloat, y: inout CGFloat, depth: Int, nesting: Int = 0, parentID: String?,
                   owner: String? = nil, into items: inout [NoteLayoutItem]) {
    var number = 0
    var previousNumbered = false
    for block in blocks {
      var itemNumber: Int?
      if block.kind == .numberedListItem {
        number = previousNumbered ? number + 1 : min(max(block.props["start"]?.int ?? 1, 0), 999_999_999)
        itemNumber = number
        previousNumbered = true
      } else {
        previousNumbered = false
      }
      let startY = y
      switch block.kind {
      case .twoColumns, .columnList:
        layColumns(block, x: x, width: width, y: &y, depth: depth, parentID: parentID, into: &items)
      case .documentTabs:
        layTabs(block, x: x, width: width, y: &y, depth: depth, parentID: parentID, into: &items)
      case .alfred where owner == nil:
        layAlfred(block, content: alfredContent(block), x: x, width: width, y: &y, depth: depth, parentID: parentID, into: &items)
      case .noteColumn, .column, .documentTab:
        // A stray column or tab outside its container: show its children in place.
        let index = items.count
        items.append(NoteLayoutItem(block: block, frame: CGRect(x: x, y: y, width: width, height: 0), depth: depth, number: nil,
                                    parentID: parentID, childrenVisible: true, extent: .zero))
        lay(block.children, x: x, width: width, y: &y, depth: depth, parentID: block.id, into: &items)
        items[index].extent = CGRect(x: x, y: startY, width: width, height: y - startY)
      default:
        let height = ownHeight(of: block, width: width)
        let index = items.count
        let showChildren = !block.children.isEmpty && (!block.isToggle || openToggles.contains(block.id))
        items.append(NoteLayoutItem(block: block, frame: CGRect(x: x, y: y, width: width, height: height), depth: depth, number: itemNumber,
                                    parentID: parentID, childrenVisible: showChildren, extent: .zero))
        items[index].nesting = nesting
        items[index].ownerID = owner
        y += height
        if showChildren {
          lay(block.children, x: x + NoteTheme.childIndent, width: width - NoteTheme.childIndent, y: &y, depth: depth + 1, nesting: nesting + 1,
              parentID: block.id, owner: owner, into: &items)
        }
        items[index].extent = CGRect(x: x, y: startY, width: width, height: y - startY)
      }
      if owner == nil, let preview = selectionPreview, preview.anchorID == block.id {
        layAlfred(preview.block, content: previewContent(preview.block), x: x, width: width, y: &y, depth: depth, parentID: parentID,
                  into: &items, isPreview: true)
      }
    }
  }

  /// An Alfred block (or a selection preview): its own view frames chrome above and below, and its converted
  /// blocks lie between as read-only content.
  private func layAlfred(_ block: NoteBlock, content: (blocks: [NoteBlock], top: CGFloat, bottom: CGFloat), x: CGFloat, width: CGFloat,
                         y: inout CGFloat, depth: Int, parentID: String?, into items: inout [NoteLayoutItem], isPreview: Bool = false) {
    let startY = y
    let index = items.count
    items.append(NoteLayoutItem(block: block, frame: CGRect(x: x, y: y, width: width, height: 0), depth: depth, number: nil,
                                parentID: parentID, childrenVisible: true, extent: .zero))
    if isPreview { items[index].ownerID = block.id }
    y += content.top
    lay(content.blocks, x: x, width: width, y: &y, depth: depth + 1, parentID: block.id, owner: block.id, into: &items)
    y += content.bottom
    items[index].frame.size.height = y - startY
    items[index].extent = CGRect(x: x, y: startY, width: width, height: y - startY)
  }

  private func layColumns(_ block: NoteBlock, x: CGFloat, width: CGFloat, y: inout CGFloat, depth: Int, parentID: String?, into items: inout [NoteLayoutItem]) {
    let startY = y
    let index = items.count
    // The container item spans the row; it draws the column gutter and owns the resize handle.
    items.append(NoteLayoutItem(block: block, frame: CGRect(x: x, y: y, width: width, height: 0), depth: depth, number: nil,
                                parentID: parentID, childrenVisible: true, extent: .zero))
    y += 6
    let columns = block.children
    let stacked = width < NoteLayoutEngine.stackBreakpoint || columns.count < 2
    if stacked {
      for column in columns {
        let columnStart = y
        let columnIndex = items.count
        items.append(NoteLayoutItem(block: column, frame: CGRect(x: x, y: y, width: width, height: 0), depth: depth + 1, number: nil,
                                    parentID: block.id, childrenVisible: true, extent: .zero))
        lay(column.children, x: x, width: width, y: &y, depth: depth + 1, parentID: column.id, into: &items)
        if column.children.isEmpty { y += 32 }
        items[columnIndex].extent = CGRect(x: x, y: columnStart, width: width, height: y - columnStart)
        y += 10
      }
    } else {
      let widths = columnWidths(block, total: width)
      var columnX = x
      var bottom = y
      for (offset, column) in columns.enumerated() {
        var columnY = y
        let columnWidth = widths[offset]
        let columnIndex = items.count
        items.append(NoteLayoutItem(block: column, frame: CGRect(x: columnX, y: y, width: columnWidth, height: 0), depth: depth + 1, number: nil,
                                    parentID: block.id, childrenVisible: true, extent: .zero))
        lay(column.children, x: columnX, width: columnWidth, y: &columnY, depth: depth + 1, parentID: column.id, into: &items)
        if column.children.isEmpty { columnY += 32 }
        items[columnIndex].extent = CGRect(x: columnX, y: y, width: columnWidth, height: columnY - y)
        bottom = max(bottom, columnY)
        columnX += columnWidth + NoteTheme.columnGap
      }
      y = bottom
    }
    y += 6
    items[index].frame.size.height = y - startY
    items[index].extent = CGRect(x: x, y: startY, width: width, height: y - startY)
  }

  /// Column widths: the first column takes `ratio` percent (25 to 75) of two columns; more columns share evenly
  /// unless they carry `width` weights.
  func columnWidths(_ block: NoteBlock, total: CGFloat) -> [CGFloat] {
    let count = block.children.count
    guard count > 0 else { return [] }
    let available = total - NoteTheme.columnGap * CGFloat(count - 1)
    if block.kind == .twoColumns, count == 2 {
      let ratio = min(75, max(25, block.props["ratio"]?.double ?? 50)) / 100
      return [available * ratio, available * (1 - ratio)]
    }
    let weights = block.children.map { max(0.1, $0.props["width"]?.double ?? 1) }
    let sum = weights.reduce(0, +)
    return weights.map { available * $0 / sum }
  }

  private func layTabs(_ block: NoteBlock, x: CGFloat, width: CGFloat, y: inout CGFloat, depth: Int, parentID: String?, into items: inout [NoteLayoutItem]) {
    let startY = y
    let index = items.count
    let stripHeight: CGFloat = 46
    items.append(NoteLayoutItem(block: block, frame: CGRect(x: x, y: y, width: width, height: stripHeight), depth: depth, number: nil,
                                parentID: parentID, childrenVisible: true, extent: .zero))
    y += stripHeight + 4
    let tabs = block.children
    let activeID = activeTabs[block.id].flatMap { id in tabs.contains { $0.id == id } ? id : nil } ?? tabs.first?.id
    if let active = tabs.first(where: { $0.id == activeID }) {
      let tabStart = y
      let tabIndex = items.count
      items.append(NoteLayoutItem(block: active, frame: CGRect(x: x, y: y, width: width, height: 0), depth: depth + 1, number: nil,
                                  parentID: block.id, childrenVisible: true, extent: .zero))
      lay(active.children, x: x, width: width, y: &y, depth: depth + 1, parentID: active.id, into: &items)
      if active.children.isEmpty { y += 32 }
      items[tabIndex].extent = CGRect(x: x, y: tabStart, width: width, height: y - tabStart)
    }
    y += 8
    items[index].extent = CGRect(x: x, y: startY, width: width, height: y - startY)
  }

  /// The height of a block's own view, without children.
  func ownHeight(of block: NoteBlock, width: CGFloat) -> CGFloat {
    let kind = block.kind
    if kind.hasInlineContent || kind == .codeBlock {
      let insets = NoteTextInsets.for(block)
      let style = NoteTextStyle.for(block)
      let text = NoteTextMeasurer.shared.height(for: block, key: block.id, content: block.content, style: style, width: width - insets.left - insets.right)
      let outer: CGFloat = (kind == .callout || kind == .codeBlock) ? 8 : 0
      return text + insets.top + insets.bottom + outer
    }
    if kind == .diagram || kind == .generativeUI {
      let rendered = measuredHeights[block.id] ?? 180
      guard editingMath.contains(block.id) else { return rendered }
      let source = NoteTextMeasurer.shared.height(for: block, key: block.id, content: .plain(block.string("source") ?? ""),
                                                  style: NoteTextStyle(role: .mathSource), width: width - 32)
      return rendered + source + 24
    }
    if let measured = measuredHeights[block.id] { return measured }
    switch kind {
    case .divider: return 25
    case .mathBlock:
      let source: CGFloat = editingMath.contains(block.id)
        ? NoteTextMeasurer.shared.height(for: block, key: block.id, content: block.content, style: NoteTextStyle.for(block), width: width - 32) + 24
        : 0
      let latex = block.plainText
      let rendered = NoteMath.render(latex, fontSize: 19, color: NoteTheme.ink, display: true)?.image.size.height ?? 22
      return rendered + 28 + source
    case .table:
      return NoteTableMetrics.height(of: block, width: width, editable: isEditable)
    case .image: return 220
    case .video: return min(width, 720) * 9 / 16 + 34
    case .audio: return 84
    case .file: return 52
    case .webBookmark: return (block.string("url") ?? "").isEmpty ? 54 : 70
    case .webEmbed: return (block.string("url") ?? "").isEmpty ? 54 : 372
    case .tableOfContents:
      return 44 + CGFloat(max(headingCount(), 1)) * 28
    default: return 46
    }
  }
}

/// Table geometry shared by layout and the table view.
@MainActor
enum NoteTableMetrics {
  static let minColumnWidth: CGFloat = 96
  static let cellPadding = NSEdgeInsets(top: 7, left: 10, bottom: 7, right: 10)
  static let addRowHeight: CGFloat = 22

  static func columnWidths(_ table: NoteTable, available: CGFloat) -> [CGFloat] {
    let count = max(table.columnCount, 1)
    let stored = (0..<count).map { index -> CGFloat? in
      guard index < table.columnWidths.count, let value = table.columnWidths[index].double else { return nil }
      return CGFloat(value)
    }
    let fixed = stored.compactMap { $0 }.reduce(0, +)
    let flexibleCount = stored.filter { $0 == nil }.count
    let remaining = max(available - fixed - 24, CGFloat(flexibleCount) * minColumnWidth)
    let flexible = flexibleCount > 0 ? max(minColumnWidth, remaining / CGFloat(flexibleCount)) : 0
    let widths = stored.map { max(minColumnWidth * 0.6, $0 ?? flexible) }
    let total = widths.reduce(0, +)
    let limit = max(available - 24, 120)
    // Wide tables shrink to the reading column rather than overflow it.
    return total > limit ? widths.map { max(48, $0 * limit / total) } : widths
  }

  static func cellStyle(_ table: NoteTable, row: Int, column: Int, cell: NoteTableCell) -> NoteTextStyle {
    let alignment: NSTextAlignment = switch cell.props["textAlignment"]?.string {
    case "center": .center
    case "right": .right
    default: .left
    }
    var style = NoteTextStyle(role: .cell, textColorName: cell.props["textColor"]?.string, alignment: alignment)
    style.strong = isHeader(table, row: row, column: column)
    return style
  }

  static func isHeader(_ table: NoteTable, row: Int, column: Int) -> Bool {
    row < (table.headerRows ?? 0) || column < (table.headerCols ?? 0)
  }

  static func rowHeights(_ block: NoteBlock, table: NoteTable, widths: [CGFloat]) -> [CGFloat] {
    table.rows.enumerated().map { rowIndex, row in
      var height: CGFloat = 21
      for (columnIndex, cell) in row.cells.enumerated() where columnIndex < widths.count {
        let style = cellStyle(table, row: rowIndex, column: columnIndex, cell: cell)
        let key = "\(block.id)#\(rowIndex).\(columnIndex)"
        let text = NoteTextMeasurer.shared.height(for: block, key: key, content: .inline(cell.content), style: style,
                                                  width: widths[columnIndex] - cellPadding.left - cellPadding.right)
        height = max(height, text)
      }
      return height + cellPadding.top + cellPadding.bottom
    }
  }

  static func height(of block: NoteBlock, width: CGFloat, editable: Bool) -> CGFloat {
    guard let table = block.content.table else { return 46 }
    let widths = columnWidths(table, available: width)
    let rows = rowHeights(block, table: table, widths: widths).reduce(0, +)
    return rows + 12 + (editable ? addRowHeight : 0)
  }
}
