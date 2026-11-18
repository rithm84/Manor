import ManorKit
import SwiftUI

enum ProblemsTab: String { case library, mistakes }

/// The library page: title and tabs, saved views, search and filters, and the compact index.
struct ProblemLibraryView: View {
  let store: ProblemLibraryStore
  /// True while a problem's workspace covers the library.
  let covered: Bool
  let open: (String) -> Void
  @Environment(AppContext.self) private var context
  @AppStorage("problems.view") private var tab: ProblemsTab = .library
  @State private var showingAdvanced = false
  @State private var savingView = false
  @State private var renaming: ProblemSavedView?
  @State private var deleting: ProblemSavedView?
  @State private var record: ProblemRecordRequest?
  @State private var recordUnsaved = false
  @State private var confirmingDiscard = false
  @FocusState private var searchFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      PageHeader("Problems", subtitle: subtitle) {
        SegmentedTabs([(value: ProblemsTab.library, label: "Problems"), (value: .mistakes, label: "Mistakes")], selection: $tab)
      }
      if tab == .mistakes {
        Hairline()
        ProblemMistakesView(store: store, timeZone: context.timeZone)
      } else {
        library
      }
    }
    .background(Palette.surfaceCanvas)
    .background { shortcuts }
    .manorDialog(isPresented: $showingAdvanced, width: 680) {
      ProblemAdvancedPanel(store: store, facets: store.index?.facets ?? ProblemFacets.empty, today: context.today) { showingAdvanced = false }
    }
    .manorDialog(isPresented: $savingView, width: 440) {
      ProblemSaveViewPanel(store: store, renaming: renaming, onClose: { savingView = false; renaming = nil }) { view in
        savingView = false
        renaming = nil
        deleting = view
      }
    }
    .manorDialog(item: $deleting, width: 380) { view in
      ConfirmPanel(title: "Delete this view?", message: "“\(view.name)” goes away. The problems stay in your library.", confirmLabel: "Delete view",
                   onCancel: { deleting = nil }) {
        deleting = nil
        Task {
          do { try await store.deleteView(view) } catch { context.toasts.showError(error) }
        }
      }
    }
    .manorDialog(item: $record, width: 780, onDismiss: closeRecord) { request in
      if let group = store.index?.group(containing: request.problemId) {
        ProblemRecordPanel(store: store, group: group, today: context.today, startLogging: request.logging, hasUnsavedWork: $recordUnsaved,
                           requestClose: closeRecord) { context.openExternal($0) }
      }
    }
    .manorDialog(isPresented: $confirmingDiscard, width: 380) {
      ConfirmPanel(title: "Discard this solution?", message: "It has not been saved as an attempt.", confirmLabel: "Discard",
                   onCancel: { confirmingDiscard = false }) {
        confirmingDiscard = false
        recordUnsaved = false
        record = nil
      }
    }
  }

  private var subtitle: String {
    guard let count = store.problemCount else { return store.loadError == nil ? "Loading" : " " }
    return "\(count.formatted()) in your library"
  }

  private func closeRecord() {
    if recordUnsaved { confirmingDiscard = true } else { record = nil }
  }

  /// Command-F focuses the search.
  private var shortcuts: some View {
    Button("Find") {
      tab = .library
      searchFocused = true
    }
    .keyboardShortcut("f", modifiers: .command)
    .disabled(context.route != .problems || covered)
    .opacity(0)
    .accessibilityHidden(true)
  }

  // MARK: Library

  @ViewBuilder
  private var library: some View {
    if let index = store.index {
      VStack(spacing: 0) {
        viewTabs
        toolbar(index.facets)
        if let error = store.loadError {
          ErrorBanner(error) { store.retry() }.padding(.horizontal, Space.s8).padding(.bottom, Space.s3)
        }
        if index.count == 0 {
          Hairline()
          EmptyState(systemImage: "chevron.left.forwardslash.chevron.right", title: "No problems yet", message: "Ask Codex to add a problem of your own.")
        } else {
          table(index)
        }
      }
    } else if let error = store.loadError {
      VStack {
        ErrorBanner(error) { store.retry() }
        Spacer()
      }
      .padding(.horizontal, Space.s8)
    } else {
      VStack(spacing: Space.s3) {
        ProgressView().controlSize(.small)
        Text("Loading your library").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  /// Saved views as tabs that sit on the hairline above the toolbar; a long list scrolls sideways rather than wrapping.
  private var viewTabs: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: Space.s5) {
        ViewTab(title: "All problems", selected: store.viewId == nil, dirty: false) { store.select(nil) }
        ForEach(store.views) { view in
          ViewTab(title: view.name, selected: store.viewId == view.id, dirty: store.viewId == view.id && store.isDirty) { store.select(view) }
            .contextMenu {
              Button("Rename…") {
                renaming = view
                savingView = true
              }
              Button("Delete…", role: .destructive) { deleting = view }
            }
        }
      }
      .padding(.horizontal, Space.s8)
    }
    .frame(height: ProblemLibraryMetrics.tabHeight)
    .background(alignment: .bottom) { Hairline() }
  }

  private func toolbar(_ facets: ProblemFacets) -> some View {
    let filters = store.settings.filters
    let advancedCount = [!filters.kinds.isEmpty, !filters.sourceTypes.isEmpty, filters.hasContent != nil,
                         filters.lastAskedSince != nil || filters.lastAskedUntil != nil,
                         filters.tags.contains { !facets.roundTags.contains($0) }].filter { $0 }.count
    let advanced = Button { showingAdvanced = true } label: {
      HStack(spacing: Space.s1 + 2) {
        Image(systemName: "line.3.horizontal.decrease").font(.system(size: 11, weight: .semibold))
        Text("Advanced")
        if advancedCount > 0 { Text("\(advancedCount)").foregroundStyle(Palette.primary).tabular() }
      }
    }
    .buttonStyle(ProblemToolbarButtonStyle(active: advancedCount > 0))
    .help("Sort, group, columns, and more filters")
    let save = Button {
      renaming = nil
      savingView = true
    } label: {
      HStack(spacing: Space.s1 + 2) {
        Image(systemName: store.selectedView != nil && !store.isDirty ? "square.and.pencil" : "plus")
          .font(.system(size: 11, weight: .semibold))
        Text(store.selectedView == nil ? "Save view" : store.isDirty ? "Save changes" : "Edit view")
      }
    }
    .buttonStyle(ProblemToolbarButtonStyle(active: false, quiet: true))
    .disabled(store.busy || filters.invalidDateRange)
    // One row whenever it fits: search and filters from the leading edge, view actions at the trailing edge.
    // A narrow window wraps the filters under the search instead of squeezing them.
    return ViewThatFits(in: .horizontal) {
      HStack(spacing: Space.s2) {
        searchField.frame(width: 248)
        ProblemFilterBar(store: store, facets: facets)
        Spacer(minLength: Space.s3)
        advanced
        save
      }
      VStack(alignment: .leading, spacing: Space.s2) {
        HStack(spacing: Space.s2) {
          searchField.frame(minWidth: 200, maxWidth: 320)
          Spacer(minLength: Space.s3)
          advanced
          save
        }
        ProblemFlowLayout(spacing: Space.s1) { ProblemFilterBar(store: store, facets: facets) }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, Space.s8)
    .padding(.vertical, Space.s3)
  }

  private var searchField: some View {
    HStack(spacing: Space.s2) {
      Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField("Search problems", text: Binding(get: { store.searchText }, set: { store.setSearch($0) }))
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.sm))
        .focused($searchFocused)
        .onExitCommand { store.setSearch("") }
        .onSubmit { searchFocused = false }
        .help("Search titles, topics, and companies")
      if !store.searchText.isEmpty {
        Button { store.setSearch("") } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.inkMuted) }
          .buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, Space.s2 + 2)
    .frame(height: ProblemLibraryMetrics.controlHeight)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceSoft))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(searchFocused ? Palette.focusBorder : .clear, lineWidth: 1.5))
    .animation(Motion.fast, value: searchFocused)
  }

  private func table(_ index: ProblemLibraryIndex) -> some View {
    GeometryReader { proxy in
      let columns = ProblemColumn.fitting(store.settings.visibleColumns, width: proxy.size.width - ProblemTableLayout.edge * 2)
      VStack(spacing: 0) {
        ProblemTableHeader(store: store, columns: columns)
        Hairline()
        if store.result.matches == 0 && store.resultToken > 0 {
          EmptyState(systemImage: "magnifyingglass", title: "No problems match", message: "Try another search or clear some filters.") {
            Button("Clear filters") { store.clearFilters() }.buttonStyle(.secondary)
          }
        } else {
          ProblemTable(
            index: index, rows: store.result.rows, resultToken: store.resultToken, scrollToken: store.scrollToken, columns: columns,
            timeZone: context.timeZone,
            actions: ProblemRowActions(
              open: { open($0.id) },
              details: { problem, logging in record = ProblemRecordRequest(problemId: problem.id, logging: logging) },
              openURL: { context.openExternal($0) }
            )
          )
        }
        Hairline()
        footer(index)
      }
    }
  }

  private func footer(_ index: ProblemLibraryIndex) -> some View {
    let matches = store.result.matches
    let filtered = matches != index.count
    return HStack {
      Text(filtered ? "\(matches.formatted()) of \(index.count.formatted()) problems" : "\(index.count.formatted()) problems")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
      Spacer()
      if let solved = index.facets.status[.solved], solved > 0 {
        Text("\(solved.formatted()) solved").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.completion).tabular()
      }
    }
    .padding(.horizontal, Space.s8)
    .frame(height: 36)
  }
}

