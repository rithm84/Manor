import AppKit
import ManorKit
import UniformTypeIdentifiers

extension NSPasteboard.PasteboardType {
  /// Blocks copied between notes, as block JSON.
  static let noteBlocks = NSPasteboard.PasteboardType("app.manor.note.blocks")
  /// Inline content copied from inside one block.
  static let noteInlines = NSPasteboard.PasteboardType("app.manor.note.inlines")
}

/// Copy and paste: block JSON between notes, rich text and Markdown in, Markdown and plain text out.
extension NoteEditorController {
  private func encode(_ values: [JSONValue]) -> Data? { try? JSONEncoder().encode(values) }
  private func decode(_ data: Data?) -> [JSONValue]? { data.flatMap { try? JSONDecoder().decode([JSONValue].self, from: $0) } }

  // MARK: Copy

  /// Copies the text selection of one block with its inline styles. Returns `false` to let the text view copy.
  func copySelection(from textView: NoteTextView, cut: Bool) -> Bool {
    let range = textView.selectedRange()
    guard range.length > 0, let storage = textView.textStorage else { return false }
    let fragment = storage.attributedSubstring(from: range)
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if textView.isPlain {
      pasteboard.setString(fragment.string, forType: .string)
    } else {
      let items = NoteInlineText.inlines(from: fragment)
      if let data = encode(NoteDocumentCoding.inlinesJSON(items)) { pasteboard.setData(data, forType: .noteInlines) }
      pasteboard.setString(NoteMarkdown.inlineMarkdown(items).isEmpty ? fragment.string : plainText(of: items), forType: .string)
      if let rtf = try? exportable(fragment).data(from: NSRange(location: 0, length: fragment.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]) {
        pasteboard.setData(rtf, forType: .rtf)
      }
    }
    if cut, isEditable, textView.shouldChangeText(in: range, replacementString: "") {
      storage.replaceCharacters(in: range, with: "")
      textView.didChangeText()
      textView.setSelectedRange(NSRange(location: range.location, length: 0))
    }
    return true
  }

  private func plainText(of items: [NoteInline]) -> String {
    items.map { item -> String in
      switch item {
      case .text(let run): return run.text
      case .link(_, let runs, _): return runs.map(\.text).joined()
      case .mention(_, let title, _): return title
      case .math(let latex, _): return "$\(latex)$"
      case .other(let value): return NoteInline.fallbackText(value)
      }
    }.joined()
  }

  /// Rich text for other apps: attachments become their text, links become real links.
  private func exportable(_ fragment: NSAttributedString) -> NSAttributedString {
    let out = NSMutableAttributedString(attributedString: fragment)
    out.enumerateAttribute(.noteAtom, in: NSRange(location: 0, length: out.length), options: .reverse) { value, range, _ in
      guard let atom = value as? NoteAtomBox else { return }
      let text = atom.inline.plainText
      var attributes = out.attributes(at: range.location, effectiveRange: nil)
      attributes.removeValue(forKey: .attachment)
      out.replaceCharacters(in: range, with: NSAttributedString(string: text, attributes: attributes))
    }
    out.enumerateAttribute(.noteLink, in: NSRange(location: 0, length: out.length)) { value, range, _ in
      if let link = value as? NoteLinkBox, let url = URL(string: link.href) { out.addAttribute(.link, value: url, range: range) }
    }
    for key in [NSAttributedString.Key.noteStyles, .noteLink, .noteAtom, .cursor, .toolTip, .baselineOffset] {
      out.removeAttribute(key, range: NSRange(location: 0, length: out.length))
    }
    return out
  }

