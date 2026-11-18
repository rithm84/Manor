import AppKit
import ManorKit
import SwiftUI

// MARK: - Floating panels

/// A borderless panel that floats beside the editor without taking key focus from the text, unless a field
/// inside it asks for it (the link editor).
final class NoteFloatingPanel: NSPanel {
  var allowsKey = false
  override var canBecomeKey: Bool { allowsKey }
  override var canBecomeMain: Bool { false }

  init() {
    super.init(contentRect: NSRect(x: 0, y: 0, width: 300, height: 200), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    isFloatingPanel = true
    becomesKeyOnlyIfNeeded = true
    hidesOnDeactivate = true
    isOpaque = false
    backgroundColor = .clear
    hasShadow = true
    level = .popUpMenu
    collectionBehavior = [.transient, .ignoresCycle]
    animationBehavior = .utilityWindow
  }
}

/// The chrome every editor popup shares: a raised card with a hairline edge.
struct NotePopupCard<Content: View>: View {
  let content: Content
  init(@ViewBuilder content: () -> Content) { self.content = content() }
  var body: some View {
    content
      .background(Palette.surfaceCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline))
      .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
  }
}

// MARK: - Slash and mention menus

struct NoteSuggestionItem: Identifiable {
  let id: String
  let title: String
  let subtitle: String
  let symbol: String
  let group: String
  var aliases: [String] = []
  let action: @MainActor (NoteEditorController, NoteTextView) -> Void
}

@MainActor @Observable
final class NoteSuggestionState {
  var items: [NoteSuggestionItem] = []
  var selected = 0
  var emptyText = "No results"
}

@MainActor
final class NoteSuggestionMenu {
  enum Mode { case slash, mention }
  weak var controller: NoteEditorController?
  private var panelStorage: NoteFloatingPanel?
  private let state = NoteSuggestionState()

  /// Created on first use, so building an editor stays cheap.
  private var panel: NoteFloatingPanel {
    if let panelStorage { return panelStorage }
    let panel = NoteFloatingPanel()
    let host = NSHostingView(rootView: NoteSuggestionList(state: state, choose: { [weak self] index in self?.choose(index) }))
    // Sized by hand in `position`; the list never resizes its window.
    host.sizingOptions = []
    panel.contentView = host
    panelStorage = panel
    return panel
  }
  private weak var textView: NoteTextView?
  private var anchor = 0
  private var mode: Mode = .slash
  private var missCount = 0
  private(set) var isOpen = false

  init() {}

  func open(_ mode: Mode, in textView: NoteTextView, anchor: Int) {
    self.mode = mode
    self.textView = textView
    self.anchor = anchor
    missCount = 0
    isOpen = true
    controller?.toolbar.hide()
    update()
  }

  func close() {
    guard isOpen else { return }
    isOpen = false
    guard let panelStorage else { return }
    panelStorage.parent?.removeChildWindow(panelStorage)
    panelStorage.orderOut(nil)
  }

  private var trigger: Character { mode == .slash ? "/" : "@" }

  /// The typed query, or `nil` when the caret left the trigger.
  private var query: String? {
    guard let textView else { return nil }
    let string = textView.string as NSString
    let caret = textView.selectedRange().location
    guard anchor < string.length, caret > anchor, textView.selectedRange().length == 0,
          string.substring(with: NSRange(location: anchor, length: 1)) == String(trigger) else { return nil }
    let query = string.substring(with: NSRange(location: anchor + 1, length: caret - anchor - 1))
    return query.contains("\n") ? nil : query
  }

  func selectionChanged(in textView: NoteTextView) {
    guard isOpen, textView === self.textView else { return }
    update()
  }

  private func update() {
    guard let controller, let textView, let query else { close(); return }
    let all = mode == .slash ? controller.slashItems() : controller.mentionItems()
    let filtered = Self.filter(all, query: query)
    if filtered.isEmpty {
      missCount += 1
      if missCount > 3 || query.hasSuffix("  ") { close(); return }
    } else {
      missCount = 0
    }
    state.items = filtered
    state.emptyText = mode == .slash ? "No matching blocks" : "No matching notes"
    state.selected = min(state.selected, max(0, filtered.count - 1))
    if query.isEmpty { state.selected = 0 }
    position(near: textView)
  }

  static func filter(_ items: [NoteSuggestionItem], query: String) -> [NoteSuggestionItem] {
    let wanted = query.lowercased().trimmingCharacters(in: .whitespaces)
    guard !wanted.isEmpty else { return items }
    return items.filter { item in
      item.title.lowercased().contains(wanted) || item.aliases.contains { $0.lowercased().hasPrefix(wanted) }
    }
  }

