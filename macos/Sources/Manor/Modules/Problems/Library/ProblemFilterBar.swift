import ManorKit
import SwiftUI

/// The common narrowings as menus beside the search: difficulty, status, topics, companies, collections, and
/// interview round. Values combine with OR inside a menu and AND across menus.
struct ProblemFilterBar: View {
  let store: ProblemLibraryStore
  let facets: ProblemFacets

  private var filters: ProblemFilters { store.settings.filters }

  var body: some View {
    let rounds = facets.roundTags
    let chosenRounds = filters.tags.filter(rounds.contains)
    let active = filters.difficulties.count + filters.statuses.count + filters.topics.count + filters.companies.count + filters.collections.count + chosenRounds.count > 0
    // A group rather than a stack, so the toolbar can lay the menus out in one row or wrap them.
    Group {
      ProblemFilterMenu(label: "Difficulty", selected: filters.difficulties.map(\.rawValue), searchable: false, options: {
        ProblemDifficulty.allCases.map { ProblemFacetOption(value: $0.rawValue, label: $0.rawValue, count: facets.difficulty[$0] ?? 0) }
      }, tone: { ProblemDifficulty(rawValue: $0).map { ProblemDifficultyBadge.colors($0).0 } }) { next in
        store.update { $0.filters.difficulties = ProblemDifficulty.allCases.filter { next.contains($0.rawValue) } }
      }
      ProblemFilterMenu(label: "Status", selected: filters.statuses.map(\.rawValue), searchable: false, options: {
        ProblemStatus.allCases.map { ProblemFacetOption(value: $0.rawValue, label: $0.label, count: facets.status[$0] ?? 0) }
      }) { next in
        store.update { $0.filters.statuses = ProblemStatus.allCases.filter { next.contains($0.rawValue) } }
      }
      ProblemFilterMenu(label: "Topics", selected: filters.topics, searchable: true, options: { facets.topics }, help: ProblemTopics.rubric(of:)) { next in
        store.update { $0.filters.topics = next }
      }
      ProblemFilterMenu(label: "Companies", selected: filters.companies, searchable: true, options: { facets.companies }) { next in
        store.update { $0.filters.companies = next }
      }
      ProblemFilterMenu(label: "Collections", selected: filters.collections, searchable: true, options: { facets.collections }) { next in
        store.update { $0.filters.collections = next }
      }
      if !rounds.isEmpty {
        ProblemFilterMenu(label: "Round", selected: chosenRounds, searchable: false, options: { facets.rounds }) { next in
          store.update { $0.filters.tags = $0.filters.tags.filter { !rounds.contains($0) } + next }
        }
      }
      if active {
        Button("Clear all") {
          store.update {
            $0.filters.difficulties = []
            $0.filters.statuses = []
            $0.filters.topics = []
            $0.filters.companies = []
            $0.filters.collections = []
            $0.filters.tags = $0.filters.tags.filter { !rounds.contains($0) }
          }
        }
        .buttonStyle(ProblemToolbarButtonStyle(quiet: true))
      }
    }
  }
}

/// One filter: a trigger that shows how many values are chosen, over a checklist with counts and a Clear action.
struct ProblemFilterMenu: View {
  let label: String
  let selected: [String]
  let searchable: Bool
  /// Built when the menu opens, so only a menu someone is looking at lists its options.
  let options: () -> [ProblemFacetOption]
  var tone: (String) -> Color? = { _ in nil }
  var help: (String) -> String? = { _ in nil }
  let onChange: ([String]) -> Void
  @State private var open = false
  @State private var hovering = false

  var body: some View {
    let active = !selected.isEmpty
    Button { open.toggle() } label: {
      HStack(spacing: Space.s1) {
        Text(label)
        if active { Text("\(selected.count)").tabular() }
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).opacity(0.7)
      }
      .font(.ui(Typography.Size.sm, weight: active ? .semibold : .medium))
      .foregroundStyle(active ? Palette.primary : (hovering || open ? Palette.ink : Palette.inkBody))
      .padding(.leading, Space.s2 + 2)
      .padding(.trailing, Space.s2)
      .frame(height: ProblemLibraryMetrics.controlHeight)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(active ? Palette.surfaceSelected : (hovering || open ? Palette.surfaceHover : .clear)))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(active ? .clear : Palette.hairlineStrong, lineWidth: 1))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: hovering)
    .accessibilityLabel(active ? "\(label): \(selected.count) selected" : label)
    .popover(isPresented: $open, arrowEdge: .bottom) {
      ProblemFilterOptions(label: label, selected: selected, searchable: searchable, options: options(), tone: tone, help: help, onChange: onChange)
    }
  }
}