  /// Copies selected blocks as block JSON, Markdown text, and nothing else.
  func copySelectedBlocks(cut: Bool) {
    let selected = blocks.outermost(Set(selectedBlockIDs))
    guard !selected.isEmpty else { return }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if let data = encode(NoteDocumentCoding.json(from: selected)) { pasteboard.setData(data, forType: .noteBlocks) }
    pasteboard.setString(NoteMarkdown.markdown(from: selected, document: blocks), forType: .string)
    if cut, isEditable { deleteBlocks(selected.map(\.id)) }
    else { showNotice(selected.count == 1 ? "Block copied" : "\(selected.count) blocks copied") }
  }

  func deleteSelectedBlocks() {
    guard isEditable, !selectedBlockIDs.isEmpty else { return }
    deleteBlocks(selectedBlockIDs)
  }

  // MARK: Paste

  /// Pastes into a text view. Returns `false` to let the text view paste on its own.
  func paste(into textView: NoteTextView, plain: Bool) -> Bool {
    guard isEditable else { return true }
    let pasteboard = NSPasteboard.general
    if textView.isPlain || textView.role != .block && pasteboard.data(forType: .noteBlocks) != nil && pasteboard.data(forType: .noteInlines) == nil {
      if let string = pasteboard.string(forType: .string) {
        textView.insertText(string, replacementRange: textView.selectedRange())
      }
      return true
    }
    if !plain, let values = decode(pasteboard.data(forType: .noteInlines)) {
      insertInlines(NoteDocumentCoding.inlines(from: values), into: textView)
      return true
    }
    if !plain, let values = decode(pasteboard.data(forType: .noteBlocks)) {
      let pasted = NoteDocumentCoding.blocks(from: values).map { $0.withFreshIDs() }
      insertPastedBlocks(pasted, at: textView)
      return true
    }
    if !plain, let files = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !files.isEmpty,
       let upload = services.uploadAttachment, textView.role == .block {
      insertFiles(files, after: textView.blockID, upload: upload)
      return true
    }
    if !plain, textView.role == .block, let upload = services.uploadAttachment, pasteboard.string(forType: .string) == nil,
       let image = NSImage(pasteboard: pasteboard), let png = image.notePNGData() {
      let file = FileManager.default.temporaryDirectory.appendingPathComponent("Pasted image \(Int(Date().timeIntervalSince1970)).png")
      if (try? png.write(to: file)) != nil {
        insertFiles([file], after: textView.blockID, upload: upload)
        return true
      }
    }
    if !plain, let rich = richText(from: pasteboard) {
      let hrefs = pasteboard.data(forType: .html).map(Self.originalHrefs) ?? []
      let paragraphs = rich.string.components(separatedBy: "\n")
      if paragraphs.count <= 1 || textView.role != .block {
        insertInlines(Self.restoringHrefs(NoteInlineText.inlines(fromForeign: rich), hrefs), into: textView)
      } else {
        insertPastedBlocks(Self.foreignBlocks(rich, paragraphs: paragraphs, hrefs: hrefs), at: textView)
      }
      return true
    }
    guard let string = pasteboard.string(forType: .string) else { return false }
    let selection = textView.selectedRange()
    // A web address pasted over selected text links it.
    if selection.length > 0, !string.contains(" "), !string.contains("\n"), let url = URL(string: string), url.scheme?.hasPrefix("http") == true {
      setLink(textView, href: string)
      return true
    }
    if textView.role == .block, string.contains("\n") || NoteMarkdown.looksLikeMarkdown(string) {
      let parsed = NoteMarkdown.blocks(from: string)
      if parsed.count == 1, parsed[0].kind == .paragraph {
        insertInlines(parsed[0].inlines, into: textView)
      } else if !parsed.isEmpty {
        insertPastedBlocks(parsed, at: textView)
      }
      return true
    }
    if textView.role != .block, string.contains("\n") {
      textView.insertText(string, replacementRange: selection)
      return true
    }
    textView.insertText(string.replacingOccurrences(of: "\r", with: ""), replacementRange: selection)
    return true
  }

