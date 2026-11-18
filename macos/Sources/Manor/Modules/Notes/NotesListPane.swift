import AppKit
import ManorKit
import SwiftUI

/// The note list: the view picker in its header, search, the multi-select rows, and workspace actions at its
/// foot. Plain click opens, Shift selects a range, Command toggles, Command-A selects the list, Escape clears,
/// Delete moves the selection to Trash (or deletes it permanently inside Trash), and right-click shows actions.
struct NotesListPane: View {
  @Bindable var store: NotesStore
  @FocusState.Binding var searchFocused: Bool
  @FocusState private var listFocused: Bool
  @State private var scopeMenuOpen = false

  static let width: CGFloat = 292
  static let railWidth: CGFloat = 44

  @Environment(\.windowButtonsClearance) private var buttonsClearance

  var body: some View {
    Group {
      if store.listCollapsed { rail } else { pane }
    }
    .background(Palette.surfacePaper)
  }

  // MARK: Rail

  private var rail: some View {
    VStack(spacing: Space.s1) {
      IconButton("sidebar.left", label: "Show note list") { withAnimation(Motion.panel) { store.listCollapsed = false } }
      if store.scope.canCreate {
        IconButton("square.and.pencil", label: "New note") { Task { await store.createPage() } }
          .disabled(store.creating)
      }
      Spacer()
    }
    // With the app sidebar hidden the rail sits under the window buttons, so it starts below them.
    .padding(.top, buttonsClearance > 0 ? WindowChromeMetrics.toolbarHeight : Space.s2)
    .frame(width: Self.railWidth)
    .frame(maxHeight: .infinity)
  }

  // MARK: Pane

  private var pane: some View {
    VStack(spacing: 0) {
      header
      searchField
        .padding(.horizontal, Space.s3)
        .padding(.bottom, Space.s2)
      if store.selection.ids.count > 1 { batchBar }
      Hairline()
      list
      Hairline()
      footer
    }
    .frame(width: Self.width)
  }

  private var header: some View {
    HStack(spacing: Space.s1) {
      scopeTrigger
      Text("\(store.rows.count)")
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(Palette.inkMuted)
        .tabular()
      Spacer(minLength: Space.s1)
      if store.scope.canCreate {
        IconButton("square.and.pencil", label: "New note") { Task { await store.createPage() } }
          .disabled(store.creating)
      }
      IconButton("sidebar.left", label: "Hide note list") { withAnimation(Motion.panel) { store.listCollapsed = true } }
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 46)
    // With the app sidebar hidden the pane's top-left sits under the window buttons; the header starts below them.
    .padding(.top, buttonsClearance > 0 ? WindowChromeMetrics.toolbarHeight - Space.s2 : 0)
  }

  private var scopeTrigger: some View {
    Button { scopeMenuOpen.toggle() } label: {
      HStack(spacing: 6) {
        Image(systemName: Self.symbol(for: store.scope)).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.inkMuted)
        Text(store.listTitle).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .contentShape(Rectangle())
    }
    .buttonStyle(NotesHoverButtonStyle())
    .help("Choose what the list shows")
    .accessibilityLabel("Showing \(store.listTitle). Choose what the list shows")
    .manorPopover(isPresented: $scopeMenuOpen) {
      NotesScopeMenu(store: store) { scopeMenuOpen = false }
    }
  }

  static func symbol(for scope: NotesScope) -> String {
    switch scope {
    case .all: return "books.vertical"
    case .favorites: return "star"
    case .recent: return "clock"
    case .archived: return "archivebox"
    case .trash: return "trash"
    case .folder: return "folder"
    }
  }

