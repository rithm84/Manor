import ManorKit
import SwiftUI

/// A plain calendar date (`YYYY-MM-DD`) edited with Manor's calendar; cleared means any date.
struct ProblemDayPicker: View {
  let label: String
  @Binding var value: String?
  var minimum: String?
  var maximum: String?
  var clearable = true
  var quickPicks: [ManorDateQuickPick] = [.today, .yesterday, .custom("90 days ago", days: -90)]

  var body: some View {
    ManorDatePicker(label, selection: $value, minimum: minimum, maximum: maximum, placeholder: "Any date",
                    clearable: clearable, quickPicks: quickPicks)
      .fixedSize()
  }
}

/// The finer controls: sort, grouping, the last-asked range, columns, kind, source, content, and the evidence
/// tags the bar does not cover (roles, technologies, employment, and other tags).
struct ProblemAdvancedPanel: View {
  let store: ProblemLibraryStore
  let facets: ProblemFacets
  let today: String
  let onClose: () -> Void
  @State private var tagSearch = ""

  private var settings: ProblemViewSettings { store.settings }
  private var filters: ProblemFilters { settings.filters }

  var body: some View {
    DialogPanel("Advanced", onClose: onClose) {
      VStack(alignment: .leading, spacing: Space.s5) {
        arrangement
        section("Last asked") {
          HStack(spacing: Space.s4) {
            labeled("From") {
              ProblemDayPicker(label: "Last asked from", value: binding(\.lastAskedSince), maximum: filters.lastAskedUntil)
            }
            labeled("Through") {
              ProblemDayPicker(label: "Last asked through", value: binding(\.lastAskedUntil), minimum: filters.lastAskedSince)
            }
          }
          Text(filters.invalidDateRange ? "The start date must be on or before the end date." : "Problems without a reported date are left out.")
            .font(.ui(Typography.Size.xs))
            .foregroundStyle(filters.invalidDateRange ? Palette.overdueError : Palette.inkMuted)
        }
        section("Columns") {
          checks(ProblemColumn.allCases, label: \.label, isOn: { settings.visibleColumns.contains($0) }, disabled: { settings.visibleColumns == [$0] }) { column in
            store.update { settings in
              if settings.visibleColumns.contains(column) { settings.visibleColumns.removeAll { $0 == column } }
              else { settings.visibleColumns = ProblemColumn.allCases.filter { settings.visibleColumns.contains($0) || $0 == column } }
            }
          }
        }
        section("Kind") {
          checks(ProblemKind.allCases, label: \.label, isOn: { filters.kinds.contains($0) }) { kind in
            store.update { $0.filters.kinds = toggled($0.filters.kinds, kind) }
          }
        }
        section("Source") {
          checks(ProblemSourceType.allCases, label: \.label, isOn: { filters.sourceTypes.contains($0) }) { source in
            store.update { $0.filters.sourceTypes = toggled($0.filters.sourceTypes, source) }
          }
          HStack(spacing: Space.s2) {
            Text("Statement").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
            ManorSelect("Statement", selection: Binding(get: { filters.hasContent }, set: { value in store.update { $0.filters.hasContent = value } }),
                        options: [ManorSelectOption(true, "Written out"), ManorSelectOption(false, "Details only")], noneLabel: "Any")
              .fixedSize()
          }
        }
        tagSections
      }
      .padding(.top, Space.s1)
    } footer: {
      Button("Clear filters") { store.update { $0.filters = $0.filters.clearingAll } }.buttonStyle(.ghost)
      Spacer()
      Button("Done", action: onClose).buttonStyle(.primary).keyboardShortcut(.defaultAction).disabled(filters.invalidDateRange)
    }
  }