  /// Lines of pasted rich text become blocks: list markers the HTML importer writes ("•", "1.") become list
  /// items nested by their tabs, and large bold lines become headings.
  static func foreignBlocks(_ rich: NSAttributedString, paragraphs: [String], hrefs: Set<String>) -> [NoteBlock] {
    var out: [NoteBlock] = []
    var stack: [(depth: Int, path: NoteBlockPath)] = []
    var location = 0
    for line in paragraphs {
      let length = (line as NSString).length
      var piece = rich.attributedSubstring(from: NSRange(location: location, length: length))
      location += length + 1
      if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
      let tabs = line.prefix { $0 == "\t" }.count
      let body = line.drop { $0 == "\t" }
      // The importer marks nesting with its list styles; plain tabs are the fallback.
      let lists = (piece.length > 0 ? piece.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle : nil)?.textLists.count ?? 0
      let depth = lists > 0 ? lists : tabs
      var kind: NoteBlockKind = .paragraph
      var markerLength = 0
      if let first = body.first, "•◦▪▫‣⁃–-".contains(first), body.dropFirst().first == "\t" {
        kind = .bulletListItem
        markerLength = tabs + 2
      } else if let match = String(body).prefixMatch(of: #/\d{1,3}[.)]\t/#) {
        kind = .numberedListItem
        markerLength = tabs + String(match.0).count
      }
      if markerLength > 0, markerLength <= piece.length {
        piece = piece.attributedSubstring(from: NSRange(location: markerLength, length: piece.length - markerLength))
      }
      var props: [String: JSONValue] = [:]
      if kind == .paragraph, let font = piece.length > 0 ? piece.attribute(.font, at: 0, effectiveRange: nil) as? NSFont : nil,
         font.pointSize >= 18, font.fontDescriptor.symbolicTraits.contains(.bold) {
        kind = .heading
        props["level"] = .number(font.pointSize >= 26 ? 1 : font.pointSize >= 21 ? 2 : 3)
      }
      var inlines = restoringHrefs(NoteInlineText.inlines(fromForeign: piece), hrefs)
      if kind == .heading {
        // Headings carry their weight from the block, not from bold runs.
        inlines = NoteMarkdown.merged(inlines.map { item in
          guard case .text(var run) = item else { return item }
          run.styles.bold = false
          return .text(run)
        })
      }
      let block = NoteSchema.block(kind, props: props, content: .inline(inlines))
      if kind.isListItem {
        while let last = stack.last, last.depth >= depth { stack.removeLast() }
        if let parent = stack.last {
          out.update(path: parent.path) { $0.children.append(block) }
          let count = out[path: parent.path]?.children.count ?? 1
          stack.append((depth, parent.path + [count - 1]))
        } else {
          out.append(block)
          stack.append((depth, [out.count - 1]))
        }
      } else {
        stack.removeAll()
        out.append(block)
      }
    }
    return out
  }

  /// The HTML importer normalizes link addresses ("https://example.com" gains a slash); keep the original.
  static func originalHrefs(_ html: Data) -> Set<String> {
    guard let source = String(data: html, encoding: .utf8), let regex = try? NSRegularExpression(pattern: #"href\s*=\s*["']([^"']+)["']"#, options: .caseInsensitive) else { return [] }
    return Set(regex.matches(in: source, range: NSRange(location: 0, length: (source as NSString).length)).map { (source as NSString).substring(with: $0.range(at: 1)) })
  }

  static func restoringHrefs(_ items: [NoteInline], _ hrefs: Set<String>) -> [NoteInline] {
    guard !hrefs.isEmpty else { return items }
    return items.map { item in
      guard case .link(let href, let runs, let other) = item, !hrefs.contains(href) else { return item }
      if href.hasSuffix("/"), hrefs.contains(String(href.dropLast())) { return .link(href: String(href.dropLast()), runs: runs, other: other) }
      return item
    }
  }

  private func richText(from pasteboard: NSPasteboard) -> NSAttributedString? {
    if let data = pasteboard.data(forType: .rtf), let text = NSAttributedString(rtf: data, documentAttributes: nil) { return text }
    if let data = pasteboard.data(forType: .html),
       let text = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) {
      let trimmed = NSMutableAttributedString(attributedString: text)
      while trimmed.string.hasSuffix("\n") { trimmed.deleteCharacters(in: NSRange(location: trimmed.length - 1, length: 1)) }
      return trimmed
    }
    return nil
  }

