import ManorKit
import SwiftUI

/// Version history, suggestions, and Compare versions for the open note. Every outcome is the persisted result
/// of a command; nothing changes locally until the server accepts it.
struct NoteReviewDialog: View {
  let store: NotesStore
  let mode: NotesStore.ReviewMode
  let page: NotePage
  let close: () -> Void

  @State private var loading = true
  @State private var busy = false
  @State private var error: String?
  @State private var versions: [NoteVersion] = []
  @State private var selectedVersion: Int?
  @State private var suggestions: [NoteSuggestion] = []
  @State private var conflict: NoteConflict?

  private var title: String {
    switch mode {
    case .versions: return "Version history"
    case .suggestions: return "Suggestions"
    case .conflict: return "Compare versions"
    }
  }

  var body: some View {
    DialogPanel(title, onClose: close) {
      VStack(alignment: .leading, spacing: Space.s3) {
        if let error {
          Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).fixedSize(horizontal: false, vertical: true)
        }
        if loading {
          HStack { Spacer(); ProgressView().controlSize(.small); Spacer() }.padding(.vertical, Space.s8)
        } else {
          switch mode {
          case .versions: versionsBody
          case .suggestions: suggestionsBody
          case .conflict: conflictBody
          }
        }
      }
    } footer: {
      footer
    }
    .task { await load() }
  }

  private func load() async {
    loading = true
    error = nil
    do {
      switch mode {
      case .versions:
        versions = try await store.service.listVersions(page.id)
        selectedVersion = versions.first?.revision
      case .suggestions:
        suggestions = try await store.service.listSuggestions(page.id)
      case .conflict:
        conflict = try await store.service.readConflict(page.id)
      }
    } catch {
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// Lands the open note's draft first (except when resolving a conflict, which is about that draft), then applies.
  private func apply(keepOpen: Bool = false, _ action: @escaping () async throws -> NotePage) {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        if mode != .conflict, !(await store.beforeReviewChange()) {
          error = "Your latest edit has not synced yet. Retry the save, then try again."
          return
        }
        let saved = try await action()
        store.applied(saved)
        if keepOpen { suggestions = try await store.service.listSuggestions(saved.id) } else { close() }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  // MARK: Versions

  private static let timeFormat: DateFormatter = {
    let formatter = DateFormatter()
    formatter.setLocalizedDateFormatFromTemplate("EEEMMMd jmm")
    return formatter
  }()

  private func time(_ timestamp: String) -> String { NotesModel.date(timestamp).map(Self.timeFormat.string(from:)) ?? timestamp }

  @ViewBuilder
  private var versionsBody: some View {
    Text("Versions are kept for seven days. Restoring one creates a new version.")
      .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
    if versions.isEmpty {
      Text("No earlier versions yet.").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody).padding(.vertical, Space.s4)
    } else {
      HStack(alignment: .top, spacing: Space.s4) {
        VStack(spacing: 1) {
          ForEach(versions) { version in
            let selected = version.revision == selectedVersion
            Button { selectedVersion = version.revision } label: {
              VStack(alignment: .leading, spacing: 1) {
                Text(time(version.createdAt)).font(.ui(Typography.Size.sm, weight: selected ? .semibold : .regular)).foregroundStyle(Palette.ink).tabular()
                Text("Version \(version.revision)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, Space.s2)
              .padding(.vertical, 6)
              .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(selected ? Palette.surfaceSelected : .clear))
              .contentShape(Rectangle())
            }
            .buttonStyle(NotesHoverButtonStyle())
          }
        }
        .frame(width: 190)
        if let version = versions.first(where: { $0.revision == selectedVersion }) {
          VStack(alignment: .leading, spacing: Space.s2) {
            Text(version.title).font(.display(Typography.Size.title)).foregroundStyle(Palette.ink)
            NoteBlocksPreview(blocks: version.blocks)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(Space.s4)
          .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline))
        }
      }
    }
  }

  // MARK: Suggestions

  private var pending: [NoteSuggestion] { suggestions.filter { $0.status == .pending } }

  @ViewBuilder
  private var suggestionsBody: some View {
    if pending.isEmpty {
      Text("No suggestions to review.").font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody).padding(.vertical, Space.s4)
    } else {
      ForEach(pending) { suggestion in
        VStack(alignment: .leading, spacing: Space.s3) {
          Text(suggestion.summary).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
          comparison(left: ("Current", suggestion.before), right: ("Suggested", suggestion.after))
          HStack(spacing: Space.s2) {
            Spacer()
            Button { review([suggestion.id], accept: false) } label: { Label("Reject", systemImage: "xmark") }
              .buttonStyle(.manor(.secondary, size: .small)).disabled(busy)
              .accessibilityLabel("Reject \(suggestion.summary)")
            Button { review([suggestion.id], accept: true) } label: { Label("Accept", systemImage: "checkmark") }
              .buttonStyle(.manor(.primary, size: .small)).disabled(busy)
              .accessibilityLabel("Accept \(suggestion.summary)")
          }
        }
        .padding(Space.s4)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Palette.hairline))
      }
    }
  }

  private func review(_ ids: [String], accept: Bool) {
    apply(keepOpen: true) { try await store.service.reviewSuggestions(noteId: page.id, ids: ids, accept: accept) }
  }

  // MARK: Conflict

  @ViewBuilder
  private var conflictBody: some View {
    Text("This note changed elsewhere while you were editing the same part. Compare both copies. Saving yours keeps the cloud copy in version history.")
      .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody).fixedSize(horizontal: false, vertical: true)
    if let conflict {
      comparison(left: ("Cloud version", conflict.current.content), right: ("Your draft", conflict.local.blocks))
    }
  }

  private func comparison(left: (String, [JSONValue]), right: (String, [JSONValue])) -> some View {
    HStack(alignment: .top, spacing: Space.s3) {
      ForEach(Array([left, right].enumerated()), id: \.offset) { _, side in
        VStack(alignment: .leading, spacing: Space.s2) {
          Text(side.0).font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
          if side.1.isEmpty {
            Text("Removed").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          } else {
            NoteBlocksPreview(blocks: side.1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(Space.s3)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfacePaper))
      }
    }
  }

  // MARK: Footer

  @ViewBuilder
  private var footer: some View {
    switch mode {
    case .versions:
      Button("Close", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      Button(busy ? "Restoring" : "Restore version") {
        guard let revision = selectedVersion else { return }
        apply { try await store.service.restoreVersion(noteId: page.id, revision: revision) }
      }
      .buttonStyle(.primary)
      .disabled(busy || selectedVersion == nil || page.status == .trash)
    case .suggestions:
      if !pending.isEmpty {
        Text("\(pending.count) pending").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        Spacer()
        Button("Reject all") { review(pending.map(\.id), accept: false) }.buttonStyle(.secondary).disabled(busy)
        Button("Accept all") { review(pending.map(\.id), accept: true) }.buttonStyle(.primary).disabled(busy)
      } else {
        Button("Close", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      }
    case .conflict:
      if let conflict {
        Button("Keep cloud version") {
          Task {
            await store.keepCloudVersion(conflict)
            close()
          }
        }
        .buttonStyle(.manor(.ghost))
        .disabled(busy)
      }
      Spacer()
      Button("Keep editing", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      Button("Save my version") {
        guard let conflict else { return }
        apply { try await store.service.resolveConflict(conflict) }
      }
      .buttonStyle(.primary)
      .disabled(busy || conflict == nil)
    }
  }
}

/// A compact read-only rendering of blocks for version previews and comparisons.
struct NoteBlocksPreview: View {
  let blocks: [JSONValue]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(Array(flattened.enumerated()), id: \.offset) { _, entry in
        line(entry.block, depth: entry.depth, number: entry.number)
      }
    }
    .textSelection(.enabled)
  }

  private struct Entry { let block: JSONValue; let depth: Int; let number: Int }

  private var flattened: [Entry] {
    var out: [Entry] = []
    func visit(_ items: [JSONValue], _ depth: Int) {
      var number = 0
      for block in items {
        number = block["type"]?.string == "numberedListItem" ? number + 1 : 0
        out.append(Entry(block: block, depth: depth, number: number))
        visit(block["children"]?.array ?? [], depth + 1)
      }
    }
    visit(blocks, 0)
    return out
  }

  @ViewBuilder
  private func line(_ block: JSONValue, depth: Int, number: Int) -> some View {
    let type = block["type"]?.string ?? "paragraph"
    let text = Self.attributed(block["content"])
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      switch type {
      case "bulletListItem", "toggleListItem": Text("•").foregroundStyle(Palette.inkMuted)
      case "numberedListItem": Text("\(number).").foregroundStyle(Palette.inkMuted).tabular()
      case "checkListItem":
        Image(systemName: block["props"]?["checked"]?.bool == true ? "checkmark.square.fill" : "square").foregroundStyle(Palette.inkMuted)
      default: EmptyView()
      }
      switch type {
      case "heading":
        let level = block["props"]?["level"]?.int ?? 1
        Text(text).font(.display(level == 1 ? Typography.Size.title : level == 2 ? Typography.Size.lg : Typography.Size.md)).foregroundStyle(Palette.ink)
      case "codeBlock":
        Text(previewPlainText(block["content"])).font(.code()).foregroundStyle(Palette.ink)
          .padding(Space.s2).frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: Radius.chip).fill(Palette.surfaceSoft))
      case "quote", "callout":
        Text(text).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody)
          .padding(.leading, Space.s2)
          .overlay(alignment: .leading) { Rectangle().fill(Palette.hairlineStrong).frame(width: 2) }
      case "divider":
        Hairline().padding(.vertical, 4)
      case "image", "file", "audio", "video", "webBookmark", "webEmbed":
        let props = block["props"]?.object ?? [:]
        let label = [props["caption"]?.string, props["name"]?.string, props["title"]?.string, props["url"]?.string].compactMap { $0 }.first { !$0.isEmpty } ?? "Attachment"
        Label(label, systemImage: type == "image" ? "photo" : type == "webBookmark" || type == "webEmbed" ? "link" : "paperclip")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      case "table":
        Text(NotesModel.inlineText(block["content"] ?? .null)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
      default:
        if text.characters.isEmpty && NotesModel.inlineText(block).isEmpty {
          Text(" ").font(.ui(Typography.Size.body))
        } else if text.characters.isEmpty {
          Text(NotesModel.inlineText(block)).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody)
        } else {
          Text(text).font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkBody)
        }
      }
    }
    .padding(.leading, CGFloat(depth) * 18)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// Inline content with bold, italic, strikethrough, code, and links kept.
  static func attributed(_ content: JSONValue?) -> AttributedString {
    var result = AttributedString()
    for item in content?.array ?? [] {
      switch item["type"]?.string {
      case "link":
        var link = attributed(item["content"])
        if let href = item["href"]?.string, let url = URL(string: href) { link.link = url }
        result += link
      case "pageMention":
        var mention = AttributedString(item["props"]?["title"]?.string ?? "Untitled")
        mention.underlineStyle = .single
        result += mention
      case "math":
        result += AttributedString(item["content"]?.string ?? "")
      default:
        var run = AttributedString(item["text"]?.string ?? "")
        let styles = item["styles"]?.object ?? [:]
        var intent: InlinePresentationIntent = []
        if styles["bold"]?.bool == true { intent.insert(.stronglyEmphasized) }
        if styles["italic"]?.bool == true { intent.insert(.emphasized) }
        if styles["code"]?.bool == true { intent.insert(.code) }
        if styles["strike"]?.bool == true { run.strikethroughStyle = .single }
        if styles["underline"]?.bool == true { run.underlineStyle = .single }
        if !intent.isEmpty { run.inlinePresentationIntent = intent }
        result += run
      }
    }
    return result
  }
}

/// The plain text of string or inline content.
private func previewPlainText(_ content: JSONValue?) -> String {
  if let text = content?.string { return text }
  return (content?.array ?? []).map { $0["text"]?.string ?? NotesModel.inlineText($0) }.joined()
}
