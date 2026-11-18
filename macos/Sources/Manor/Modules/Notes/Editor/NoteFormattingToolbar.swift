import AppKit
import ManorKit
import SwiftUI

@MainActor @Observable
final class NoteToolbarState {
  var styles = NoteStyles()
  var blockTitle = "Text"
  var link: String?
  var editingLink = false
  var linkDraft = ""
  var linkError = false
  var canTurnInto = true
}

/// The floating formatting toolbar over a text selection: block type, inline styles, link, equation, and color.
@MainActor
final class NoteFormattingToolbar {
  weak var controller: NoteEditorController?
  private var panelStorage: NoteFloatingPanel?
  private let state = NoteToolbarState()

  /// Created on first use, so building an editor stays cheap.
  private var panel: NoteFloatingPanel {
    if let panelStorage { return panelStorage }
    let panel = NoteFloatingPanel()
    panel.contentView = NSHostingView(rootView: NoteToolbarView(state: state, perform: { [weak self] action in self?.perform(action) }))
    panelStorage = panel
    return panel
  }
  private weak var textView: NoteTextView?
  private(set) var isVisible = false

  var ownsFocus: Bool { state.editingLink }

  init() {}

  func show(for textView: NoteTextView, editingLink: Bool = false) {
    guard let controller, controller.isEditable, !textView.isPlain else { return }
    self.textView = textView
    refresh()
    if editingLink {
      state.linkDraft = state.link ?? ""
      state.linkError = false
      state.editingLink = true
    } else if !state.editingLink {
      state.editingLink = false
    }
    isVisible = true
    reposition()
    if state.editingLink {
      panel.allowsKey = true
      panel.makeKey()
    }
  }

  func hide() {
    guard isVisible || state.editingLink else { return }
    isVisible = false
    state.editingLink = false
    guard let panelStorage else { return }
    panelStorage.allowsKey = false
    panelStorage.parent?.removeChildWindow(panelStorage)
    panelStorage.orderOut(nil)
  }

  /// Re-reads the selection's styles after a change.
  func refresh() {
    guard let controller, let textView, let block = controller.blocks.block(id: textView.blockID) else { return }
    state.styles = controller.currentStyles(textView)
    state.link = controller.currentLink(textView)
    state.canTurnInto = textView.role == .block
    state.blockTitle = Self.title(for: block)
  }

  static func title(for block: NoteBlock) -> String {
    switch block.kind {
    case .heading: return "Heading \(block.props["level"]?.int ?? 1)"
    case .bulletListItem: return "Bulleted list"
    case .numberedListItem: return "Numbered list"
    case .checkListItem: return "To-do list"
    case .toggleListItem: return "Toggle list"
    case .quote: return "Quote"
    case .callout: return "Callout"
    case .table: return "Table"
    default: return "Text"
    }
  }

  func reposition() {
    guard isVisible, let textView, let window = textView.window else { return }
    let range = textView.selectedRange()
    let local = textView.rect(for: range.length > 0 ? range : NSRange(location: range.location, length: 0))
    let onScreen = window.convertToScreen(textView.convert(local, to: nil))
    let size = NSSize(width: state.editingLink ? 380 : 568, height: 40)
    var origin = NSPoint(x: onScreen.midX - size.width / 2, y: onScreen.maxY + 8)
    if let screen = window.screen?.visibleFrame {
      if origin.y + size.height > screen.maxY - 8 { origin.y = onScreen.minY - size.height - 8 }
      origin.x = min(max(origin.x, screen.minX + 8), screen.maxX - size.width - 8)
    }
    panel.setFrame(NSRect(origin: origin, size: size), display: true)
    if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
    panel.orderFront(nil)
  }

  enum Action {
    case style(WritableKeyPath<NoteStyles, Bool>)
    case turnInto(NoteBlockKind, [String: JSONValue])
    case textColor(String)
    case backgroundColor(String)
    case beginLink
    case commitLink
    case removeLink
    case openLink
    case cancelLink
    case equation
    case askAlfred
  }

  private func returnFocus() {
    guard let textView else { return }
    panel.allowsKey = false
    textView.window?.makeKey()
    textView.window?.makeFirstResponder(textView)
  }

  private func perform(_ action: Action) {
    guard let controller, let textView else { return }
    switch action {
    case .style(let key):
      controller.toggleStyle(textView, key)
    case .turnInto(let kind, let props):
      controller.turnInto([textView.blockID], kind, props: props)
      hide()
      return
    case .textColor(let name):
      controller.setInlineColor(textView, text: name, background: nil)
    case .backgroundColor(let name):
      controller.setInlineColor(textView, text: nil, background: name)
    case .beginLink:
      state.linkDraft = state.link ?? ""
      state.linkError = false
      state.editingLink = true
      reposition()
      panel.allowsKey = true
      panel.makeKey()
      return
    case .commitLink:
      let value = state.linkDraft.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !value.isEmpty else { perform(.removeLink); return }
      let href = Self.normalizedHref(value)
      state.editingLink = false
      returnFocus()
      controller.setLink(textView, href: href)
      hide()
      return
    case .removeLink:
      state.editingLink = false
      returnFocus()
      controller.setLink(textView, href: nil)
      hide()
      return
    case .openLink:
      if let link = state.link { controller.openLink(link) }
      return
    case .cancelLink:
      state.editingLink = false
      returnFocus()
      reposition()
      return
    case .equation:
      hide()
      controller.insertInlineMath(textView)
      return
    case .askAlfred:
      hide()
      controller.askAlfredAboutSelection(in: textView)
      return
    }
    refresh()
  }

