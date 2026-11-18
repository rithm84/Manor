import AppKit
import ManorKit

/// A simple table: a grid of editable cells with header rows and columns, cell colors, and controls to add
/// and remove rows and columns.
final class NoteTableBlockView: NoteBlockView {
  private var cellViews: [[NoteTextView]] = []
  private var renderedTable: NoteTable?
  private var columnWidths: [CGFloat] = []
  private var rowHeights: [CGFloat] = []
  private var hovering = false
  private var trackingArea: NSTrackingArea?
  private let addRowButton = NSButton()
  private let addColumnButton = NSButton()

  override var handleAnchorY: CGFloat { 6 + (rowHeights.first ?? 34) / 2 }

  override var primaryTextView: NoteTextView? { cellViews.first?.first }

  func cellView(_ address: NoteCellAddress) -> NoteTextView? {
    guard cellViews.indices.contains(address.row), cellViews[address.row].indices.contains(address.column) else { return nil }
    return cellViews[address.row][address.column]
  }

  override func setUp() {
    for (button, symbol, tip, action) in [(addRowButton, "plus", "Add row", #selector(addRow)), (addColumnButton, "plus", "Add column", #selector(addColumn))] {
      button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tip)?.withSymbolConfiguration(.init(pointSize: 11, weight: .medium))
      button.isBordered = false
      button.contentTintColor = NoteTheme.inkMuted
      button.toolTip = tip
      button.target = self
      button.action = action
      button.wantsLayer = true
      button.layer?.cornerRadius = Radius.chip
      button.isHidden = true
      addSubview(button)
    }
  }

  @objc private func addRow() { controller?.tableInsertRow(block.id, at: nil) }
  @objc private func addColumn() { controller?.tableInsertColumn(block.id, at: nil) }

  private var table: NoteTable { block.content.table ?? NoteTable(rows: []) }

  override func blockDidChange(from previous: NoteBlock?) {
    let table = self.table
    let shapeChanged = table.rows.count != cellViews.count || zip(table.rows, cellViews).contains { $0.cells.count != $1.count }
    if shapeChanged { rebuildCells() }
    for (rowIndex, row) in table.rows.enumerated() {
      for (columnIndex, cell) in row.cells.enumerated() {
        let view = cellViews[rowIndex][columnIndex]
        view.isEditable = isEditable
        view.role = .cell(NoteCellAddress(row: rowIndex, column: columnIndex))
        view.blockID = block.id
        let previousCell = renderedTable.flatMap { $0.rows.indices.contains(rowIndex) && $0.rows[rowIndex].cells.indices.contains(columnIndex) ? $0.rows[rowIndex].cells[columnIndex] : nil }
        let headerChanged = renderedTable.map { NoteTableMetrics.isHeader($0, row: rowIndex, column: columnIndex) != NoteTableMetrics.isHeader(table, row: rowIndex, column: columnIndex) } ?? true
        if shapeChanged || previousCell != cell || headerChanged {
          render(cell, in: view, row: rowIndex, column: columnIndex, table: table)
        }
      }
    }
    renderedTable = table
    computeGeometry()
    needsLayout = true
    needsDisplay = true
  }

  /// Marks a cell's content as already shown, after the cell's text view produced it.
  func acceptEditedTable(_ table: NoteTable) { renderedTable = table }

  private func style(row: Int, column: Int, table: NoteTable, cell: NoteTableCell) -> NoteTextStyle {
    NoteTableMetrics.cellStyle(table, row: row, column: column, cell: cell)
  }

  private func render(_ cell: NoteTableCell, in view: NoteTextView, row: Int, column: Int, table: NoteTable) {
    let style = self.style(row: row, column: column, table: table, cell: cell)
    let text = NoteInlineText.attributedString(cell.content, style: style)
    let selection = view.selectedRange()
    view.textStorage?.setAttributedString(text)
    view.typingAttributes = style.baseAttributes
    if view.isFocused { view.setSelectedRange(NSRange(location: min(selection.location, text.length), length: 0)) }
  }

  private func rebuildCells() {
    cellViews.flatMap { $0 }.forEach { $0.removeFromSuperview() }
    cellViews = table.rows.map { row in
      row.cells.map { _ in
        let view = NoteTextView.make()
        view.controller = controller
        view.delegate = controller
        view.isContinuousSpellCheckingEnabled = true
        addSubview(view)
        return view
      }
    }
    renderedTable = nil
  }

  private func computeGeometry() {
    let table = self.table
    columnWidths = NoteTableMetrics.columnWidths(table, available: bounds.width)
    rowHeights = NoteTableMetrics.rowHeights(block, table: table, widths: columnWidths)
  }

