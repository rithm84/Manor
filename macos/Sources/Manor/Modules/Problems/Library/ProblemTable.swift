import AppKit
import ManorKit
import SwiftUI

/// What a row asks the page to do.
struct ProblemRowActions {
  var open: (ProblemRecord) -> Void
  var details: (ProblemRecord, _ logging: Bool) -> Void
  var openURL: (URL) -> Void
  /// The pointer came to rest on a problem row, so its editor can warm up before it opens.
  var pointing: () -> Void = {}
}

/// The library index: an `NSTableView` that only builds the rows on screen, so ten thousand problems scroll and
/// re-filter instantly. Group headings float while their group scrolls. Return opens the selected problem and
/// Space shows its details. A click that opens a problem keeps its row as the place arrow keys continue from, but
/// draws no selection: the highlight appears only once the keyboard moves it.
struct ProblemTable: NSViewRepresentable {
  let index: ProblemLibraryIndex
  let rows: [ProblemListRow]
  let resultToken: Int
  let scrollToken: Int
  let columns: [ProblemColumn]
  let timeZone: TimeZone
  let actions: ProblemRowActions

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeNSView(context: Context) -> NSScrollView {
    let table = ProblemNSTableView()
    table.headerView = nil
    table.style = .plain
    table.backgroundColor = .clear
    table.intercellSpacing = .zero
    table.gridStyleMask = []
    table.selectionHighlightStyle = .regular
    table.allowsEmptySelection = true
    table.allowsMultipleSelection = false
    table.floatsGroupRows = true
    table.usesAutomaticRowHeights = false
    table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
    table.focusRingType = .none
    let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("problem"))
    column.resizingMask = .autoresizingMask
    table.addTableColumn(column)
    table.dataSource = context.coordinator
    table.delegate = context.coordinator
    table.coordinator = context.coordinator
    context.coordinator.table = table

    let scroll = NSScrollView()
    scroll.documentView = table
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = false
    scroll.autohidesScrollers = true
    scroll.drawsBackground = false
    scroll.contentView.postsBoundsChangedNotifications = true
    NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.scrolled), name: NSView.boundsDidChangeNotification, object: scroll.contentView)
    context.coordinator.apply(self, reload: true)
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let coordinator = context.coordinator
    let reload = coordinator.resultToken != resultToken || coordinator.columns != columns || coordinator.timeZone != timeZone
    let scrollToTop = coordinator.scrollToken != scrollToken
    coordinator.apply(self, reload: reload)
    if scrollToTop {
      coordinator.table?.deselectAll(nil)
      coordinator.table?.scrollRowToVisible(0)
      scroll.contentView.scroll(to: .zero)
      scroll.reflectScrolledClipView(scroll.contentView)
    }
  }

  static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
    NotificationCenter.default.removeObserver(coordinator)
  }

  @MainActor
  final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    weak var table: ProblemNSTableView?
    var index: ProblemLibraryIndex?
    var rows: [ProblemListRow] = []
    var resultToken = -1
    var scrollToken = 0
    var columns: [ProblemColumn] = []
    var timeZone = TimeZone.current
    var actions = ProblemRowActions(open: { _ in }, details: { _, _ in }, openURL: { _ in })

    func apply(_ view: ProblemTable, reload: Bool) {
      index = view.index
      rows = view.rows
      resultToken = view.resultToken
      scrollToken = view.scrollToken
      columns = view.columns
      timeZone = view.timeZone
      actions = view.actions
      if reload {
        let selected = table.flatMap { $0.selectedRow >= 0 ? problem(at: $0.selectedRow)?.id : nil }
        table?.reloadData()
        if let selected, let row = rows.firstIndex(where: { if case .problem(let i) = $0 { return view.index.groups[i].id == selected }; return false }) {
          table?.selectRowIndexes([row], byExtendingSelection: false)
        }
        table?.refreshHover()
      }
    }

    func problem(at row: Int) -> ProblemRecord? {
      guard rows.indices.contains(row), case .problem(let group) = rows[row], let index else { return nil }
      return index.groups[group].problem
    }

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, isGroupRow row: Int) -> Bool {
      if case .header = rows[row] { return true }
      return false
    }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
      if case .header = rows[row] { return 30 }
      return 36
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { problem(at: row) != nil }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
      let identifier = NSUserInterfaceItemIdentifier("problem-row-view")
      let view = tableView.makeView(withIdentifier: identifier, owner: nil) as? ProblemNSRowView ?? ProblemNSRowView()
      view.identifier = identifier
      view.isHovered = (tableView as? ProblemNSTableView)?.hoveredRow == row
      return view
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
      switch rows[row] {
      case .header(let label, let count):
        let identifier = NSUserInterfaceItemIdentifier("problem-header")
        let content = ProblemGroupHeading(label: label, count: count)
        if let view = tableView.makeView(withIdentifier: identifier, owner: nil) as? NSHostingView<ProblemGroupHeading> {
          view.rootView = content
          return view
        }
        let view = NSHostingView(rootView: content)
        view.sizingOptions = []
        view.identifier = identifier
        return view
      case .problem(let group):
        guard let index else { return nil }
        let identifier = NSUserInterfaceItemIdentifier("problem-cell")
        let content = ProblemRowContent(group: index.groups[group], columns: columns, timeZone: timeZone, actions: actions) { [weak self] in
          self?.select(row: row)
        }
        if let view = tableView.makeView(withIdentifier: identifier, owner: nil) as? NSHostingView<ProblemRowContent> {
          view.rootView = content
          return view
        }
        let view = NSHostingView(rootView: content)
        view.sizingOptions = []
        view.identifier = identifier
        return view
      }
    }

    /// Selects the row a click opened, so keyboard navigation continues from it on return, without highlighting it:
    /// back on the list, nothing looks chosen until an arrow key moves the selection.
    func select(row: Int) {
      guard let table else { return }
      table.showsSelection = false
      table.selectRowIndexes([row], byExtendingSelection: false)
      table.window?.makeFirstResponder(table)
    }

    func openSelected(details: Bool) {
      guard let table, table.showsSelection, let problem = problem(at: table.selectedRow) else { return }
      if details { actions.details(problem, false) } else { actions.open(problem) }
    }

    @objc func scrolled() { table?.refreshHover() }
  }
}