  private var arrangement: some View {
    HStack(spacing: Space.s4) {
      labeled("Sort") {
        ManorSelect("Sort", selection: Binding(get: { settings.sort.first?.field ?? .name }, set: { field in
          store.update { $0.sort = [ProblemSort(field, $0.sort.first?.direction ?? .asc)] }
        }), options: [ProblemSort.Field.name, .difficulty, .kind, .lastAsked, .createdAt, .updatedAt].map { ManorSelectOption($0, $0.label) })
        .fixedSize()
      }
      labeled("Direction") {
        ManorSelect("Direction", selection: Binding(get: { settings.sort.first?.direction ?? .asc }, set: { direction in
          store.update { $0.sort = [ProblemSort($0.sort.first?.field ?? .name, direction)] }
        }), options: [ManorSelectOption(ProblemSort.Direction.asc, "Ascending", systemImage: "arrow.up"),
                      ManorSelectOption(ProblemSort.Direction.desc, "Descending", systemImage: "arrow.down")])
        .fixedSize()
      }
      labeled("Group by") {
        ManorSelect("Group by", selection: Binding(get: { settings.groupBy }, set: { value in store.update { $0.groupBy = value } }),
                    options: ProblemGroupBy.allCases.map { ManorSelectOption($0, $0.label) }, noneLabel: "None")
        .fixedSize()
      }
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder
  private var tagSections: some View {
    let sections = facets.tagSections
    if !sections.isEmpty {
      let needle = tagSearch.trimmingCharacters(in: .whitespaces).lowercased()
      let visible = sections.compactMap { section -> ProblemTagSection? in
        var copy = section
        if !needle.isEmpty { copy.options = section.options.filter { $0.label.lowercased().contains(needle) } }
        return copy.options.isEmpty ? nil : copy
      }
      VStack(alignment: .leading, spacing: Space.s4) {
        TextField("Find roles and other tags", text: $tagSearch).textFieldStyle(.manor)
        if visible.isEmpty {
          Text("No tags match.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        ForEach(visible) { section in
          self.section(section.title) {
            ScrollView {
              checks(section.options, label: \.label, isOn: { filters.tags.contains($0.value) }) { option in
                store.update { $0.filters.tags = toggled($0.filters.tags, option.value) }
              }
            }
            .frame(maxHeight: section.options.count > 12 ? 180 : nil)
          }
        }
      }
    }
  }

  private func binding(_ path: WritableKeyPath<ProblemFilters, String?>) -> Binding<String?> {
    Binding(get: { filters[keyPath: path] }, set: { value in store.update { $0.filters[keyPath: path] = value } })
  }

  private func toggled<T: Equatable>(_ values: [T], _ value: T) -> [T] {
    values.contains(value) ? values.filter { $0 != value } : values + [value]
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      Text(title).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
      content()
    }
  }

  private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      Text(title).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted)
      content()
    }
  }

  private func checks<Item: Hashable>(_ items: [Item], label: KeyPath<Item, String>, isOn: @escaping (Item) -> Bool,
                                      disabled: @escaping (Item) -> Bool = { _ in false }, toggle: @escaping (Item) -> Void) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Space.s2, alignment: .leading)], alignment: .leading, spacing: Space.s1) {
      ForEach(items, id: \.self) { item in
        Toggle(item[keyPath: label], isOn: Binding(get: { isOn(item) }, set: { _ in toggle(item) }))
          .toggleStyle(.checkbox)
          .font(.ui(Typography.Size.sm))
          .foregroundStyle(Palette.inkBody)
          .tint(Palette.primary)
          .lineLimit(1)
          .disabled(disabled(item))
      }
    }
  }
}

/// Names and saves the current view, as a new view or over the selected one, or deletes the selected view.
struct ProblemSaveViewPanel: View {
  let store: ProblemLibraryStore
  /// A view to rename only, keeping its saved settings; nil saves the current settings.
  let renaming: ProblemSavedView?
  let onClose: () -> Void
  let onDelete: (ProblemSavedView) -> Void
  @State private var name = ""
  @State private var error: String?
  @FocusState private var focused: Bool

  private var target: ProblemSavedView? { renaming ?? store.selectedView }

  var body: some View {
    DialogPanel(renaming != nil ? "Rename view" : target == nil ? "Save view" : "Edit view", onClose: onClose) {
      VStack(alignment: .leading, spacing: Space.s3) {
        TextField("Name", text: $name)
          .textFieldStyle(.manor)
          .focused($focused)
          .onSubmit { save(asNew: false) }
          .onChange(of: name) { _, value in if value.count > 120 { name = String(value.prefix(120)) } }
        if renaming == nil {
          Text("Your filters, sorting, grouping, and columns are saved together.")
            .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        if let error { ErrorBanner(error) }
      }
    } footer: {
      if let target {
        Button("Delete") { onDelete(target) }.buttonStyle(.ghost).foregroundStyle(Palette.overdueError).disabled(store.busy)
      }
      Spacer()
      Button("Cancel", action: onClose).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      if target != nil && renaming == nil {
        Button("Save as new") { save(asNew: true) }.buttonStyle(.secondary).disabled(!canSave)
      }
      Button("Save") { save(asNew: false) }.buttonStyle(.primary).keyboardShortcut(.defaultAction).disabled(!canSave)
    }
    .onAppear {
      name = target?.name ?? ""
      focused = true
    }
  }

  private var canSave: Bool { !store.busy && !name.trimmingCharacters(in: .whitespaces).isEmpty }

  private func save(asNew: Bool) {
    guard canSave else { return }
    error = nil
    Task {
      do {
        if let renaming { try await store.renameView(renaming, to: name) } else { try await store.saveView(name: name, asNew: asNew) }
        onClose()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
