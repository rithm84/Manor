import AppKit
import ManorKit

/// Keyboard handling and structural editing: splitting, merging, nesting, moving, converting, and inline styles.
extension NoteEditorController {
  // MARK: Reading order

  /// Blocks the caret and block selection walk through, in visual order (open toggles and active tabs only).
  var navigableItems: [NoteLayoutItem] {
    (canvas?.items ?? []).filter { item in
      let kind = item.block.kind
      return !(kind == .noteColumn || kind == .column || kind == .documentTab || kind == .twoColumns || kind == .columnList || kind == .documentTabs)
        && !item.isAlfredContent
    }
  }

  /// The nearest column or tab that holds a block, so merges never cross a layout boundary.
  func containerID(of id: String) -> String? {
    var current = blocks.parentID(of: id)
    while let parent = current {
      if let kind = blocks.block(id: parent)?.kind, kind == .noteColumn || kind == .column || kind == .documentTab { return parent }
      current = blocks.parentID(of: parent)
    }
    return nil
  }

  func adjacentItem(to id: String, forward: Bool) -> NoteLayoutItem? {
    let items = navigableItems
    guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
    let next = forward ? index + 1 : index - 1
    return items.indices.contains(next) ? items[next] : nil
  }

  func displayLength(_ block: NoteBlock) -> Int {
    block.kind.hasPlainContent ? (block.plainText as NSString).length : (NoteFind.displayText(block.inlines) as NSString).length
  }

  private func inlines(_ textView: NoteTextView, _ range: NSRange) -> [NoteInline] {
    guard let storage = textView.textStorage, range.length > 0 else { return [] }
    return NoteInlineText.inlines(from: storage.attributedSubstring(from: range))
  }

  // MARK: Keys in text

  func handleKeyDown(_ event: NSEvent, in textView: NoteTextView) -> Bool {
    if let owner = alfredOwner(of: textView.blockID) {
      // Text inside an Alfred block reads and copies; Escape stops a run or selects the block.
      if event.keyCode == 53 {
        if !stopAllAlfred() { selectBlocks([owner]) }
        return true
      }
      return false
    }
    if suggestions.isOpen, suggestions.handleKey(event) { return true }
    if event.keyCode == 53, escapeSelectionEdit() { return true }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    switch event.keyCode {
    case 36, 76:
      if textView.hasMarkedText() { return false }
      if flags.contains(.command) {
        guard let block = blocks.block(id: textView.blockID) else { return false }
        if block.kind == .checkListItem { toggleChecked(block.id); return true }
        if block.isToggle { toggleOpen(block.id); return true }
        if block.kind == .codeBlock || block.kind == .mathBlock { exitBlock(textView); return true }
        return false
      }
      if flags.contains(.shift) {
        // A soft line break inside the block.
        textView.insertText("\n", replacementRange: textView.selectedRange())
        return true
      }
      return false
    case 53:
      if stopAllAlfred() { return true }
      if toolbar.isVisible { toolbar.hide(); return true }
      if textView.role == .mathSource { setMathEditing(textView.blockID, false); selectBlocks([textView.blockID]); return true }
      selectBlocks([textView.blockID])
      return true
    default:
      return false
    }
  }

  func handleKeyEquivalent(_ event: NSEvent, in textView: NoteTextView) -> Bool {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard flags.contains(.command) else { return false }
    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
    let editable = isEditable
    switch (key, flags.subtracting(.command)) {
    case ("z", []): undo(); return true
    case ("z", .shift): redo(); return true
    case ("f", []): openFind(); return true
    case ("b", []) where editable && !textView.isPlain: toggleStyle(textView, \.bold); return true
    case ("i", []) where editable && !textView.isPlain: toggleStyle(textView, \.italic); return true
    case ("u", []) where editable && !textView.isPlain: toggleStyle(textView, \.underline); return true
    case ("s", .shift) where editable && !textView.isPlain, ("x", .shift) where editable && !textView.isPlain: toggleStyle(textView, \.strike); return true
    case ("e", []) where editable && !textView.isPlain: toggleStyle(textView, \.code); return true
    case ("k", []) where editable && !textView.isPlain:
      toolbar.show(for: textView, editingLink: true)
      return true
    case ("d", []) where editable:
      duplicate([textView.blockID])
      return true
    case ("j", []) where editable:
      askAlfredAboutSelection(in: textView)
      return true
    default: break
    }
    if editable, flags == [.command, .shift], event.keyCode == 126 || event.keyCode == 125 {
      moveVertically([textView.blockID], up: event.keyCode == 126)
      return true
    }
    if editable, flags == [.command, .option], let digit = Int(key), textView.role == .block {
      switch digit {
      case 0: turnInto([textView.blockID], .paragraph)
      case 1, 2, 3: turnInto([textView.blockID], .heading, props: ["level": .number(Double(digit))])
      case 4: turnInto([textView.blockID], .checkListItem)
      case 5: turnInto([textView.blockID], .bulletListItem)
      case 6: turnInto([textView.blockID], .numberedListItem)
      case 7: turnInto([textView.blockID], .toggleListItem)
      case 8: turnInto([textView.blockID], .codeBlock)
      default: return false
      }
      return true
    }
    return false
  }