/// Tracks the hovered row itself, since cell views are reused while scrolling.
final class ProblemNSTableView: NSTableView {
  weak var coordinator: ProblemTable.Coordinator?
  private(set) var hoveredRow = -1
  /// False while the selection is only the anchor a click left behind; the keyboard moving it shows it again.
  var showsSelection = true {
    didSet { if oldValue != showsSelection { enumerateAvailableRowViews { view, _ in view.needsDisplay = true } } }
  }
  private var tracking: NSTrackingArea?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let tracking { removeTrackingArea(tracking) }
    let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
    addTrackingArea(area)
    tracking = area
  }

  override func mouseMoved(with event: NSEvent) {
    super.mouseMoved(with: event)
    setHovered(row(at: convert(event.locationInWindow, from: nil)))
  }

  override func mouseExited(with event: NSEvent) {
    super.mouseExited(with: event)
    setHovered(-1)
  }

  func refreshHover() {
    guard let window else { return }
    let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    setHovered(visibleRect.contains(point) ? row(at: point) : -1)
  }

  private func setHovered(_ row: Int) {
    guard row != hoveredRow else { return }
    if hoveredRow >= 0, hoveredRow < numberOfRows { (rowView(atRow: hoveredRow, makeIfNecessary: false) as? ProblemNSRowView)?.isHovered = false }
    hoveredRow = row
    if row >= 0 {
      (rowView(atRow: row, makeIfNecessary: false) as? ProblemNSRowView)?.isHovered = true
      coordinator?.actions.pointing()
    }
  }

  override func keyDown(with event: NSEvent) {
    switch event.keyCode {
    case 36, 76: coordinator?.openSelected(details: false)
    case 49: coordinator?.openSelected(details: true)
    // Up, Down, Home, End, Page Up, Page Down: moving the selection shows it.
    case 126, 125, 115, 119, 116, 121:
      showsSelection = true
      super.keyDown(with: event)
    default: super.keyDown(with: event)
    }
  }
}

/// Draws hover, keyboard selection, group-heading fill, and the hairline between problems.
final class ProblemNSRowView: NSTableRowView {
  var isHovered = false { didSet { if oldValue != isHovered { needsDisplay = true } } }

  override var isOpaque: Bool { false }

  override func drawBackground(in dirtyRect: NSRect) {
    if isGroupRowStyle {
      NSColor(Palette.surfacePaper).setFill()
      bounds.fill()
    } else if isHovered {
      NSColor(Palette.surfacePaper).setFill()
      bounds.fill()
    }
    NSColor(Palette.hairline).setFill()
    NSRect(x: 0, y: bounds.maxY - 1, width: bounds.width, height: 1).fill()
  }

  /// A hidden selection gives its row's content the ordinary text style too, so nothing on it reads as selected.
  override var interiorBackgroundStyle: NSView.BackgroundStyle {
    (superview as? ProblemNSTableView)?.showsSelection == false ? .normal : super.interiorBackgroundStyle
  }