  /// Bare domains become https links; in-note fragments and other schemes stay as typed.
  static func normalizedHref(_ value: String) -> String {
    if value.hasPrefix("#") || value.contains("://") || value.hasPrefix("mailto:") { return value }
    return "https://\(value)"
  }
}

struct NoteToolbarView: View {
  @Bindable var state: NoteToolbarState
  let perform: (NoteFormattingToolbar.Action) -> Void
  @FocusState private var linkFocused: Bool

  var body: some View {
    NotePopupCard {
      Group {
        if state.editingLink { linkEditor } else { buttons }
      }
      .padding(.horizontal, Space.s1)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private var buttons: some View {
    HStack(spacing: 2) {
      Button { perform(.askAlfred) } label: {
        HStack(spacing: 4) {
          Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold))
          Text("Ask Alfred").font(.ui(Typography.Size.sm, weight: .medium))
        }
        .foregroundStyle(Palette.primary)
        .padding(.horizontal, Space.s2)
        .frame(height: 28)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help("Ask Alfred  ⌘J")
      divider
      if state.canTurnInto {
        Menu {
          turnIntoItems
        } label: {
          Text(state.blockTitle).font(.ui(Typography.Size.sm, weight: .medium))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.visible)
        .fixedSize()
        .padding(.horizontal, Space.s2)
        .help("Turn into")
        divider
      }
      toggle("bold", "Bold", "⌘B", state.styles.bold) { perform(.style(\.bold)) }
      toggle("italic", "Italic", "⌘I", state.styles.italic) { perform(.style(\.italic)) }
      toggle("underline", "Underline", "⌘U", state.styles.underline) { perform(.style(\.underline)) }
      toggle("strikethrough", "Strikethrough", "⌘⇧S", state.styles.strike) { perform(.style(\.strike)) }
      toggle("chevron.left.forwardslash.chevron.right", "Inline code", "⌘E", state.styles.code) { perform(.style(\.code)) }
      divider
      toggle("link", state.link == nil ? "Add link" : "Edit link", "⌘K", state.link != nil) { perform(.beginLink) }
      toggle("function", "Equation", "", false) { perform(.equation) }
      divider
      Menu {
        Section("Text") {
          ForEach(NoteColorOption.all) { color in
            Button { perform(.textColor(color.id)) } label: { Label { Text(color.label) } icon: { Image(nsImage: NoteActionMenu.swatch(text: color.id)) } }
          }
        }
        Section("Background") {
          ForEach(NoteColorOption.all) { color in
            Button { perform(.backgroundColor(color.id)) } label: { Label { Text(color.label) } icon: { Image(nsImage: NoteActionMenu.swatch(background: color.id)) } }
          }
        }
      } label: {
        Image(systemName: "paintpalette").font(.system(size: 13, weight: .medium))
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.visible)
      .fixedSize()
      .padding(.horizontal, Space.s1)
      .help("Color")
    }
  }

  @ViewBuilder private var turnIntoItems: some View {
    Button("Text") { perform(.turnInto(.paragraph, [:])) }
    Button("Heading 1") { perform(.turnInto(.heading, ["level": 1])) }
    Button("Heading 2") { perform(.turnInto(.heading, ["level": 2])) }
    Button("Heading 3") { perform(.turnInto(.heading, ["level": 3])) }
    Button("Bulleted list") { perform(.turnInto(.bulletListItem, [:])) }
    Button("Numbered list") { perform(.turnInto(.numberedListItem, [:])) }
    Button("To-do list") { perform(.turnInto(.checkListItem, [:])) }
    Button("Toggle list") { perform(.turnInto(.toggleListItem, [:])) }
    Button("Quote") { perform(.turnInto(.quote, [:])) }
    Button("Callout") { perform(.turnInto(.callout, [:])) }
    Button("Code") { perform(.turnInto(.codeBlock, [:])) }
  }

  private var divider: some View {
    Rectangle().fill(Palette.hairline).frame(width: 1, height: 20).padding(.horizontal, 2)
  }

  private func toggle(_ symbol: String, _ label: String, _ shortcut: String, _ on: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: on ? .bold : .medium))
        .foregroundStyle(on ? Palette.primary : Palette.inkBody)
        .frame(width: 28, height: 28)
        .background(on ? Palette.primaryTint : .clear, in: RoundedRectangle(cornerRadius: Radius.chip))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(shortcut.isEmpty ? label : "\(label)  \(shortcut)")
    .accessibilityLabel(label)
  }

  private var linkEditor: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "link").foregroundStyle(Palette.inkMuted).font(.system(size: 12, weight: .medium))
      TextField("Paste a link or #heading", text: $state.linkDraft)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.sm))
        .focused($linkFocused)
        .onSubmit { perform(.commitLink) }
        .onExitCommand { perform(.cancelLink) }
      if state.link != nil {
        Button { perform(.openLink) } label: { Image(systemName: "arrow.up.right") }
          .buttonStyle(.plain).foregroundStyle(Palette.inkMuted).help("Open link")
        Button { perform(.removeLink) } label: { Image(systemName: "link.badge.minus") }
          .buttonStyle(.plain).foregroundStyle(Palette.inkMuted).help("Remove link")
      }
      Button("Done") { perform(.commitLink) }.buttonStyle(.manor(.primary, size: .small))
    }
    .padding(.horizontal, Space.s2)
    .onAppear { linkFocused = true }
  }
}

/// A block color name with its label, for SwiftUI lists.
struct NoteColorOption: Identifiable {
  let id: String
  let label: String
  static let all = NoteTheme.colorLabels.map { NoteColorOption(id: $0.name, label: $0.label) }
}