  func handleCommand(_ selector: Selector, in textView: NoteTextView) -> Bool {
    if alfredOwner(of: textView.blockID) != nil { return false }
    let range = textView.selectedRange()
    let length = (textView.string as NSString).length
    switch selector {
    case #selector(NSResponder.insertNewline(_:)):
      guard isEditable else { return true }
      switch textView.role {
      case .cell: textView.insertText("\n", replacementRange: range); return true
      case .mathSource: setMathEditing(textView.blockID, false); focusAfter(textView.blockID); return true
      case .block:
        if blocks.block(id: textView.blockID)?.kind == .codeBlock { insertCodeNewline(textView); return true }
        splitBlock(textView)
        return true
      }
    case #selector(NSResponder.insertTab(_:)):
      guard isEditable else { return true }
      if case .cell(let address) = textView.role { moveCell(textView, from: address, forward: true); return true }
      if blocks.block(id: textView.blockID)?.kind == .codeBlock || textView.role == .mathSource {
        textView.insertText("  ", replacementRange: range)
        return true
      }
      indent([textView.blockID])
      return true
    case #selector(NSResponder.insertBacktab(_:)):
      guard isEditable else { return true }
      if case .cell(let address) = textView.role { moveCell(textView, from: address, forward: false); return true }
      if blocks.block(id: textView.blockID)?.kind == .codeBlock { outdentCodeLine(textView); return true }
      outdent([textView.blockID])
      return true
    case #selector(NSResponder.deleteBackward(_:)):
      guard isEditable, range.length == 0, range.location == 0, !textView.hasMarkedText() else { return false }
      if case .cell = textView.role { return true }
      if textView.role == .mathSource {
        if length == 0 { deleteBlocks([textView.blockID]) }
        return true
      }
      backspaceAtStart(textView)
      return true
    case #selector(NSResponder.deleteForward(_:)):
      guard isEditable, range.length == 0, range.location == length, textView.role == .block else { return false }
      mergeNext(into: textView)
      return true
    case #selector(NSResponder.moveUp(_:)):
      return moveCaretVertically(textView, up: true)
    case #selector(NSResponder.moveDown(_:)):
      return moveCaretVertically(textView, up: false)
    case #selector(NSResponder.moveLeft(_:)):
      guard range.length == 0, range.location == 0, textView.role == .block else { return false }
      if let previous = adjacentItem(to: textView.blockID, forward: false) {
        if previous.block.kind.isTextual && previous.block.kind != .mathBlock { focus(previous.id, at: .end) } else { selectBlocks([previous.id]) }
        return true
      }
      return false
    case #selector(NSResponder.moveRight(_:)):
      guard range.length == 0, range.location == length, textView.role == .block else { return false }
      if let next = adjacentItem(to: textView.blockID, forward: true) {
        if next.block.kind.isTextual && next.block.kind != .mathBlock { focus(next.id, at: .start) } else { selectBlocks([next.id]) }
        return true
      }
      return false
    case #selector(NSResponder.moveUpAndModifySelection(_:)):
      guard range.location == 0, textView.role == .block else { return false }
      selectBlocks([textView.blockID])
      return true
    case #selector(NSResponder.moveDownAndModifySelection(_:)):
      guard NSMaxRange(range) == length, textView.role == .block else { return false }
      selectBlocks([textView.blockID])
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      if suggestions.isOpen { suggestions.close(); return true }
      selectBlocks([textView.blockID])
      return true
    default:
      return false
    }
  }

  // MARK: Vertical caret movement

  private func moveCaretVertically(_ textView: NoteTextView, up: Bool) -> Bool {
    if suggestions.isOpen { return true }
    guard up ? textView.caretOnFirstLine : textView.caretOnLastLine, let canvas else { return false }
    let x = canvas.convert(textView.caretRect, from: textView).midX
    if case .cell(let address) = textView.role, let table = blocks.block(id: textView.blockID)?.content.table {
      let row = address.row + (up ? -1 : 1)
      if table.rows.indices.contains(row) {
        let column = min(address.column, table.rows[row].cells.count - 1)
        let target = NoteCellAddress(row: row, column: column)
        if let view = canvas.view(for: textView.blockID) as? NoteTableBlockView, let cell = view.cellView(target) {
          let index = cell.index(atX: canvas.convert(NSPoint(x: x, y: 0), to: cell).x, onFirstLine: !up)
          apply(.cell(textView.blockID, target, NSRange(location: index, length: 0)))
        }
        return true
      }
    }
    guard let target = adjacentItem(to: textView.blockID, forward: !up) else {
      // Up from the first block goes to the title above the document.
      if up, textView.role == .block, focusHeader() { return true }
      textView.setSelectedRange(NSRange(location: up ? 0 : (textView.string as NSString).length, length: 0))
      return true
    }
    caretInto(target, x: x, fromBelow: up)
    return true
  }

  /// Puts the caret into a block at a horizontal position, on its last line when arriving from below.
  func caretInto(_ item: NoteLayoutItem, x: CGFloat, fromBelow: Bool) {
    let kind = item.block.kind
    guard let canvas else { return }
    if kind.isTextual && kind != .mathBlock, let view = canvas.materialize(item.id), let textView = view.primaryTextView {
      canvas.layoutSubtreeIfNeeded()
      let local = canvas.convert(NSPoint(x: x, y: 0), to: textView).x
      let index = textView.index(atX: local, onFirstLine: !fromBelow)
      apply(.text(item.id, NSRange(location: index, length: 0)))
    } else if kind == .table, let table = item.block.content.table, !table.rows.isEmpty {
      let row = fromBelow ? table.rows.count - 1 : 0
      apply(.cell(item.id, NoteCellAddress(row: row, column: 0), NSRange(location: 0, length: 0)))
    } else {
      selectBlocks([item.id])
    }
  }

  // MARK: Enter

  private func continuationKind(of block: NoteBlock) -> NoteBlockKind {
    switch block.kind {
    case .bulletListItem, .numberedListItem, .checkListItem, .toggleListItem: return block.kind
    default: return .paragraph
    }
  }