  /// Pasted blocks replace an empty block, split the block at the caret otherwise, and land in reading order.
  func insertPastedBlocks(_ pasted: [NoteBlock], at textView: NoteTextView) {
    guard !pasted.isEmpty, let current = blocks.block(id: textView.blockID), let storage = textView.textStorage else { return }
    let id = current.id
    let range = textView.selectedRange()
    let lastFocus = pasted.last.map { block -> NoteFocus in
      block.kind.isTextual && block.kind != .mathBlock ? .text(block.id, NSRange(location: displayLength(block), length: 0)) : .blocks([block.id])
    } ?? .none
    if storage.length == 0 || (range.location == 0 && range.length == storage.length) {
      mutate(focus: lastFocus) { blocks in
        blocks.insert(pasted, relativeTo: id, .after)
        if current.children.isEmpty { blocks.remove(ids: [id]) } else { blocks.update(id: id) { $0.content = .inline([]) } }
      }
      return
    }
    let tail = NSRange(location: NSMaxRange(range), length: storage.length - NSMaxRange(range))
    let head = NoteInlineText.inlines(from: storage.attributedSubstring(from: NSRange(location: 0, length: range.location)))
    let rest = tail.length > 0 ? NoteInlineText.inlines(from: storage.attributedSubstring(from: tail)) : []
    mutate(focus: lastFocus) { blocks in
      if current.kind.hasInlineContent { blocks.update(id: id) { $0.content = .inline(head) } }
      var insert = pasted
      if !rest.isEmpty { insert.append(NoteSchema.block(current.kind.isListItem ? current.kind : .paragraph, content: .inline(rest))) }
      blocks.insert(insert, relativeTo: id, .after)
    }
  }

  /// Uploads dropped or pasted files into new image or file blocks.
  func insertFiles(_ files: [URL], after id: String, upload: @escaping (URL) async throws -> String) {
    let made = files.map { file -> NoteBlock in
      let type = UTType(filenameExtension: file.pathExtension)
      let kind: NoteBlockKind = type?.conforms(to: .image) == true ? .image : type?.conforms(to: .movie) == true ? .video : type?.conforms(to: .audio) == true ? .audio : .file
      return NoteSchema.block(kind, props: ["name": .string(file.lastPathComponent)])
    }
    mutate(focus: .blocks(made.map(\.id))) { blocks in blocks.insert(made, relativeTo: id, .after) }
    for (file, block) in zip(files, made) { self.upload(file, into: block.id, using: upload) }
  }

  /// Pastes blocks after the selected blocks (or replaces nothing when the clipboard holds text).
  func pasteAfterSelectedBlocks() {
    guard isEditable, let anchor = blocks.outermost(Set(selectedBlockIDs)).last?.id else { return }
    let pasteboard = NSPasteboard.general
    var pasted: [NoteBlock] = []
    if let values = decode(pasteboard.data(forType: .noteBlocks)) {
      pasted = NoteDocumentCoding.blocks(from: values).map { $0.withFreshIDs() }
    } else if let string = pasteboard.string(forType: .string) {
      pasted = NoteMarkdown.blocks(from: string)
    }
    guard !pasted.isEmpty else { return }
    mutate(focus: .blocks(pasted.map(\.id))) { blocks in blocks.insert(pasted, relativeTo: anchor, .after) }
  }
}

extension NSImage {
  func notePNGData() -> Data? {
    guard let tiff = tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
    return bitmap.representation(using: .png, properties: [:])
  }
}