  private var searchField: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField("Search notes", text: $store.query)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.body))
        .focused($searchFocused)
        .onExitCommand { store.query = "" }
      if store.query.isEmpty {
        Text("⇧⌘F").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
      } else {
        Button { store.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.inkMuted) }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, Space.s2 + 2)
    .frame(height: 30)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceSoft))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(searchFocused ? Palette.focusBorder : .clear, lineWidth: 1.5))
  }

  private var inTrash: Bool { !store.rows.isEmpty && store.rows.allSatisfy { $0.page.status == .trash } }

  private var batchBar: some View {
    HStack(spacing: Space.s1) {
      Text("\(store.selection.ids.count) selected").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.ink).tabular()
      Spacer(minLength: Space.s1)
      if inTrash {
        Button("Restore") { Task { await store.restore(store.selection.ids) } }.buttonStyle(.manor(.ghost, size: .small))
        Button("Delete") { store.purgeRequest = store.selection.ids }.buttonStyle(.manor(.danger, size: .small))
      } else {
        Button("Move to Trash") { Task { await store.trash(store.selection.ids) } }.buttonStyle(.manor(.ghost, size: .small))
      }
      IconButton("xmark", label: "Clear selection", size: 24) { store.clearSelection() }
    }
    .padding(.horizontal, Space.s3)
    .padding(.vertical, 6)
    .background(Palette.primaryTint.opacity(0.6))
    .transition(.opacity)
  }

  // MARK: Rows

  private var order: [String] { store.rows.map(\.id) }

  private var list: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(spacing: 1) {
          if store.loading {
            Text("Loading notes").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(.vertical, Space.s6)
          } else if store.rows.isEmpty {
            emptyList
          }
          ForEach(store.rows) { row in
            NoteListRow(
              row: row, isOpen: store.selectedId == row.id, isChecked: store.selection.ids.count > 1 && store.selection.contains(row.id),
              onClick: { click(row) },
              onDelete: { delete(row.page) }
            )
            .id(row.id)
            .contextMenu { menu(for: row.page) }
          }
        }
        .padding(Space.s2)
      }
      .scrollIndicators(.automatic)
      .focusable()
      .focusEffectDisabled()
      .focused($listFocused)
      .onKeyPress(keys: [.upArrow, .downArrow]) { press in
        step(press.key == .downArrow ? 1 : -1, extend: press.modifiers.contains(.shift), proxy: proxy)
        return .handled
      }
      .onKeyPress(.escape) {
        guard !store.selection.ids.isEmpty else { return .ignored }
        store.clearSelection()
        return .handled
      }
      .onKeyPress(keys: [.delete, .deleteForward]) { _ in
        guard let first = store.selection.ids.first, let page = store.rows.first(where: { $0.id == first })?.page else { return .ignored }
        delete(page)
        return .handled
      }
      .onKeyPress(.return) {
        guard let id = store.selection.ids.last else { return .ignored }
        Task { await store.open(id) }
        return .handled
      }
      .onKeyPress(characters: ["a"], phases: .down) { press in
        guard press.modifiers.contains(.command) else { return .ignored }
        store.selection = .all(order)
        return .handled
      }
    }
  }

  private var emptyList: some View {
    VStack(spacing: Space.s2) {
      Image(systemName: "doc.text").font(.system(size: 20, weight: .light)).foregroundStyle(Palette.inkMuted)
      Text(store.query.isEmpty ? (store.scope.canCreate ? "Nothing here yet" : "Nothing here") : "No matching notes")
        .font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
      Text(store.query.isEmpty ? (store.scope.canCreate ? "Start a note and it appears in this list." : "Notes you move here appear in this list.") : "Try a different word.")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).multilineTextAlignment(.center)
      if store.scope.canCreate && store.query.isEmpty {
        Button("New note") { Task { await store.createPage() } }
          .buttonStyle(.manor(.primary, size: .small))
          .disabled(store.creating)
          .padding(.top, Space.s1)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, Space.s8)
    .padding(.horizontal, Space.s3)
  }

  private func click(_ row: NoteTreeRow) {
    listFocused = true
    let flags = NSApp.currentEvent?.modifierFlags ?? []
    let range = flags.contains(.shift), toggle = flags.contains(.command)
    if range || toggle {
      store.selection = store.selection.click(row.id, in: order, range: range, toggle: toggle)
      return
    }
    store.selection = .one(row.id)
    Task { await store.open(row.id) }
  }

  private func step(_ delta: Int, extend: Bool, proxy: ScrollViewProxy) {
    let current = store.selection.ids.last ?? store.selectedId
    let index = current.flatMap { order.firstIndex(of: $0) } ?? (delta > 0 ? -1 : order.count)
    let next = index + delta
    guard order.indices.contains(next) else { return }
    let id = order[next]
    if extend {
      let base = store.selection.anchor == nil ? NoteSelection.one(current ?? id) : store.selection
      store.selection = base.range(to: id, in: order)
    } else {
      store.selection = .one(id)
      Task { await store.open(id) }
    }
    proxy.scrollTo(id)
  }

  private func delete(_ page: NotePage) {
    let ids = store.selection.targets(for: page.id)
    if page.status == .trash { store.purgeRequest = ids } else { Task { await store.trash(ids) } }
  }

  @ViewBuilder
  private func menu(for page: NotePage) -> some View {
    let ids = store.selection.targets(for: page.id)
    let many = ids.count > 1
    if !many {
      Button { Task { await store.open(page.id) } } label: { Label("Open", systemImage: "arrow.up.forward.square") }
    }
    if page.status == .active && !many {
      Button { Task { await store.toggleFavorite(page) } } label: {
        Label(page.favorite ? "Remove from favorites" : "Add to favorites", systemImage: page.favorite ? "star.slash" : "star")
      }
      Button { Task { await store.duplicate(page.id) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
      Button { store.dialog = .move(page) } label: { Label("Move to…", systemImage: "folder") }
    }
    if page.status != .active {
      Button { Task { await store.restore(ids) } } label: { Label(many ? "Restore \(ids.count) notes" : "Restore", systemImage: "arrow.uturn.backward") }
    }
    Divider()
    if page.status != .trash {
      Button(role: .destructive) { Task { await store.trash(ids) } } label: {
        Label(many ? "Move \(ids.count) notes to Trash" : "Move to Trash", systemImage: "trash")
      }
    } else {
      Button(role: .destructive) { store.purgeRequest = ids } label: {
        Label(many ? "Delete \(ids.count) notes permanently" : "Delete permanently", systemImage: "trash.slash")
      }
    }
  }

  // MARK: Footer

  private var footer: some View {
    HStack(spacing: Space.s1) {
      Button { Task { await store.retrySync() } } label: { Label("Sync changes", systemImage: "arrow.triangle.2.circlepath").lineLimit(1).fixedSize() }
        .buttonStyle(.manor(.ghost, size: .small))
        .help("Send changes saved on this Mac")
      Button { Task { await store.importFiles() } } label: { Label("Import notes…", systemImage: "square.and.arrow.down").lineLimit(1).fixedSize() }
        .buttonStyle(.manor(.ghost, size: .small))
        .help("Import Markdown files or Manor documents")
      Spacer(minLength: 0)
    }
    .padding(Space.s2)
  }
}

/// One row: title (nested pages indented under their parent), the last edit, and a star for favorites.
private struct NoteListRow: View {
  let row: NoteTreeRow
  let isOpen: Bool
  let isChecked: Bool
  let onClick: () -> Void
  let onDelete: () -> Void
  @State private var hovering = false

  private static let timeFormat: DateFormatter = {
    let formatter = DateFormatter()
    formatter.setLocalizedDateFormatFromTemplate("MMMd jmm")
    return formatter
  }()

  var body: some View {
    let page = row.page
    HStack(spacing: Space.s2) {
      HStack(alignment: .firstTextBaseline, spacing: Space.s1) {
        // A nested page's marker sits in its own column, so its title and date share one leading edge.
        if row.depth > 0 {
          Image(systemName: "arrow.turn.down.right").font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.inkMuted)
            .frame(width: 12)
            .accessibilityHidden(true)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(page.displayTitle)
            .font(.ui(Typography.Size.body, weight: isOpen ? .semibold : .medium))
            .foregroundStyle(isOpen ? Palette.ink : Palette.inkBody)
            .lineLimit(1)
          HStack(spacing: 5) {
            Text(NotesModel.date(page.updatedAt).map(Self.timeFormat.string(from:)) ?? "")
              .font(.ui(Typography.Size.xs))
              .foregroundStyle(Palette.inkMuted)
              .tabular()
            if page.favorite {
              Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(Palette.todayWarning).accessibilityLabel("Favorite")
            }
          }
        }
      }
      Spacer(minLength: 0)
      if hovering {
        Button(action: onDelete) {
          Image(systemName: "trash").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
            .frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(page.status == .trash ? "Delete permanently" : "Move to Trash")
        .accessibilityLabel(page.status == .trash ? "Delete \(page.displayTitle) permanently" : "Move \(page.displayTitle) to Trash")
      }
    }
    .padding(.leading, 10 + CGFloat(max(0, min(row.depth, 4) - 1)) * 14 + (row.depth > 0 ? 4 : 0))
    .padding(.trailing, 6)
    .padding(.vertical, 7)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
        .fill(isChecked ? Palette.primaryTint : isOpen ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear)
    )
    .contentShape(Rectangle())
    .onTapGesture(perform: onClick)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isOpen || isChecked ? [.isButton, .isSelected] : .isButton)
  }
}

/// A quiet hover fill for header controls.
struct NotesHoverButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    HoverBody(configuration: configuration)
  }

  private struct HoverBody: View {
    let configuration: Configuration
    @State private var hovering = false
    var body: some View {
      configuration.label
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous)
          .fill(configuration.isPressed ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear))
        .onHover { hovering = $0 }
        .animation(Motion.fast, value: hovering)
    }
  }
}