  func splitBlock(_ textView: NoteTextView) {
    let id = textView.blockID
    guard let block = blocks.block(id: id), let storage = textView.textStorage else { return }
    suggestions.close()
    let range = textView.selectedRange()
    let length = storage.length
    if length == 0 {
      if block.kind.isListItem || block.kind == .quote || block.kind == .callout {
        if let parent = blocks.parentID(of: id), let parentKind = blocks.block(id: parent)?.kind, !parentKind.isLayoutContainer, block.kind.isListItem {
          outdent([id])
        } else {
          turnInto([id], .paragraph)
        }
        return
      }
    }
    if range.location == 0, range.length == 0, length > 0 {
      let fresh = NoteSchema.block(continuationKind(of: block))
      mutate(focus: .text(id, NSRange(location: 0, length: 0))) { blocks in
        blocks.insert([fresh], relativeTo: id, .before)
      }
      return
    }
    let left = inlines(textView, NSRange(location: 0, length: range.location))
    let right = inlines(textView, NSRange(location: NSMaxRange(range), length: length - NSMaxRange(range)))
    let childrenShowing = !block.children.isEmpty && (!block.isToggle || openToggles.contains(id))
    let intoToggle = block.isToggle && openToggles.contains(id)
    let kind: NoteBlockKind = (childrenShowing || intoToggle) && block.isToggle ? .paragraph : continuationKind(of: block)
    let fresh = NoteSchema.block(kind, content: .inline(right))
    mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in
      blocks.update(id: id) { $0.content = .inline(left) }
      if childrenShowing || intoToggle {
        blocks.insert([fresh], relativeTo: id, .firstChild)
      } else {
        blocks.insert([fresh], relativeTo: id, .after)
      }
    }
  }

  private func insertCodeNewline(_ textView: NoteTextView) {
    let text = textView.string as NSString
    let location = textView.selectedRange().location
    let lineStart = text.lineRange(for: NSRange(location: min(location, max(text.length - 1, 0)), length: 0)).location
    var indent = ""
    var index = lineStart
    while index < min(location, text.length) {
      let character = text.character(at: index)
      guard character == 32 || character == 9 else { break }
      indent.append(Character(UnicodeScalar(character)!))
      index += 1
    }
    textView.insertText("\n" + indent, replacementRange: textView.selectedRange())
  }

  private func outdentCodeLine(_ textView: NoteTextView) {
    let text = textView.string as NSString
    let location = textView.selectedRange().location
    guard text.length > 0 else { return }
    let lineStart = text.lineRange(for: NSRange(location: min(location, text.length - 1), length: 0)).location
    var remove = 0
    while remove < 2, lineStart + remove < text.length, text.character(at: lineStart + remove) == 32 { remove += 1 }
    guard remove > 0 else { return }
    let range = NSRange(location: lineStart, length: remove)
    if textView.shouldChangeText(in: range, replacementString: "") {
      textView.textStorage?.replaceCharacters(in: range, with: "")
      textView.didChangeText()
      textView.setSelectedRange(NSRange(location: max(lineStart, location - remove), length: 0))
    }
  }

  /// Leaves a code or equation block for a new paragraph below it.
  func exitBlock(_ textView: NoteTextView) {
    focusAfter(textView.blockID)
  }

  /// Focuses the text block after a block, creating a paragraph when there is none.
  func focusAfter(_ id: String) {
    if let next = adjacentItem(to: id, forward: true), next.block.kind.hasInlineContent, containerID(of: next.id) == containerID(of: id) {
      focus(next.id, at: .start)
      return
    }
    let fresh = NoteSchema.paragraph()
    mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in
      blocks.insert([fresh], relativeTo: id, .after)
    }
  }

  // MARK: Backspace and Delete

  func backspaceAtStart(_ textView: NoteTextView) {
    let id = textView.blockID
    guard let block = blocks.block(id: id) else { return }
    suggestions.close()
    let start = NoteFocus.text(id, NSRange(location: 0, length: 0))
    if block.kind != .paragraph, block.kind.hasInlineContent || block.kind == .codeBlock {
      if block.kind == .codeBlock && !block.plainText.isEmpty { return }
      turnInto([id], .paragraph, focus: start)
      return
    }
    if let parent = blocks.parentID(of: id), let parentKind = blocks.block(id: parent)?.kind, !parentKind.isLayoutContainer {
      outdent([id])
      return
    }
    let container = containerID(of: id)
    guard let previous = adjacentItem(to: id, forward: false), containerID(of: previous.id) == container else {
      if block.plainText.isEmpty, block.children.isEmpty, let next = adjacentItem(to: id, forward: true), containerID(of: next.id) == container {
        mutate(focus: .text(next.id, NSRange(location: 0, length: 0))) { blocks in blocks.remove(ids: [id]) }
      }
      return
    }
    let previousBlock = previous.block
    if previousBlock.kind.hasInlineContent {
      let joinAt = displayLength(previousBlock)
      let merged = NoteMarkdown.merged(previousBlock.inlines + block.inlines)
      mutate(focus: .text(previous.id, NSRange(location: joinAt, length: 0))) { blocks in
        blocks.remove(ids: [id])
        blocks.update(id: previous.id) { target in
          target.content = .inline(merged)
          target.children.append(contentsOf: block.children)
        }
      }
    } else if previousBlock.kind == .codeBlock, block.children.isEmpty {
      let joinAt = displayLength(previousBlock)
      mutate(focus: .text(previous.id, NSRange(location: joinAt, length: 0))) { blocks in
        blocks.remove(ids: [id])
        blocks.update(id: previous.id) { $0.content = .plain(previousBlock.plainText + block.plainText) }
      }
    } else if block.plainText.isEmpty && block.children.isEmpty {
      mutate(focus: .blocks([previous.id])) { blocks in blocks.remove(ids: [id]) }
    } else {
      selectBlocks([previous.id])
    }
  }

  func mergeNext(into textView: NoteTextView) {
    let id = textView.blockID
    guard let block = blocks.block(id: id), block.kind.hasInlineContent,
          let next = adjacentItem(to: id, forward: true), containerID(of: next.id) == containerID(of: id), next.block.kind.hasInlineContent else { return }
    let joinAt = displayLength(block)
    let nextBlock = next.block
    mutate(focus: .text(id, NSRange(location: joinAt, length: 0))) { blocks in
      blocks.remove(ids: [next.id])
      blocks.update(id: id) { target in
        target.content = .inline(NoteMarkdown.merged(block.inlines + nextBlock.inlines))
        target.children.append(contentsOf: nextBlock.children)
      }
    }
  }

  // MARK: Nesting

  private func canNest(into block: NoteBlock) -> Bool {
    let kind = block.kind
    return kind.hasInlineContent
  }

  func indent(_ ids: [String]) {
    let targets = blocks.outermost(Set(ids)).map(\.id)
    let focus = currentFocus()
    var opened: [String] = []
    mutate(focus: focus) { blocks in
      for id in targets {
        guard let path = blocks.path(of: id), let index = path.last, index > 0 else { continue }
        let parentPath = Array(path.dropLast())
        let siblings = parentPath.isEmpty ? blocks : (blocks[path: parentPath]?.children ?? [])
        let previous = siblings[index - 1]
        guard canNest(into: previous) else { continue }
        let removed = blocks.remove(ids: [id])
        blocks.insert(removed, relativeTo: previous.id, .lastChild)
        if previous.isToggle { opened.append(previous.id) }
      }
    }
    if !opened.isEmpty {
      for id in opened { if !openToggles.contains(id) { toggleOpen(id) } }
      apply(focus)
    }
  }

  func outdent(_ ids: [String]) {
    let targets = blocks.outermost(Set(ids)).map(\.id)
    let absorbFollowing = targets.count == 1
    let focus: NoteFocus = { if case .blocks = currentFocus() { return currentFocus() }; return currentFocus() }()
    mutate(focus: focus) { blocks in
      for id in targets.reversed() {
        guard let parentID = blocks.parentID(of: id), let parent = blocks.block(id: parentID), !parent.kind.isLayoutContainer,
              let index = parent.children.firstIndex(where: { $0.id == id }) else { continue }
        let following = absorbFollowing ? Array(parent.children[(index + 1)...]) : []
        var moved = parent.children[index]
        moved.children.append(contentsOf: following)
        blocks.remove(ids: Set([id] + following.map(\.id)))
        blocks.insert([moved], relativeTo: parentID, .after)
      }
    }
  }

  // MARK: Moving, duplicating, deleting

  func moveVertically(_ ids: [String], up: Bool) {
    let targets = blocks.outermost(Set(ids)).map(\.id)
    guard let first = targets.first, let path = blocks.path(of: first) else { return }
    let focus = currentFocus()
    mutate(focus: focus) { blocks in
      blocks.updateSiblings(of: path) { siblings in
        let indices = targets.compactMap { id in siblings.firstIndex { $0.id == id } }.sorted()
        guard let low = indices.first, let high = indices.last else { return }
        if up, low > 0 {
          let moved = siblings.remove(at: low - 1)
          siblings.insert(moved, at: high)
        } else if !up, high < siblings.count - 1 {
          let moved = siblings.remove(at: high + 1)
          siblings.insert(moved, at: low)
        }
      }
    }
  }

  func duplicate(_ ids: [String]) {
    let targets = blocks.outermost(Set(ids))
    guard let last = targets.last else { return }
    let copies = targets.map { $0.withFreshIDs() }
    let focus: NoteFocus
    if case .text(_, let range) = currentFocus(), targets.count == 1 { focus = .text(copies[0].id, range) } else { focus = .blocks(copies.map(\.id)) }
    mutate(focus: focus) { blocks in blocks.insert(copies, relativeTo: last.id, .after) }
  }

  func deleteBlocks(_ ids: [String]) {
    let targets = blocks.outermost(Set(ids)).map(\.id)
    guard let first = targets.first else { return }
    let removing = Set(targets.flatMap { id in blocks.block(id: id).map { [$0].allIDs } ?? [] })
    let items = navigableItems
    let firstIndex = items.firstIndex { $0.id == first } ?? 0
    let previous = items[..<min(firstIndex, items.count)].last { !removing.contains($0.id) }
    let next = items.count > firstIndex ? items[firstIndex...].first { !removing.contains($0.id) } : nil
    var fallback: NoteBlock?
    mutate { blocks in
      blocks.remove(ids: Set(targets))
      blocks = Self.collapseEmptyColumns(blocks)
      if blocks.isEmpty {
        let paragraph = NoteSchema.paragraph()
        fallback = paragraph
        blocks = [paragraph]
      }
    }
    clearBlockSelection()
    if let fallback { focus(fallback.id, at: .start) }
    else if let previous, blocks.contains(id: previous.id) {
      if previous.block.kind.isTextual { focus(previous.id, at: .end) } else { selectBlocks([previous.id]) }
    } else if let next, blocks.contains(id: next.id) {
      if next.block.kind.isTextual { focus(next.id, at: .start) } else { selectBlocks([next.id]) }
    }
  }

  /// Columns left empty by a move or delete disappear; a layout with one column left unwraps into its blocks.
  static func collapseEmptyColumns(_ blocks: [NoteBlock]) -> [NoteBlock] {
    var out: [NoteBlock] = []
    for var block in blocks {
      block.children = collapseEmptyColumns(block.children)
      if block.kind == .twoColumns || block.kind == .columnList {
        let columns = block.children.filter { !$0.children.isEmpty }
        if columns.count == block.children.count {
          out.append(block)
        } else if columns.count >= 2 {
          block.children = columns
          out.append(block)
        } else {
          out.append(contentsOf: columns.first?.children ?? [])
        }
        continue
      }
      out.append(block)
    }
    return out
  }

  func moveBlocks(_ ids: [String], to target: NoteDropTarget) {
    let moving = blocks.outermost(Set(ids))
    guard !moving.isEmpty else { return }
    let movingIDs = Set(moving.map(\.id))
    mutate(focus: .blocks(moving.map(\.id))) { blocks in
      let removed = blocks.remove(ids: movingIDs)
      switch target {
      case .before(let anchor): blocks.insert(removed, relativeTo: anchor, .before)
      case .after(let anchor): blocks.insert(removed, relativeTo: anchor, .after)
      case .firstChild(let anchor): blocks.insert(removed, relativeTo: anchor, .firstChild)
      case .columnBeside(let anchor):
        guard let original = blocks.block(id: anchor), let path = blocks.path(of: anchor) else { return }
        var layout = NoteSchema.block(.twoColumns)
        layout.children = [NoteSchema.block(.noteColumn, children: [original]), NoteSchema.block(.noteColumn, children: removed)]
        blocks.update(path: path) { $0 = layout }
      }
      blocks = Self.collapseEmptyColumns(blocks)
    }
    if case .firstChild(let anchor) = target, blocks.block(id: anchor)?.isToggle == true, !openToggles.contains(anchor) { toggleOpen(anchor) }
  }

  // MARK: Turn into and colors

  /// Converts blocks to another type, keeping their text and children.
  func turnInto(_ ids: [String], _ kind: NoteBlockKind, props extra: [String: JSONValue] = [:], focus: NoteFocus? = nil) {
    let focus = focus ?? currentFocus()
    var mathToEdit: String?
    mutate(focus: focus) { blocks in
      for id in ids {
        blocks.update(id: id) { block in
          guard block.kind.isTextual else { return }
          let defaults = NoteSchema.defaultProps(for: kind)
          var props = defaults
          for key in ["textColor", "backgroundColor", "textAlignment"] where defaults[key] != nil {
            if let value = block.props[key] { props[key] = value }
          }
          for (key, value) in extra { props[key] = value }
          if kind == block.kind, kind == .heading { props["isToggleable"] = block.props["isToggleable"] ?? false }
          let text = block.kind.hasPlainContent ? block.plainText : NoteFind.displayText(block.inlines)
          switch (block.kind.hasPlainContent, kind.hasPlainContent) {
          case (false, true): block.content = .plain(block.inlines.plainText)
          case (true, false): block.content = .inline(text.isEmpty ? [] : [.text(text)])
          default: break
          }
          if kind == .mathBlock { mathToEdit = block.id }
          block.type = kind.type
          block.props = props
        }
      }
    }
    if let mathToEdit { setMathEditing(mathToEdit, true) }
  }

  func setBlockColor(_ ids: [String], text: String? = nil, background: String? = nil) {
    mutate(focus: currentFocus()) { blocks in
      for id in ids {
        blocks.update(id: id) { block in
          let defaults = NoteSchema.defaultProps(for: block.kind)
          if let text, defaults["textColor"] != nil || block.props["textColor"] != nil { block.props["textColor"] = .string(text) }
          if let background, defaults["backgroundColor"] != nil || block.props["backgroundColor"] != nil { block.props["backgroundColor"] = .string(background) }
        }
      }
    }
  }

  // MARK: Inline styles

  func currentStyles(_ textView: NoteTextView) -> NoteStyles {
    let range = textView.selectedRange()
    guard let storage = textView.textStorage, range.length > 0 else {
      return (textView.typingAttributes[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
    }
    var common: NoteStyles?
    var allBold = true, allItalic = true, allUnderline = true, allStrike = true, allCode = true
    storage.enumerateAttribute(.noteStyles, in: range) { value, subrange, _ in
      if storage.attribute(.noteAtom, at: subrange.location, effectiveRange: nil) != nil { return }
      let styles = (value as? NoteStylesBox)?.styles ?? .plain
      if common == nil { common = styles }
      allBold = allBold && styles.bold
      allItalic = allItalic && styles.italic
      allUnderline = allUnderline && styles.underline
      allStrike = allStrike && styles.strike
      allCode = allCode && styles.code
    }
    var result = common ?? .plain
    result.bold = allBold
    result.italic = allItalic
    result.underline = allUnderline
    result.strike = allStrike
    result.code = allCode
    return result
  }

  func toggleStyle(_ textView: NoteTextView, _ key: WritableKeyPath<NoteStyles, Bool>) {
    let range = textView.selectedRange()
    guard !textView.isPlain, let style = textStyle(for: textView) else { return }
    if range.length == 0 {
      var styles = (textView.typingAttributes[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
      styles[keyPath: key].toggle()
      var typing = NoteInlineText.attributes(for: styles, base: style.baseAttributes, style: style)
      if let link = textView.typingAttributes[.noteLink] as? NoteLinkBox { NoteInlineText.applyLink(link, to: &typing) }
      textView.typingAttributes = typing
      toolbar.refresh()
      return
    }
    let on = !currentStyles(textView)[keyPath: key]
    changeStyles(textView, range: range) { $0[keyPath: key] = on }
  }

  func setInlineColor(_ textView: NoteTextView, text: String?, background: String?) {
    let range = textView.selectedRange()
    guard range.length > 0 else { return }
    changeStyles(textView, range: range) { styles in
      if let text { styles.textColor = text == "default" ? nil : text }
      if let background { styles.backgroundColor = background == "default" ? nil : background }
    }
  }

  /// Changes the styles of a range in place as one undo step.
  func changeStyles(_ textView: NoteTextView, range: NSRange, _ change: (inout NoteStyles) -> Void) {
    guard let storage = textView.textStorage, let style = textStyle(for: textView), range.length > 0,
          textView.shouldChangeText(in: range, replacementString: nil) else { return }
    breakTypingGroup()
    storage.beginEditing()
    storage.enumerateAttribute(.noteStyles, in: range) { value, subrange, _ in
      if storage.attribute(.noteAtom, at: subrange.location, effectiveRange: nil) != nil { return }
      var styles = (value as? NoteStylesBox)?.styles ?? .plain
      change(&styles)
      storage.addAttribute(.noteStyles, value: NoteStylesBox(styles), range: subrange)
    }
    NoteInlineText.restyle(storage, range: range, style: style)
    storage.endEditing()
    commitText(from: textView, coalesce: false)
    breakTypingGroup()
    textView.setSelectedRange(range)
    toolbar.refresh()
  }

  /// The link of the selection, when the whole selection is one link.
  func currentLink(_ textView: NoteTextView) -> String? {
    let range = textView.selectedRange()
    guard let storage = textView.textStorage, storage.length > 0 else { return nil }
    let location = min(range.location, storage.length - 1)
    var effective = NSRange()
    guard let link = storage.attribute(.noteLink, at: location, effectiveRange: &effective) as? NoteLinkBox else { return nil }
    return NSLocationInRange(location, effective) ? link.href : nil
  }

  /// Links the selection to an address, or removes links from it when `href` is nil.
  func setLink(_ textView: NoteTextView, href: String?) {
    var range = textView.selectedRange()
    guard let storage = textView.textStorage, let style = textStyle(for: textView) else { return }
    if range.length == 0, storage.length > 0 {
      // With only a caret inside a link, edit the whole link.
      var effective = NSRange()
      if storage.attribute(.noteLink, at: min(range.location, storage.length - 1), effectiveRange: &effective) != nil { range = effective }
    }
    guard range.length > 0, textView.shouldChangeText(in: range, replacementString: nil) else { return }
    breakTypingGroup()
    storage.beginEditing()
    if let href, !href.isEmpty {
      storage.addAttribute(.noteLink, value: NoteLinkBox(href: href, other: [:], identity: Int.random(in: 1...Int.max)), range: range)
    } else {
      storage.removeAttribute(.noteLink, range: range)
    }
    NoteInlineText.restyle(storage, range: range, style: style)
    storage.endEditing()
    commitText(from: textView, coalesce: false)
    breakTypingGroup()
    textView.setSelectedRange(NSRange(location: NSMaxRange(range), length: 0))
  }

  /// Turns the selected text into an inline equation, or inserts an empty one and opens its editor.
  func insertInlineMath(_ textView: NoteTextView) {
    guard let style = textStyle(for: textView) else { return }
    let range = textView.selectedRange()
    let latex = range.length > 0 ? (textView.string as NSString).substring(with: range) : ""
    let atom = NoteInlineText.atom(.math(latex), base: style.baseAttributes, style: style)
    textView.insertText(atom, replacementRange: range)
    if latex.isEmpty, let index = Optional(range.location) {
      _ = activateAtom(.math(""), at: index, in: textView)
    }
  }

  /// Inserts inline items at the caret, keeping their styles.
  func insertInlines(_ items: [NoteInline], into textView: NoteTextView) {
    guard let style = textStyle(for: textView) else { return }
    let text = NoteInlineText.attributedString(items, style: style)
    textView.insertText(text, replacementRange: textView.selectedRange())
  }

  // MARK: Typing rules

  /// Markdown shortcuts and menus triggered by typed characters.
  func textViewDidInsert(_ text: String, in textView: NoteTextView) {
    guard alfredOwner(of: textView.blockID) == nil else { return }
    guard isEditable, textView.role == .block, let block = blocks.block(id: textView.blockID) else { return }
    let caret = textView.selectedRange().location
    let string = textView.string as NSString
    if text == "/" && !textView.isPlain {
      let before = caret >= 2 ? string.substring(with: NSRange(location: caret - 2, length: 1)) : " "
      if before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { suggestions.open(.slash, in: textView, anchor: caret - 1) }
      return
    }
    if text == "@" && !textView.isPlain && !services.mentionCandidates.isEmpty {
      let before = caret >= 2 ? string.substring(with: NSRange(location: caret - 2, length: 1)) : " "
      if before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { suggestions.open(.mention, in: textView, anchor: caret - 1) }
      return
    }
    guard !textView.isPlain else { return }
    // Shortcuts apply at the start of any text block.
    if block.kind.hasInlineContent, text == " " || text == "-" {
      if applyBlockShortcut(textView, block: block, caret: caret) { return }
    }
    if ["*", "_", "`", "~", "$"].contains(text) { applyInlineShortcut(textView, caret: caret) }
  }

  private func applyBlockShortcut(_ textView: NoteTextView, block: NoteBlock, caret: Int) -> Bool {
    let string = textView.string as NSString
    let prefix = string.substring(to: caret)
    let id = block.id
    if prefix == "---" && string.length == 3 {
      let paragraph = NoteSchema.paragraph()
      mutate(focus: .text(paragraph.id, NSRange(location: 0, length: 0))) { blocks in
        blocks.update(id: id) { target in
          target.type = "divider"
          target.props = [:]
          target.content = .absent
        }
        blocks.insert([paragraph], relativeTo: id, .after)
      }
      return true
    }
    guard prefix.hasSuffix(" ") else { return false }
    let marker = String(prefix.dropLast())
    var kind: NoteBlockKind?
    var props: [String: JSONValue] = [:]
    switch marker {
    case "#", "##", "###", "####", "#####", "######":
      kind = .heading
      props["level"] = .number(Double(marker.count))
    case "-", "*", "+": kind = .bulletListItem
    case "[]", "[ ]": kind = .checkListItem
    case "[x]", "[X]": kind = .checkListItem; props["checked"] = true
    case ">": kind = .quote
    case "$$": kind = .mathBlock
    default:
      if marker.hasPrefix("```") {
        kind = .codeBlock
        props["language"] = .string(NoteSchema.codeLanguage(for: String(marker.dropFirst(3))))
      } else if let match = marker.wholeMatch(of: #/(\d{1,9})[.)]/#), let number = Int(match.1) {
        kind = .numberedListItem
        if number != 1 { props["start"] = .number(Double(number)) }
      }
    }
    guard let kind else { return false }
    let removeLength = (prefix as NSString).length
    let remainder = inlines(textView, NSRange(location: removeLength, length: string.length - removeLength))
    var mathID: String?
    mutate(focus: .text(id, NSRange(location: 0, length: 0))) { blocks in
      blocks.update(id: id) { target in
        target.type = kind.type
        target.props = NoteSchema.defaultProps(for: kind).merging(props) { $1 }
        if kind.hasPlainContent {
          target.content = .plain(remainder.plainText)
          if kind == .mathBlock { mathID = id }
        } else {
          target.content = .inline(remainder)
        }
      }
    }
    if let mathID { setMathEditing(mathID, true) }
    return true
  }

  private func applyInlineShortcut(_ textView: NoteTextView, caret: Int) {
    let string = textView.string as NSString
    let before = string.substring(to: caret)
    let rules: [(pattern: String, key: WritableKeyPath<NoteStyles, Bool>?, delimiter: Int)] = [
      (#"\*\*([^*\n]+)\*\*$"#, \.bold, 2),
      (#"__([^_\n]+)__$"#, \.bold, 2),
      (#"~~([^~\n]+)~~$"#, \.strike, 2),
      (#"(?<![*\w])\*([^*\s][^*\n]*)\*$"#, \.italic, 1),
      (#"(?<![_\w])_([^_\s][^_\n]*)_$"#, \.italic, 1),
      (#"`([^`\n]+)`$"#, \.code, 1),
      (#"(?<![$\\])\$([^$\s][^$\n]*)\$$"#, nil, 1)
    ]
    let searchRange = NSRange(location: 0, length: (before as NSString).length)
    for rule in rules {
      guard let regex = try? NSRegularExpression(pattern: rule.pattern),
            let match = regex.firstMatch(in: before, range: searchRange) else { continue }
      let inner = (before as NSString).substring(with: match.range(at: 1))
      if rule.key != \NoteStyles.code, inner.hasSuffix(" ") { continue }
      let start = match.range.location
      let matchLength = match.range.length
      let innerRange = NSRange(location: start + rule.delimiter, length: (inner as NSString).length)
      guard let storage = textView.textStorage, let style = textStyle(for: textView) else { return }
      breakTypingGroup()
      if let key = rule.key {
        let fragment = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: innerRange))
        fragment.enumerateAttribute(.noteStyles, in: NSRange(location: 0, length: fragment.length)) { value, subrange, _ in
          var styles = (value as? NoteStylesBox)?.styles ?? .plain
          styles[keyPath: key] = true
          fragment.addAttribute(.noteStyles, value: NoteStylesBox(styles), range: subrange)
        }
        NoteInlineText.restyle(fragment, style: style)
        textView.insertText(fragment, replacementRange: NSRange(location: start, length: matchLength))
        // Typing after the closing marker continues unstyled.
        var styles = (textView.typingAttributes[.noteStyles] as? NoteStylesBox)?.styles ?? .plain
        styles[keyPath: key] = false
        textView.typingAttributes = NoteInlineText.attributes(for: styles, base: style.baseAttributes, style: style)
      } else {
        textView.insertText(NoteInlineText.atom(.math(inner), base: style.baseAttributes, style: style), replacementRange: NSRange(location: start, length: matchLength))
      }
      breakTypingGroup()
      return
    }
  }

  // MARK: Table cells

  private func moveCell(_ textView: NoteTextView, from address: NoteCellAddress, forward: Bool) {
    guard let table = blocks.block(id: textView.blockID)?.content.table else { return }
    let columns = table.columnCount
    var row = address.row
    var column = address.column + (forward ? 1 : -1)
    if column >= columns { column = 0; row += 1 }
    if column < 0 { column = columns - 1; row -= 1 }
    if row >= table.rows.count {
      tableInsertRow(textView.blockID, at: nil, focusColumn: 0)
      return
    }
    guard row >= 0 else { return }
    let target = NoteCellAddress(row: row, column: column)
    let length = table.rows[row].cells.indices.contains(column) ? (NoteFind.displayText(table.rows[row].cells[column].content) as NSString).length : 0
    apply(.cell(textView.blockID, target, NSRange(location: 0, length: length)))
  }

  // MARK: Keys in block selection

  func handleBlockSelectionKey(_ event: NSEvent) -> Bool {
    if handlePreviewKey(event) { return true }
    let ids = selectedBlockIDs
    guard !ids.isEmpty else { return false }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    let items = navigableItems
    switch event.keyCode {
    case 53:
      if stopAllAlfred() { return true }
      clearBlockSelection()
      return true
    case 51, 117:
      if isEditable { deleteBlocks(ids) }
      return true
    case 36, 76:
      if let first = ids.first, let block = blocks.block(id: first) {
        if block.kind == .mathBlock { setMathEditing(first, true) } else { focus(first, at: .end) }
      }
      return true
    case 48:
      guard isEditable else { return true }
      if flags.contains(.shift) { outdent(ids) } else { indent(ids) }
      return true
    case 126, 125:
      let up = event.keyCode == 126
      if flags.contains(.command) && flags.contains(.shift) { if isEditable { moveVertically(ids, up: up) }; return true }
      let anchor = up ? ids.first : ids.last
      guard let anchor, let index = items.firstIndex(where: { $0.id == anchor }) else { return true }
      let nextIndex = index + (up ? -1 : 1)
      guard items.indices.contains(nextIndex) else { return true }
      let next = items[nextIndex].id
      if flags.contains(.shift) {
        let all = up ? [next] + ids : ids + [next]
        setBlockSelection(blocks.outermost(Set(all)).map(\.id))
      } else {
        setBlockSelection([next])
      }
      if let item = canvas?.item(next) { canvas?.scrollToVisible(item.frame.insetBy(dx: 0, dy: -40)) }
      return true
    default:
      return false
    }
  }

  func handleBlockSelectionKeyEquivalent(_ event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard flags.contains(.command) else { return false }
    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
    let ids = selectedBlockIDs
    switch (key, flags.subtracting(.command)) {
    case ("z", []): undo(); return true
    case ("z", .shift): redo(); return true
    case ("a", []): selectAllBlocks(from: nil); return true
    case ("c", []): copySelectedBlocks(cut: false); return true
    case ("x", []) where isEditable: copySelectedBlocks(cut: true); return true
    case ("v", []) where isEditable: pasteAfterSelectedBlocks(); return true
    case ("d", []) where isEditable && !ids.isEmpty: duplicate(ids); return true
    case ("j", []) where isEditable && !ids.isEmpty: askAlfredAboutBlocks(ids); return true
    case ("f", []): openFind(); return true
    default: break
    }
    if isEditable, !ids.isEmpty, flags == [.command, .option], let digit = Int(key) {
      let kinds: [Int: NoteBlockKind] = [0: .paragraph, 1: .heading, 2: .heading, 3: .heading, 4: .checkListItem, 5: .bulletListItem, 6: .numberedListItem, 7: .toggleListItem, 8: .codeBlock]
      guard let kind = kinds[digit] else { return false }
      turnInto(ids, kind, props: kind == .heading ? ["level": .number(Double(digit))] : [:])
      return true
    }
    return false
  }

  // MARK: Title header

  /// The editable text control inside the header (the note title), if any.
  private func headerField() -> NSView? {
    guard let header = canvas?.headerView else { return nil }
    func search(_ view: NSView) -> NSView? {
      if let field = view as? NSTextField, field.isEditable { return field }
      if let text = view as? NSTextView, text.isEditable { return text }
      for sub in view.subviews { if let found = search(sub) { return found } }
      return nil
    }
    return search(header)
  }

  /// Puts the caret at the end of the title. Returns `false` when there is no editable title.
  @discardableResult
  func focusHeader() -> Bool {
    guard let field = headerField(), let window = field.window else { return false }
    clearBlockSelection()
    guard window.makeFirstResponder(field) else { return false }
    if let editor = (field as? NSTextField)?.currentEditor() ?? (field as? NSTextView) {
      editor.selectedRange = NSRange(location: (editor.string as NSString).length, length: 0)
    }
    canvas?.scroll(.zero)
    return true
  }

  /// Down or Return from the title: the caret goes to the start of the first block.
  func focusFirstBlock() {
    if let first = navigableItems.first {
      if first.block.kind.isTextual && first.block.kind != .mathBlock { focus(first.id, at: .start) } else { selectBlocks([first.id]) }
      return
    }
    let fresh = NoteSchema.paragraph()
    mutate(focus: .text(fresh.id, NSRange(location: 0, length: 0))) { blocks in blocks.insert(fresh, at: 0) }
  }

  /// Handles Down and Return while the title has focus.
  func handleHeaderKey(keyCode: UInt16, flags: NSEvent.ModifierFlags, editor: NSTextView) -> Bool {
    guard flags.intersection([.shift, .command, .option, .control]).isEmpty, !editor.hasMarkedText() else { return false }
    switch keyCode {
    case 36, 76:
      focusFirstBlock()
      return true
    case 125:
      let length = (editor.string as NSString).length
      let end = NSMaxRange(editor.selectedRange())
      var onLastLine = end >= length
      if !onLastLine, let layoutManager = editor.layoutManager {
        var line = NSRange()
        layoutManager.lineFragmentRect(forGlyphAt: layoutManager.glyphIndexForCharacter(at: end), effectiveRange: &line)
        onLastLine = NSMaxRange(line) >= layoutManager.numberOfGlyphs
      }
      guard onLastLine else { return false }
      focusFirstBlock()
      return true
    default:
      return false
    }
  }
}