  override func layout() {
    super.layout()
    computeGeometry()
    let padding = NoteTableMetrics.cellPadding
    var y: CGFloat = 6
    for (rowIndex, row) in cellViews.enumerated() {
      var x: CGFloat = 0
      let height = rowIndex < rowHeights.count ? rowHeights[rowIndex] : 34
      for (columnIndex, view) in row.enumerated() {
        let width = columnIndex < columnWidths.count ? columnWidths[columnIndex] : NoteTableMetrics.minColumnWidth
        let frame = NSRect(x: x + padding.left, y: y + padding.top, width: max(10, width - padding.left - padding.right), height: max(10, height - padding.top - padding.bottom))
        if view.frame != frame {
          view.frame = frame
          view.textContainer?.size = NSSize(width: frame.width, height: CGFloat.greatestFiniteMagnitude)
        }
        x += width
      }
      y += height
    }
    let tableWidth = columnWidths.reduce(0, +)
    let editable = isEditable
    addRowButton.frame = NSRect(x: 0, y: y + 2, width: tableWidth, height: NoteTableMetrics.addRowHeight - 4)
    addRowButton.isHidden = !(editable && hovering)
    addColumnButton.frame = NSRect(x: tableWidth + 4, y: 6, width: 18, height: max(18, y - 6))
    addColumnButton.isHidden = !(editable && hovering) || tableWidth + 24 > bounds.width
    for button in [addRowButton, addColumnButton] { button.layer?.backgroundColor = NoteTheme.surfaceSoft.cgColor }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { hovering = true; needsLayout = true }
  override func mouseExited(with event: NSEvent) { hovering = false; needsLayout = true }

  func address(at point: NSPoint) -> NoteCellAddress? {
    var y: CGFloat = 6
    for (rowIndex, height) in rowHeights.enumerated() {
      if point.y >= y && point.y < y + height {
        var x: CGFloat = 0
        for (columnIndex, width) in columnWidths.enumerated() {
          if point.x >= x && point.x < x + width { return NoteCellAddress(row: rowIndex, column: columnIndex) }
          x += width
        }
      }
      y += height
    }
    return nil
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if let address = address(at: point), let view = cellView(address) {
      window?.makeFirstResponder(view)
      view.setSelectedRange(NSRange(location: (view.string as NSString).length, length: 0))
      return
    }
    controller?.selectBlocks([block.id])
  }

  override func menu(for event: NSEvent) -> NSMenu? {
    guard isEditable, let address = address(at: convert(event.locationInWindow, from: nil)) else { return nil }
    return controller?.tableMenu(block.id, at: address)
  }

  override func refreshFindHighlights() {
    guard let controller else { return }
    for (rowIndex, row) in cellViews.enumerated() {
      for (columnIndex, view) in row.enumerated() {
        let (ranges, active) = controller.findRanges(in: block.id, cell: NoteCellAddress(row: rowIndex, column: columnIndex))
        view.setFindHighlights(ranges, active: active)
      }
    }
  }

  override func appearanceDidChange() {
    renderedTable = nil
    blockDidChange(from: nil)
  }

  override func draw(_ dirtyRect: NSRect) {
    let table = self.table
    let totalWidth = columnWidths.reduce(0, +)
    let totalHeight = rowHeights.reduce(0, +)
    let outer = NSRect(x: 0.5, y: 6.5, width: totalWidth - 1, height: totalHeight - 1)
    var y: CGFloat = 6
    for (rowIndex, row) in table.rows.enumerated() where rowIndex < rowHeights.count {
      var x: CGFloat = 0
      for (columnIndex, width) in columnWidths.enumerated() {
        let rect = NSRect(x: x, y: y, width: width, height: rowHeights[rowIndex])
        let cell = columnIndex < row.cells.count ? row.cells[columnIndex] : nil
        if let color = NoteTheme.backgroundColor(named: cell?.props["backgroundColor"]?.string) {
          color.setFill()
          rect.fill()
        } else if NoteTableMetrics.isHeader(table, row: rowIndex, column: columnIndex) {
          NoteTheme.surfaceSoft.setFill()
          rect.fill()
        }
        x += width
      }
      y += rowHeights[rowIndex]
    }
    NoteTheme.ns(Palette.hairlineStrong).setStroke()
    let grid = NSBezierPath()
    grid.lineWidth = 1
    var lineY: CGFloat = 6
    for height in rowHeights.dropLast() {
      lineY += height
      grid.move(to: NSPoint(x: 0, y: floor(lineY) + 0.5))
      grid.line(to: NSPoint(x: totalWidth, y: floor(lineY) + 0.5))
    }
    var lineX: CGFloat = 0
    for width in columnWidths.dropLast() {
      lineX += width
      grid.move(to: NSPoint(x: floor(lineX) + 0.5, y: 6))
      grid.line(to: NSPoint(x: floor(lineX) + 0.5, y: 6 + totalHeight))
    }
    grid.stroke()
    let border = NSBezierPath(roundedRect: outer, xRadius: 3, yRadius: 3)
    border.lineWidth = 1
    border.stroke()
  }
}