private struct ProblemFilterOptions: View {
  let label: String
  let selected: [String]
  let searchable: Bool
  let options: [ProblemFacetOption]
  let tone: (String) -> Color?
  let help: (String) -> String?
  let onChange: ([String]) -> Void
  @State private var query = ""
  @State private var expanded: Set<String> = []
  @FocusState private var searchFocused: Bool
  /// Keyboard focus reads as the row's highlight, like a menu, instead of a ring the scroll view clips.
  @FocusState private var focusedRow: String?

  var body: some View {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    let hit: (ProblemFacetOption) -> Bool = { needle.isEmpty || $0.label.lowercased().contains(needle) }
    let shown: [ProblemFacetOption] = needle.isEmpty ? options : options.compactMap { option in
      let children = option.children.filter(hit)
      guard hit(option) || !children.isEmpty else { return nil }
      var copy = option
      if !hit(option) { copy.children = children }
      return copy
    }
    VStack(spacing: 0) {
      if searchable {
        HStack(spacing: 6) {
          Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.inkMuted)
          TextField("Search", text: $query).textFieldStyle(.plain).font(.ui(Typography.Size.sm)).focused($searchFocused)
        }
        .padding(.horizontal, Space.s2)
        .frame(height: 28)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(Palette.surfaceSoft))
        .padding([.horizontal, .top], Space.s2)
      }
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if shown.isEmpty {
            Text("No matches").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(Space.s2)
          }
          ForEach(shown) { option in
            let isOpen = !option.children.isEmpty && (expanded.contains(option.value) || (!needle.isEmpty && !hit(option)))
            row(option, expandable: !option.children.isEmpty, isOpen: isOpen)
            if isOpen {
              ForEach(option.children) { child in row(child, expandable: false, isOpen: false).padding(.leading, Space.s5) }
            }
          }
        }
        .padding(Space.s1)
      }
      .frame(maxHeight: 380)
      Hairline()
      HStack {
        Spacer()
        Button("Clear") { onChange([]) }
          .buttonStyle(.plain)
          .font(.ui(Typography.Size.sm, weight: .medium))
          .foregroundStyle(selected.isEmpty ? Palette.inkMuted : Palette.primary)
          .disabled(selected.isEmpty)
      }
      .padding(.horizontal, Space.s3)
      .frame(height: 32)
    }
    .frame(width: 280)
    .onAppear { if searchable { searchFocused = true } }
  }

  private func row(_ option: ProblemFacetOption, expandable: Bool, isOpen: Bool) -> some View {
    let checked = selected.contains(option.value)
    return HStack(spacing: Space.s1) {
      Button {
        onChange(checked ? selected.filter { $0 != option.value } : selected + [option.value])
      } label: {
        HStack(spacing: Space.s2) {
          Image(systemName: checked ? "checkmark.square.fill" : "square")
            .font(.system(size: 14))
            .foregroundStyle(checked ? Palette.primary : Palette.controlBorder)
          Text(option.label)
            .font(.ui(Typography.Size.sm, weight: checked ? .medium : .regular))
            .foregroundStyle(tone(option.value) ?? Palette.ink)
            .lineLimit(1)
            .truncationMode(.tail)
          Spacer(minLength: Space.s2)
          Text(option.count.formatted()).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
        }
        .padding(.horizontal, Space.s2)
        .frame(height: 30)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .focusEffectDisabled()
      .focused($focusedRow, equals: option.value)
      .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(focusedRow == option.value ? Palette.surfaceHover : .clear))
      .rowBackground()
      .help(help(option.value) ?? "")
      .accessibilityAddTraits(checked ? .isSelected : [])
      if expandable {
        Button {
          withAnimation(Motion.fast) {
            if expanded.contains(option.value) { expanded.remove(option.value) } else { expanded.insert(option.value) }
          }
        } label: {
          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Palette.inkMuted)
            .rotationEffect(.degrees(isOpen ? 90 : 0))
            .frame(width: 24, height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .rowBackground()
        .accessibilityLabel("\(isOpen ? "Hide" : "Show") \(option.label) patterns")
      }
    }
  }
}