/// Shared sizes for the library chrome, so the search, filters, and view actions line up on one row.
enum ProblemLibraryMetrics {
  static let controlHeight: CGFloat = 28
  static let tabHeight: CGFloat = 36
  static let headerHeight: CGFloat = 30
}

/// A saved view: plain text that darkens on hover, the selected one in ink with an underline resting on the hairline.
private struct ViewTab: View {
  let title: String
  let selected: Bool
  let dirty: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title).lineLimit(1)
        if dirty {
          Circle().fill(Palette.primary).frame(width: 5, height: 5).accessibilityLabel("Unsaved changes")
        }
      }
      .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .medium))
      .foregroundStyle(selected || hovering ? Palette.ink : Palette.inkMuted)
      .frame(maxHeight: .infinity)
      .overlay(alignment: .bottom) {
        Rectangle().fill(selected ? Palette.ink : .clear).frame(height: 2)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .animation(Motion.fast, value: selected)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// The toolbar's trailing actions: the same height and outline as the filter menus. `quiet` drops the outline.
struct ProblemToolbarButtonStyle: ButtonStyle {
  var active = false
  var quiet = false

  func makeBody(configuration: Configuration) -> some View {
    ToolbarButtonBody(configuration: configuration, active: active, quiet: quiet)
  }

  private struct ToolbarButtonBody: View {
    let configuration: Configuration
    let active: Bool
    let quiet: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      configuration.label
        .font(.ui(Typography.Size.sm, weight: .medium))
        .foregroundStyle(active ? Palette.primary : (hovering ? Palette.ink : Palette.inkBody))
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, Space.s2 + 2)
        .frame(height: ProblemLibraryMetrics.controlHeight)
        .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .fill(configuration.isPressed ? Palette.surfaceSelected : active ? Palette.surfaceSelected : hovering ? Palette.surfaceHover : .clear))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .strokeBorder(quiet || active ? .clear : Palette.hairlineStrong, lineWidth: 1))
        .contentShape(Rectangle())
        .opacity(isEnabled ? 1 : 0.5)
        .onHover { hovering = $0 }
        .animation(Motion.fast, value: hovering)
    }
  }
}