  private func position(near textView: NoteTextView) {
    guard let window = textView.window else { return }
    let caret = textView.rect(for: NSRange(location: anchor, length: 0))
    let inWindow = textView.convert(caret, to: nil)
    let onScreen = window.convertToScreen(inWindow)
    let rows = CGFloat(state.items.count)
    let groups = CGFloat(Set(state.items.map(\.group)).count)
    let height = min(380, max(48, rows * 44 + groups * 28 + 12))
    let width: CGFloat = mode == .slash ? 320 : 280
    var origin = NSPoint(x: onScreen.minX - 4, y: onScreen.minY - height - 6)
    if let screen = window.screen?.visibleFrame {
      if origin.y < screen.minY + 8 { origin.y = onScreen.maxY + 6 }
      origin.x = min(max(origin.x, screen.minX + 8), screen.maxX - width - 8)
    }
    panel.setFrame(NSRect(origin: origin, size: NSSize(width: width, height: height)), display: true)
    if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
    panel.orderFront(nil)
  }

  func handleKey(_ event: NSEvent) -> Bool {
    switch event.keyCode {
    case 125:
      guard !state.items.isEmpty else { return true }
      state.selected = (state.selected + 1) % state.items.count
      return true
    case 126:
      guard !state.items.isEmpty else { return true }
      state.selected = (state.selected - 1 + state.items.count) % state.items.count
      return true
    case 36, 76, 48:
      if state.items.isEmpty { close(); return false }
      choose(state.selected)
      return true
    case 53:
      close()
      return true
    default:
      return false
    }
  }

  private func choose(_ index: Int) {
    guard state.items.indices.contains(index), let textView, let controller else { return }
    let item = state.items[index]
    let caret = textView.selectedRange().location
    let range = NSRange(location: anchor, length: max(0, caret - anchor))
    close()
    // Remove the trigger and query, then run the item against the block.
    if textView.shouldChangeText(in: range, replacementString: "") {
      textView.textStorage?.replaceCharacters(in: range, with: "")
      textView.didChangeText()
      textView.setSelectedRange(NSRange(location: anchor, length: 0))
    }
    item.action(controller, textView)
  }
}

struct NoteSuggestionList: View {
  @Bindable var state: NoteSuggestionState
  let choose: (Int) -> Void
  @State private var hovered: Int?