  override func drawSelection(in dirtyRect: NSRect) {
    // A selection a click left behind draws as an ordinary row (the background pass already drew hover and the hairline).
    guard (superview as? ProblemNSTableView)?.showsSelection ?? true else { return }
    NSColor(isHovered ? Palette.surfaceSelectedHover : Palette.surfaceSelected).setFill()
    bounds.fill()
    NSColor(Palette.hairline).setFill()
    NSRect(x: 0, y: bounds.maxY - 1, width: bounds.width, height: 1).fill()
  }
}

/// Insets shared by the table header, rows, and headings so their columns line up with the page title.
enum ProblemTableLayout {
  static let edge: CGFloat = Space.s8 - Space.s3
}

struct ProblemGroupHeading: View {
  let label: String
  let count: Int

  var body: some View {
    HStack(spacing: Space.s2) {
      Text(label).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkBody)
      Text(count.formatted()).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
      Spacer(minLength: 0)
    }
    .padding(.horizontal, ProblemTableLayout.edge + Space.s3)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

/// One problem's row: its title, the chosen columns at fixed widths, and the row actions.
struct ProblemRowContent: View {
  let group: ProblemGroup
  let columns: [ProblemColumn]
  let timeZone: TimeZone
  let actions: ProblemRowActions
  let didOpen: () -> Void

  private var problem: ProblemRecord { group.problem }

  var body: some View {
    HStack(spacing: 0) {
      HStack(spacing: Space.s3) {
        Image(systemName: problem.contentAvailable ? "doc.text" : "chevron.left.forwardslash.chevron.right")
          .font(.system(size: 13, weight: .regular))
          .foregroundStyle(Palette.inkMuted)
          .frame(width: 16)
          .accessibilityHidden(true)
        Text(problem.title)
          .font(.ui(Typography.Size.sm, weight: .medium))
          .foregroundStyle(Palette.ink)
          .lineLimit(1)
          .truncationMode(.tail)
          .help(problem.title)
        if group.sources.count > 1 {
          Image(systemName: "square.stack")
            .font(.system(size: 11))
            .foregroundStyle(Palette.inkMuted)
            .help("\(group.sources.count) sources grouped here")
        }
      }
      .padding(.horizontal, Space.s3)
      .frame(maxWidth: .infinity, alignment: .leading)
      ForEach(columns, id: \.self) { column in
        cell(column)
          .padding(.horizontal, Space.s3)
          .frame(width: column.width, alignment: .leading)
          .clipped()
      }
      HStack(spacing: 2) {
        RowIconButton(systemImage: "checklist", label: "Solve history and details") { actions.details(problem, false) }
        if let url = problem.sourceUrl.flatMap(URL.init(string:)) {
          RowIconButton(systemImage: "arrow.up.right.square", label: "Open original source") { actions.openURL(url) }
        } else {
          Color.clear.frame(width: 26, height: 26)
        }
      }
      .frame(width: ProblemColumn.actionsWidth)
    }
    .padding(.horizontal, ProblemTableLayout.edge)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .contentShape(Rectangle())
    .onTapGesture {
      didOpen()
      actions.open(problem)
    }
    .contextMenu {
      Button("Open") { actions.open(problem) }
      Button("Log a solve or review…") { actions.details(problem, true) }
      Button("Solve history and details…") { actions.details(problem, false) }
      if let url = problem.sourceUrl.flatMap(URL.init(string:)) {
        Divider()
        Button("Open original source") { actions.openURL(url) }
        Button("Copy source link") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(url.absoluteString, forType: .string)
        }
      }
      Divider()
      Button("Copy title") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(problem.title, forType: .string)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .id(problem.id)
  }

  @ViewBuilder
  private func cell(_ column: ProblemColumn) -> some View {
    switch column {
    case .difficulty:
      ProblemDifficultyBadge(difficulty: problem.difficulty, estimated: problem.sourceMetadata?.difficultySource == .estimated)
    case .kind:
      Text(problem.kind.label).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).lineLimit(1)
    case .status:
      ProblemStatusLabel(status: problem.status)
    case .lastAsked:
      ProblemRecencyLabel(metadata: problem.sourceMetadata, timeZone: timeZone)
    case .topics, .companies, .tags, .collections:
      let property = ProblemLabelProperty(rawValue: column.rawValue)!
      let labels = problem.labels(property)
      if labels.isEmpty {
        Text(" ").font(.ui(Typography.Size.sm))
      } else {
        ProblemChipRow(property: property, labels: labels, available: column.width - ProblemChipMetrics.cellPadding)
      }
    }
  }
}

/// A quiet icon action inside a row, which darkens on hover.
struct RowIconButton: View {
  let systemImage: String
  let label: String
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 13, weight: .regular))
        .foregroundStyle(hovering ? Palette.primary : Palette.inkMuted)
        .frame(width: 26, height: 26)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(hovering ? Palette.surfaceHover : .clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help(label)
    .accessibilityLabel(label)
  }
}