/// Column titles over the index. Name, difficulty, kind, and last asked sort on click; right-click chooses columns.
private struct ProblemTableHeader: View {
  let store: ProblemLibraryStore
  let columns: [ProblemColumn]

  var body: some View {
    HStack(spacing: 0) {
      title("Problem", field: .name).frame(maxWidth: .infinity, alignment: .leading)
      ForEach(columns, id: \.self) { column in
        title(column.label, field: column.sortField).frame(width: column.width, alignment: .leading)
      }
      Color.clear.frame(width: ProblemColumn.actionsWidth, height: 1)
    }
    .padding(.horizontal, ProblemTableLayout.edge)
    .frame(height: ProblemLibraryMetrics.headerHeight)
    .contentShape(Rectangle())
    .contextMenu {
      ForEach(ProblemColumn.allCases, id: \.self) { column in
        Toggle(column.label, isOn: Binding(get: { store.settings.visibleColumns.contains(column) }, set: { on in
          store.update { settings in
            if on { settings.visibleColumns = ProblemColumn.allCases.filter { settings.visibleColumns.contains($0) || $0 == column } }
            else if settings.visibleColumns.count > 1 { settings.visibleColumns.removeAll { $0 == column } }
          }
        }))
      }
    }
  }

  @ViewBuilder
  private func title(_ text: String, field: ProblemSort.Field?) -> some View {
    let rule = store.settings.sort.first
    let active = field != nil && rule?.field == field
    let label = HStack(spacing: 3) {
      Text(text)
      if active, let rule {
        Image(systemName: rule.direction == .asc ? "chevron.up" : "chevron.down").font(.system(size: 8, weight: .bold))
      }
    }
    .font(.ui(Typography.Size.xs, weight: active ? .semibold : .medium))
    .foregroundStyle(active ? Palette.ink : Palette.inkMuted)
    .padding(.horizontal, Space.s3)
    if let field {
      Button {
        store.update { settings in
          let current = settings.sort.first
          settings.sort = [ProblemSort(field, current?.field == field && current?.direction == .asc ? .desc : .asc)]
        }
      } label: { label.contentShape(Rectangle()) }
      .buttonStyle(.plain)
      .help("Sort by \(text.lowercased())")
    } else {
      label
    }
  }
}