  var body: some View {
    NotePopupCard {
      if state.items.isEmpty {
        Text(state.emptyText)
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkMuted)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .padding(Space.s3)
      } else {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
              ForEach(Array(state.items.enumerated()), id: \.element.id) { index, item in
                if index == 0 || state.items[index - 1].group != item.group {
                  Text(item.group)
                    .font(.ui(Typography.Size.xs, weight: .semibold))
                    .foregroundStyle(Palette.inkMuted)
                    .padding(.horizontal, Space.s3)
                    .padding(.top, index == 0 ? Space.s2 : Space.s3)
                    .padding(.bottom, Space.s1)
                }
                row(item, index: index).id(item.id)
              }
            }
            .padding(.horizontal, Space.s1)
            .padding(.bottom, Space.s1)
          }
          .onChange(of: state.selected) { _, selected in
            guard state.items.indices.contains(selected) else { return }
            proxy.scrollTo(state.items[selected].id)
          }
        }
      }
    }
  }

  private func row(_ item: NoteSuggestionItem, index: Int) -> some View {
    Button { choose(index) } label: {
      HStack(spacing: Space.s3) {
        Image(systemName: item.symbol)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(Palette.inkBody)
          .frame(width: 32, height: 32)
          .background(Palette.surfaceSoft, in: RoundedRectangle(cornerRadius: Radius.chip))
          .overlay(RoundedRectangle(cornerRadius: Radius.chip).strokeBorder(Palette.hairline))
        VStack(alignment: .leading, spacing: 1) {
          Text(item.title).font(.ui(Typography.Size.body, weight: .medium)).foregroundStyle(Palette.ink)
          if !item.subtitle.isEmpty {
            Text(item.subtitle).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Space.s2)
      .padding(.vertical, 6)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(index == state.selected ? Palette.surfaceHover : (hovered == index ? Palette.surfaceHover.opacity(0.6) : .clear),
                  in: RoundedRectangle(cornerRadius: Radius.chip))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 ? index : (hovered == index ? nil : hovered) }
  }
}

// MARK: - Slash items

extension NoteEditorController {
  func slashItems() -> [NoteSuggestionItem] {
    func block(_ id: String, _ title: String, _ subtitle: String, _ symbol: String, _ group: String, _ aliases: [String], _ make: @escaping @MainActor () -> NoteBlock) -> NoteSuggestionItem {
      NoteSuggestionItem(id: id, title: title, subtitle: subtitle, symbol: symbol, group: group, aliases: aliases) { controller, textView in
        controller.insertOrUpdate(make(), from: textView)
      }
    }
    var items: [NoteSuggestionItem] = [
      NoteSuggestionItem(id: "alfred", title: "Alfred", subtitle: "Write with Alfred", symbol: "sparkles", group: "Alfred",
                         aliases: ["alfred", "ai", "ask", "write", "generate"]) { controller, textView in
        controller.openAlfredComposer(insertingAt: textView.blockID)
      },
      block("paragraph", "Text", "Start writing with plain text", "text.alignleft", "Basic blocks", ["paragraph", "p", "text"]) { NoteSchema.paragraph() },
      block("h1", "Heading 1", "Big section heading", "textformat.size.larger", "Basic blocks", ["h", "heading1", "h1", "title"]) { NoteSchema.block(.heading, props: ["level": 1]) },
      block("h2", "Heading 2", "Medium section heading", "textformat.size", "Basic blocks", ["h2", "heading2", "subheading"]) { NoteSchema.block(.heading, props: ["level": 2]) },
      block("h3", "Heading 3", "Small section heading", "textformat.size.smaller", "Basic blocks", ["h3", "heading3", "subheading"]) { NoteSchema.block(.heading, props: ["level": 3]) },
      block("th1", "Toggle heading 1", "Big heading that folds its content", "chevron.right.square", "Basic blocks", ["toggle heading", "th1"]) { NoteSchema.block(.heading, props: ["level": 1, "isToggleable": true]) },
      block("th2", "Toggle heading 2", "Medium heading that folds its content", "chevron.right.square", "Basic blocks", ["toggle heading", "th2"]) { NoteSchema.block(.heading, props: ["level": 2, "isToggleable": true]) },
      block("th3", "Toggle heading 3", "Small heading that folds its content", "chevron.right.square", "Basic blocks", ["toggle heading", "th3"]) { NoteSchema.block(.heading, props: ["level": 3, "isToggleable": true]) },
      block("bullet", "Bulleted list", "A simple bulleted list", "list.bullet", "Basic blocks", ["ul", "li", "list", "bulletlist", "bullet list"]) { NoteSchema.block(.bulletListItem) },
      block("numbered", "Numbered list", "A list with numbering", "list.number", "Basic blocks", ["ol", "li", "list", "numberedlist", "numbered list"]) { NoteSchema.block(.numberedListItem) },
      block("check", "To-do list", "Track tasks with checkboxes", "checklist", "Basic blocks", ["ul", "li", "list", "checklist", "check list", "todo", "checkbox"]) { NoteSchema.block(.checkListItem) },
      block("toggle", "Toggle list", "Hide and show content", "chevron.right.circle", "Basic blocks", ["collapsable", "toggle", "toggle list", "details"]) { NoteSchema.block(.toggleListItem) },
      block("quote", "Quote", "Capture a quotation", "text.quote", "Basic blocks", ["quotation", "blockquote", "bq"]) { NoteSchema.block(.quote) },
      block("divider", "Divider", "Separate sections visually", "minus", "Basic blocks", ["hr", "horizontal rule", "line", "separator"]) { NoteSchema.block(.divider) },
      block("callout", "Callout", "Highlight a note or warning", "lightbulb", "Basic blocks", ["aside", "info", "note"]) { NoteSchema.block(.callout) },
      block("code", "Code block", "Code with syntax highlighting", "chevron.left.forwardslash.chevron.right", "Basic blocks", ["code", "pre", "codeblock"]) { NoteSchema.block(.codeBlock) },
      block("table", "Table", "A simple table", "tablecells", "Advanced", ["table", "grid"]) { NoteSchema.block(.table) },
      block("toc", "Table of contents", "Live outline of headings", "list.bullet.indent", "Advanced", ["toc", "outline", "contents"]) { NoteSchema.block(.tableOfContents) },
      block("columns", "Two columns", "Place blocks side by side", "rectangle.split.2x1", "Advanced", ["columns", "layout", "side by side"]) { NoteSchema.twoColumns() },
      block("tabs", "Tabs", "Keep related sections together", "rectangle.topthird.inset.filled", "Advanced", ["tabs", "sections"]) { NoteSchema.documentTabs() },
      block("math", "Block equation", "A displayed LaTeX equation", "function", "Advanced", ["math", "equation", "latex", "katex", "formula"]) { NoteSchema.block(.mathBlock) },
      NoteSuggestionItem(id: "inlineMath", title: "Inline equation", subtitle: "LaTeX inside a line of text", symbol: "x.squareroot", group: "Advanced",
                         aliases: ["inline math", "inline equation", "latex"]) { controller, textView in controller.insertInlineMath(textView) },
      block("image", "Image", "Upload or link an image", "photo", "Media", ["image", "imageupload", "upload", "img", "picture", "media", "url"]) { NoteSchema.block(.image) },
      block("video", "Video", "Upload or link a video", "play.rectangle", "Media", ["video", "videoupload", "upload", "mp4", "film", "media", "url"]) { NoteSchema.block(.video) },
      block("audio", "Audio", "Upload or link audio", "waveform", "Media", ["audio", "audioupload", "upload", "mp3", "sound", "media", "url"]) { NoteSchema.block(.audio) },
      block("file", "File", "Upload or link a file", "paperclip", "Media", ["file", "upload", "embed", "media", "url"]) { NoteSchema.block(.file) },
      block("bookmark", "Web bookmark", "Compact link card", "bookmark", "Media", ["bookmark", "link", "website"]) { NoteSchema.block(.webBookmark) },
      block("embed", "Web embed", "Embed a web page", "macwindow", "Media", ["embed", "iframe", "website"]) { NoteSchema.block(.webEmbed) }
    ]
    if !services.mentionCandidates.isEmpty {
      items.append(NoteSuggestionItem(id: "mention", title: "Mention a note", subtitle: "Link to another page", symbol: "doc.text", group: "Inline",
                                      aliases: ["mention", "page", "link", "@"]) { controller, textView in
        textView.insertText("@", replacementRange: textView.selectedRange())
      })
    }
    return items
  }

  func mentionItems() -> [NoteSuggestionItem] {
    services.mentionCandidates.filter { $0.id != documentID }.map { page in
      NoteSuggestionItem(id: page.id, title: page.title.isEmpty ? "Untitled" : page.title, subtitle: "", symbol: "doc.text", group: "Notes",
                         aliases: [page.title]) { controller, textView in
        controller.insertInlines([.mention(pageID: page.id, title: page.title), .text(" ")], into: textView)
      }
    }
  }

  /// Applies a slash menu block: an empty block becomes the new type in place; otherwise the new block goes below.
  func insertOrUpdate(_ template: NoteBlock, from textView: NoteTextView) {
    let id = textView.blockID
    guard let current = blocks.block(id: id) else { return }
    let isEmpty = (textView.string as NSString).length == 0
    var block = template
    let targetID: String
    if isEmpty && textView.role == .block {
      block.id = id
      block.children = current.children + template.children
      block.source = current.source
      block.source.storedContent = nil
      block.source.parsedContent = nil
      targetID = id
    } else {
      targetID = block.id
    }
    var trailing: NoteBlock?
    if block.kind == .divider || block.kind == .tableOfContents {
      // A divider or contents block is followed by a paragraph to keep writing in.
      if adjacentItem(to: id, forward: true).map({ !$0.block.kind.hasInlineContent || !$0.block.plainText.isEmpty }) ?? true {
        trailing = NoteSchema.paragraph()
      }
    }
    let focusTarget = Self.initialFocus(for: block) ?? trailing.map { NoteFocus.text($0.id, NSRange(location: 0, length: 0)) } ?? .blocks([targetID])
    mutate(focus: block.kind == .mathBlock ? nil : focusTarget) { blocks in
      if isEmpty && textView.role == .block {
        blocks.update(id: id) { $0 = block }
      } else {
        blocks.insert([block], relativeTo: id, .after)
      }
      if let trailing { blocks.insert([trailing], relativeTo: targetID, .after) }
    }
    if block.kind == .mathBlock { setMathEditing(targetID, true) }
    if block.kind.isFileBlock || block.kind == .webBookmark || block.kind == .webEmbed {
      canvas?.layoutSubtreeIfNeeded()
      (canvas?.view(for: targetID) as? NoteMediaBlockView)?.capture?.focusField()
    }
  }

  /// Where the caret goes in a freshly inserted block.
  static func initialFocus(for block: NoteBlock) -> NoteFocus? {
    let kind = block.kind
    if kind.hasInlineContent || kind == .codeBlock { return .text(block.id, NSRange(location: 0, length: 0)) }
    if kind == .table { return .cell(block.id, NoteCellAddress(row: 0, column: 0), NSRange(location: 0, length: 0)) }
    if kind == .twoColumns || kind == .documentTabs, let first = block.children.first?.children.first {
      return .text(first.id, NSRange(location: 0, length: 0))
    }
    return nil
  }

  /// The "+" in the block handle: a new block below with the slash menu open.
  func insertBlockFromHandle(near id: String, above: Bool) {
    guard let block = blocks.block(id: id) else { return }
    if block.kind == .paragraph, block.inlines.isEmpty, !above {
      focus(id, at: .start)
    } else {
      let fresh = NoteSchema.paragraph()
      mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in
        blocks.insert([fresh], relativeTo: id, above ? .before : .after)
      }
    }
    if let textView = canvas?.window?.firstResponder as? NoteTextView {
      textView.insertText("/", replacementRange: textView.selectedRange())
    }
  }

  func clickedBelowContent() {
    guard isEditable else { return }
    if let last = blocks.last, last.kind == .paragraph, last.inlines.isEmpty, last.children.isEmpty {
      focus(last.id, at: .start)
      return
    }
    let fresh = NoteSchema.paragraph()
    mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in blocks.append(fresh) }
  }

  func addParagraph(inEmpty containerID: String) {
    guard isEditable else { return }
    let fresh = NoteSchema.paragraph()
    mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in
      blocks.insert([fresh], relativeTo: containerID, .lastChild)
    }
  }

  func clickedEmptyContainerArea(_ id: String, at point: NSPoint) {}

  // MARK: Columns and tabs

  func setColumnRatio(_ id: String, ratio: Double, final: Bool) {
    guard isEditable else { return }
    if columnDragOriginID == nil {
      beginColumnDrag(id)
    }
    if final {
      endColumnDrag(id, ratio: ratio)
    } else {
      setRatioLive(id, ratio: ratio)
    }
  }

  func activeTab(in block: NoteBlock) -> String? {
    if let active = activeTabs[block.id], block.children.contains(where: { $0.id == active }) { return active }
    return block.children.first?.id
  }

  func selectTab(_ tabID: String, in tabsID: String) {
    setActiveTab(tabID, in: tabsID)
    canvas?.view(for: tabsID)?.needsDisplay = true
    canvas?.layoutDocument()
  }

  func addTab(to tabsID: String) {
    guard let tabs = blocks.block(id: tabsID) else { return }
    let paragraph = NoteSchema.paragraph()
    let tab = NoteSchema.block(.documentTab, props: ["title": .string("Tab \(tabs.children.count + 1)")], children: [paragraph])
    setActiveTab(tab.id, in: tabsID)
    mutate(focus: .text(paragraph.id, NSRange(location: 0, length: 0))) { blocks in
      blocks.insert([tab], relativeTo: tabsID, .lastChild)
    }
  }

  func renameTab(_ tabID: String, to title: String) {
    updateProps(tabID, ["title": .string(title)])
  }

  func deleteTab(_ tabID: String, in tabsID: String) {
    guard let tabs = blocks.block(id: tabsID), tabs.children.count > 1, let index = tabs.children.firstIndex(where: { $0.id == tabID }) else { return }
    let neighbor = tabs.children[index == 0 ? 1 : index - 1].id
    setActiveTab(neighbor, in: tabsID)
    mutate(focus: .blocks([tabsID])) { blocks in blocks.remove(ids: [tabID]) }
  }

  // MARK: Tables

  func tableInsertRow(_ id: String, at index: Int?, focusColumn: Int? = nil) {
    guard let table = blocks.block(id: id)?.content.table else { return }
    let at = index ?? table.rows.count
    let row = NoteTableRow(cells: (0..<max(table.columnCount, 1)).map { _ in NoteTableCell() })
    let focus: NoteFocus? = focusColumn.map { .cell(id, NoteCellAddress(row: at, column: $0), NSRange(location: 0, length: 0)) }
    mutate(focus: focus) { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table else { return }
        table.rows.insert(row, at: min(at, table.rows.count))
        block.content = .table(table)
      }
    }
  }

  func tableInsertColumn(_ id: String, at index: Int?) {
    mutate { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table else { return }
        let at = index ?? table.columnCount
        for row in table.rows.indices { table.rows[row].cells.insert(NoteTableCell(), at: min(at, table.rows[row].cells.count)) }
        table.columnWidths.insert(.null, at: min(at, table.columnWidths.count))
        block.content = .table(table)
      }
    }
  }

  func tableDeleteRow(_ id: String, row: Int) {
    guard let table = blocks.block(id: id)?.content.table else { return }
    if table.rows.count <= 1 { deleteBlocks([id]); return }
    mutate { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table, table.rows.indices.contains(row) else { return }
        table.rows.remove(at: row)
        if let header = table.headerRows, header > table.rows.count { table.headerRows = table.rows.count }
        block.content = .table(table)
      }
    }
  }

  func tableDeleteColumn(_ id: String, column: Int) {
    guard let table = blocks.block(id: id)?.content.table else { return }
    if table.columnCount <= 1 { deleteBlocks([id]); return }
    mutate { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table else { return }
        for row in table.rows.indices where table.rows[row].cells.indices.contains(column) { table.rows[row].cells.remove(at: column) }
        if table.columnWidths.indices.contains(column) { table.columnWidths.remove(at: column) }
        block.content = .table(table)
      }
    }
  }

  func tableToggleHeader(_ id: String, rows: Bool) {
    mutate { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table else { return }
        if rows { table.headerRows = (table.headerRows ?? 0) > 0 ? nil : 1 } else { table.headerCols = (table.headerCols ?? 0) > 0 ? nil : 1 }
        block.content = .table(table)
      }
    }
  }

  func tableSetCellProp(_ id: String, at address: NoteCellAddress, key: String, value: JSONValue) {
    mutate { blocks in
      blocks.update(id: id) { block in
        guard var table = block.content.table, table.rows.indices.contains(address.row), table.rows[address.row].cells.indices.contains(address.column) else { return }
        table.rows[address.row].cells[address.column].props[key] = value
        table.rows[address.row].cells[address.column].other.removeValue(forKey: "__legacy")
        block.content = .table(table)
      }
    }
  }

  func tableMenu(_ id: String, at address: NoteCellAddress) -> NSMenu {
    let menu = NoteActionMenu()
    menu.add("Insert row above", symbol: "arrow.up.to.line") { [weak self] in self?.tableInsertRow(id, at: address.row) }
    menu.add("Insert row below", symbol: "arrow.down.to.line") { [weak self] in self?.tableInsertRow(id, at: address.row + 1) }
    menu.add("Insert column left", symbol: "arrow.left.to.line") { [weak self] in self?.tableInsertColumn(id, at: address.column) }
    menu.add("Insert column right", symbol: "arrow.right.to.line") { [weak self] in self?.tableInsertColumn(id, at: address.column + 1) }
    menu.addItem(.separator())
    let table = blocks.block(id: id)?.content.table
    menu.add("Header row", symbol: "rectangle.topthird.inset.filled", checked: (table?.headerRows ?? 0) > 0) { [weak self] in self?.tableToggleHeader(id, rows: true) }
    menu.add("Header column", symbol: "rectangle.leadingthird.inset.filled", checked: (table?.headerCols ?? 0) > 0) { [weak self] in self?.tableToggleHeader(id, rows: false) }
    let colors = NoteActionMenu()
    let currentColor = table.flatMap { $0.rows.indices.contains(address.row) && $0.rows[address.row].cells.indices.contains(address.column) ? $0.rows[address.row].cells[address.column].props["backgroundColor"]?.string : nil } ?? "default"
    for (name, label) in NoteTheme.colorLabels {
      colors.add(label, image: NoteActionMenu.swatch(background: name), checked: currentColor == name) { [weak self] in
        self?.tableSetCellProp(id, at: address, key: "backgroundColor", value: .string(name))
      }
    }
    menu.addSubmenu("Cell color", symbol: "paintpalette", colors)
    let align = NoteActionMenu()
    for (value, label) in [("left", "Left"), ("center", "Center"), ("right", "Right")] {
      align.add(label, symbol: "text.align\(value)") { [weak self] in self?.tableSetCellProp(id, at: address, key: "textAlignment", value: .string(value)) }
    }
    menu.addSubmenu("Align", symbol: "text.alignleft", align)
    menu.addItem(.separator())
    menu.add("Delete row", symbol: "trash") { [weak self] in self?.tableDeleteRow(id, row: address.row) }
    menu.add("Delete column", symbol: "trash") { [weak self] in self?.tableDeleteColumn(id, column: address.column) }
    return menu
  }

  // MARK: Block menu

  func showBlockMenu(for ids: [String], anchor: NSView) {
    guard let menu = blockMenu(for: ids) else { return }
    menu.popUp(positioning: nil, at: NSPoint(x: anchor.bounds.maxX + 4, y: anchor.bounds.maxY), in: anchor)
  }

  /// The block menu for the handle and for right-clicks on non-text blocks.
  func blockMenu(for ids: [String]) -> NoteActionMenu? {
    let menu = NoteActionMenu()
    let selected = ids.compactMap { blocks.block(id: $0) }
    guard !selected.isEmpty else { return nil }
    if selected.count == 1, selected[0].kind == .alfred {
      alfredMenuItems(ids[0], into: menu)
      menu.addItem(.separator())
      if isEditable { menu.add("Duplicate", symbol: "plus.square.on.square", key: "d") { [weak self] in self?.duplicate(ids) } }
      if let link = services.blockLink {
        menu.add("Copy link to block", symbol: "link") { [weak self] in
          guard let url = link(ids[0]) else { return }
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(url.absoluteString, forType: .string)
          self?.showNotice("Link copied")
        }
      }
      if isEditable, let move = services.moveBlocks { menu.add("Move to note…", symbol: "arrow.right.doc.on.clipboard") { move(ids) } }
      return menu
    }
    if isEditable {
      menu.add("Ask Alfred", symbol: "sparkles", key: "j") { [weak self] in self?.askAlfredAboutBlocks(ids) }
      menu.addItem(.separator())
    }
    if isEditable, selected.count == 1, selected[0].kind == .diagram || selected[0].kind == .generativeUI {
      menu.add("Edit source", symbol: "chevron.left.forwardslash.chevron.right") { [weak self] in self?.setMathEditing(ids[0], true) }
      menu.addItem(.separator())
    }
    if isEditable, selected.allSatisfy({ $0.kind.isTextual }) {
      let turn = NoteActionMenu()
      let options: [(String, String, NoteBlockKind, [String: JSONValue])] = [
        ("Text", "text.alignleft", .paragraph, [:]), ("Heading 1", "textformat.size.larger", .heading, ["level": 1]),
        ("Heading 2", "textformat.size", .heading, ["level": 2]), ("Heading 3", "textformat.size.smaller", .heading, ["level": 3]),
        ("Bulleted list", "list.bullet", .bulletListItem, [:]), ("Numbered list", "list.number", .numberedListItem, [:]),
        ("To-do list", "checklist", .checkListItem, [:]), ("Toggle list", "chevron.right.circle", .toggleListItem, [:]),
        ("Quote", "text.quote", .quote, [:]), ("Callout", "lightbulb", .callout, [:]),
        ("Code", "chevron.left.forwardslash.chevron.right", .codeBlock, [:]), ("Block equation", "function", .mathBlock, [:])
      ]
      for (title, symbol, kind, props) in options {
        let current = selected.count == 1 && selected[0].kind == kind && (kind != .heading || selected[0].props["level"] == props["level"])
        turn.add(title, symbol: symbol, checked: current) { [weak self] in self?.turnInto(ids, kind, props: props) }
      }
      menu.addSubmenu("Turn into", symbol: "arrow.triangle.2.circlepath", turn)
    }
    if isEditable, selected.contains(where: { NoteSchema.defaultProps(for: $0.kind)["textColor"] != nil || NoteSchema.defaultProps(for: $0.kind)["backgroundColor"] != nil }) {
      let colors = NoteActionMenu()
      colors.addHeader("Text")
      for (name, label) in NoteTheme.colorLabels {
        colors.add(label, image: NoteActionMenu.swatch(text: name), checked: selected.count == 1 && (selected[0].string("textColor") ?? "default") == name) { [weak self] in
          self?.setBlockColor(ids, text: name)
        }
      }
      colors.addItem(.separator())
      colors.addHeader("Background")
      for (name, label) in NoteTheme.colorLabels {
        colors.add(label, image: NoteActionMenu.swatch(background: name), checked: selected.count == 1 && (selected[0].string("backgroundColor") ?? "default") == name) { [weak self] in
          self?.setBlockColor(ids, background: name)
        }
      }
      menu.addSubmenu("Color", symbol: "paintpalette", colors)
    }
    if isEditable, selected.count == 1, selected[0].kind == .callout {
      let tones = NoteActionMenu()
      for (tone, label) in [("plum", "Plum"), ("info", "Info"), ("warning", "Warning"), ("success", "Success")] {
        tones.add(label, symbol: NoteTheme.calloutSymbol(tone), checked: (selected[0].string("tone") ?? "plum") == tone) { [weak self] in
          self?.updateProps(ids[0], ["tone": .string(tone)])
        }
      }
      menu.addSubmenu("Callout style", symbol: "lightbulb", tones)
    }
    if isEditable, selected.count == 1, selected[0].kind == .image, !(selected[0].string("url") ?? "").isEmpty {
      menu.add("Edit image", symbol: "pencil") { [weak self] in self?.requestImageEdit(ids[0]) }
      if services.uploadAttachment != nil {
        menu.add("Replace image", symbol: "photo.on.rectangle") { [weak self] in self?.chooseAndUpload(for: ids[0], kind: .image) }
      }
    }
    if isEditable, selected.count == 1, [.video, .audio, .file].contains(selected[0].kind), !(selected[0].string("url") ?? "").isEmpty, services.uploadAttachment != nil {
      let kind: NoteUploadKind = selected[0].kind == .video ? .video : selected[0].kind == .audio ? .audio : .file
      menu.add("Replace file", symbol: "arrow.triangle.2.circlepath") { [weak self] in self?.chooseAndUpload(for: ids[0], kind: kind) }
    }
    if isEditable, selected.count == 1, selected[0].kind == .table {
      let table = selected[0].content.table
      menu.add("Header row", symbol: "rectangle.topthird.inset.filled", checked: (table?.headerRows ?? 0) > 0) { [weak self] in self?.tableToggleHeader(ids[0], rows: true) }
      menu.add("Header column", symbol: "rectangle.leadingthird.inset.filled", checked: (table?.headerCols ?? 0) > 0) { [weak self] in self?.tableToggleHeader(ids[0], rows: false) }
    }
    if menu.items.count > 0 { menu.addItem(.separator()) }
    if isEditable {
      menu.add("Duplicate", symbol: "plus.square.on.square", key: "d") { [weak self] in self?.duplicate(ids) }
    }
    menu.add("Copy", symbol: "doc.on.doc", key: "c") { [weak self] in self?.copySelectedBlocks(cut: false) }
    if let link = services.blockLink, selected.count == 1 {
      menu.add("Copy link to block", symbol: "link") { [weak self] in
        guard let url = link(ids[0]) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
        self?.showNotice("Link copied")
      }
    }
    if isEditable, let move = services.moveBlocks {
      menu.add("Move to note…", symbol: "arrow.right.doc.on.clipboard") { move(ids) }
    }
    if isEditable {
      menu.add("Move up", symbol: "arrow.up") { [weak self] in self?.moveVertically(ids, up: true) }
      menu.add("Move down", symbol: "arrow.down") { [weak self] in self?.moveVertically(ids, up: false) }
      menu.addItem(.separator())
      menu.add("Delete", symbol: "trash", key: "\u{8}", modifiers: []) { [weak self] in self?.deleteBlocks(ids) }
    }
    return menu
  }

  func decorateContextMenu(_ menu: NSMenu, for textView: NoteTextView) {
    guard isEditable, textView.role == .block, alfredOwner(of: textView.blockID) == nil else { return }
    let extra = NoteActionMenu()
    menu.insertItem(.separator(), at: 0)
    let id = textView.blockID
    let blockItem = NSMenuItem(title: "Block", action: nil, keyEquivalent: "")
    blockItem.submenu = extra
    extra.add("Select block", symbol: "square.dashed") { [weak self] in self?.selectBlocks([id]) }
    extra.add("Duplicate", symbol: "plus.square.on.square") { [weak self] in self?.duplicate([id]) }
    extra.add("Delete", symbol: "trash") { [weak self] in self?.deleteBlocks([id]) }
    menu.insertItem(blockItem, at: 0)
  }
}

/// An `NSMenu` whose items run closures.
final class NoteActionMenu: NSMenu {
  private var actions: [Int: () -> Void] = [:]
  private var counter = 0

  init() {
    super.init(title: "")
    autoenablesItems = false
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  @discardableResult
  func add(_ title: String, symbol: String? = nil, image: NSImage? = nil, checked: Bool = false, key: String = "",
           modifiers: NSEvent.ModifierFlags = .command, action: @escaping () -> Void) -> NSMenuItem {
    counter += 1
    let item = NSMenuItem(title: title, action: #selector(run(_:)), keyEquivalent: key)
    item.keyEquivalentModifierMask = modifiers
    item.target = self
    item.tag = counter
    item.state = checked ? .on : .off
    if let image { item.image = image } else if let symbol { item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    actions[counter] = action
    addItem(item)
    return item
  }

  func addSubmenu(_ title: String, symbol: String, _ submenu: NSMenu) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    item.submenu = submenu
    addItem(item)
  }

  func addHeader(_ title: String) {
    if #available(macOS 14.0, *) {
      addItem(NSMenuItem.sectionHeader(title: title))
    } else {
      let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      item.isEnabled = false
      addItem(item)
    }
  }

  @objc private func run(_ sender: NSMenuItem) { actions[sender.tag]?() }

  /// A small "A" in a text color, or a filled square in a background color, for color menus.
  static func swatch(text name: String? = nil, background: String? = nil) -> NSImage {
    NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
      let box = NSBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), xRadius: 4, yRadius: 4)
      (NoteTheme.backgroundColor(named: background) ?? NoteTheme.surfaceCard).setFill()
      box.fill()
      NoteTheme.hairline.setStroke()
      box.stroke()
      if name != nil || background == nil {
        let attributes: [NSAttributedString.Key: Any] = [.font: NoteTheme.ui(12, .semibold), .foregroundColor: NoteTheme.textColor(named: name) ?? NoteTheme.inkBody]
        let size = ("A" as NSString).size(withAttributes: attributes)
        ("A" as NSString).draw(at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2), withAttributes: attributes)
      }
      return true
    }
  }
}

// MARK: - Inline equation editor

/// A popover for an inline equation's LaTeX with a live preview.
enum NoteInlineMathEditor {
  @MainActor
  static func present(latex: String, relativeTo rect: NSRect, of view: NSView, onCommit: @escaping (String) -> Void) {
    let popover = NSPopover()
    popover.behavior = .transient
    var committed = false
    let editor = NoteInlineMathForm(initial: latex) { value in
      committed = true
      popover.performClose(nil)
      onCommit(value)
    } onCancel: {
      popover.performClose(nil)
    }
    popover.contentViewController = NSHostingController(rootView: editor)
    popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
    _ = committed
  }
}

struct NoteInlineMathForm: View {
  @State var value: String
  let onCommit: (String) -> Void
  let onCancel: () -> Void
  @FocusState private var focused: Bool

  init(initial: String, onCommit: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
    _value = State(initialValue: initial)
    self.onCommit = onCommit
    self.onCancel = onCancel
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      TextField("E = mc^2", text: $value, axis: .vertical)
        .font(.code(Typography.Size.sm))
        .textFieldStyle(.manor)
        .focused($focused)
        .onSubmit { onCommit(value) }
        .frame(width: 280)
      Group {
        if let image = NoteMath.render(value, fontSize: 17, color: NoteTheme.ink, display: false)?.image {
          // A long equation scrolls rather than widening the popover as you type.
          ScrollView(.horizontal, showsIndicators: false) { Image(nsImage: image) }
            .frame(height: image.size.height)
        } else {
          Text(value.trimmingCharacters(in: .whitespaces).isEmpty ? "Preview" : "Check the LaTeX")
            .font(.ui(Typography.Size.xs))
            .foregroundStyle(value.isEmpty ? Palette.inkMuted : Palette.overdueError)
        }
      }
      .frame(width: 280, alignment: .center)
      .frame(minHeight: 28)
      HStack {
        Spacer()
        Button("Cancel", action: onCancel).buttonStyle(.manor(.ghost, size: .small))
        Button("Done") { onCommit(value) }.buttonStyle(.manor(.primary, size: .small)).keyboardShortcut(.defaultAction)
      }
    }
    // A fixed width: the popover sizes itself from this content, so nothing in it may follow its own size.
    .frame(width: 280)
    .padding(Space.s3)
    .onAppear { focused = true }
  }
}
