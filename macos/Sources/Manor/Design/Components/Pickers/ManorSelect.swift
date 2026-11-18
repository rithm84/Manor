import ManorKit
import SwiftUI

/// One choice in a `ManorSelect`.
public struct ManorSelectOption<Value: Hashable>: Identifiable {
  public let value: Value
  public let label: String
  public var systemImage: String?
  public var swatch: Color?
  public var section: String?
  public var detail: String?
  public var isDisabled: Bool
  /// Extra words search matches besides the label (a time zone's identifier, say).
  public var keywords: String?

  public var id: Value { value }

  public init(_ value: Value, _ label: String, systemImage: String? = nil, swatch: Color? = nil, section: String? = nil,
              detail: String? = nil, isDisabled: Bool = false, keywords: String? = nil) {
    self.value = value
    self.label = label
    self.systemImage = systemImage
    self.swatch = swatch
    self.section = section
    self.detail = detail
    self.isDisabled = isDisabled
    self.keywords = keywords
  }
}

/// Manor's dropdown: a trigger showing the current value (with its icon or color), and a popover list with a
/// checkmark on the current value, section headings, type-to-select, search past ten options, arrow keys,
/// Return, and Escape. Optional selects offer "None" first.
public struct ManorSelect<Value: Hashable, ValueLabel: View>: View {
  let title: String
  @Binding var selection: Value?
  let options: [ManorSelectOption<Value>]
  let placeholder: String
  let noneLabel: String?
  let style: ManorPickerStyle
  let searchable: Bool
  let searchPrompt: String
  let width: CGFloat?
  let valueLabel: (ManorSelectOption<Value>) -> ValueLabel
  @State private var open = false

  /// - Parameters:
  ///   - title: The accessible name, also the tooltip.
  ///   - noneLabel: Adds a first row that clears the value ("None", "No parent page", "All habits").
  ///   - searchable: Defaults to on for lists longer than ten.
  ///   - width: The list's width; it never narrows below the trigger.
  public init(_ title: String, selection: Binding<Value?>, options: [ManorSelectOption<Value>], placeholder: String = "None",
              noneLabel: String? = nil, style: ManorPickerStyle = .field, searchable: Bool? = nil, searchPrompt: String = "Search",
              width: CGFloat? = nil, @ViewBuilder valueLabel: @escaping (ManorSelectOption<Value>) -> ValueLabel) {
    self.title = title
    _selection = selection
    self.options = options
    self.placeholder = placeholder
    self.noneLabel = noneLabel
    self.style = style
    self.searchable = searchable ?? (options.count > 10)
    self.searchPrompt = searchPrompt
    self.width = width
    self.valueLabel = valueLabel
  }

  private var current: ManorSelectOption<Value>? { selection.flatMap { value in options.first { $0.value == value } } }

  public var body: some View {
    PickerTrigger(
      style: style,
      isOpen: $open,
      accessibilityLabel: title,
      accessibilityValue: current?.label ?? noneLabel ?? placeholder,
      matchTriggerWidth: true
    ) {
      if let current {
        valueLabel(current)
      } else {
        PickerPlaceholder(text: noneLabel ?? placeholder)
      }
    } popover: {
      ManorSelectList(
        options: options, selected: selection.map { [$0] } ?? [], noneLabel: noneLabel, multiple: false,
        searchable: searchable, searchPrompt: searchPrompt, width: width
      ) { value in
        selection = value
        return true
      }
    }
    .help(title)
  }
}

public extension ManorSelect where ValueLabel == ManorSelectValueText {
  /// A select whose closed state shows the option's icon or swatch and label.
  init(_ title: String, selection: Binding<Value?>, options: [ManorSelectOption<Value>], placeholder: String = "None",
       noneLabel: String? = nil, style: ManorPickerStyle = .field, searchable: Bool? = nil, searchPrompt: String = "Search", width: CGFloat? = nil) {
    self.init(title, selection: selection, options: options, placeholder: placeholder, noneLabel: noneLabel, style: style,
              searchable: searchable, searchPrompt: searchPrompt, width: width) { ManorSelectValueText(option: $0) }
  }

  /// A select that always has a value.
  init(_ title: String, selection: Binding<Value>, options: [ManorSelectOption<Value>], style: ManorPickerStyle = .field,
       searchable: Bool? = nil, searchPrompt: String = "Search", width: CGFloat? = nil) {
    self.init(title, selection: Binding<Value?>(get: { selection.wrappedValue }, set: { if let value = $0 { selection.wrappedValue = value } }),
              options: options, style: style, searchable: searchable, searchPrompt: searchPrompt, width: width)
  }
}

public extension ManorSelect {
  /// A select that always has a value, with a custom closed label.
  init(_ title: String, selection: Binding<Value>, options: [ManorSelectOption<Value>], style: ManorPickerStyle = .field,
       searchable: Bool? = nil, searchPrompt: String = "Search", width: CGFloat? = nil,
       @ViewBuilder valueLabel: @escaping (ManorSelectOption<Value>) -> ValueLabel) {
    self.init(title, selection: Binding<Value?>(get: { selection.wrappedValue }, set: { if let value = $0 { selection.wrappedValue = value } }),
              options: options, style: style, searchable: searchable, searchPrompt: searchPrompt, width: width, valueLabel: valueLabel)
  }
}

/// The closed select's default value: icon or color dot, then the label.
public struct ManorSelectValueText: View {
  let option: ManorSelectOptionDisplay

  init<Value>(option: ManorSelectOption<Value>) {
    self.option = ManorSelectOptionDisplay(label: option.label, systemImage: option.systemImage, swatch: option.swatch)
  }

  public var body: some View {
    HStack(spacing: 6) {
      if let swatch = option.swatch {
        Circle().fill(swatch).frame(width: 8, height: 8)
      } else if let systemImage = option.systemImage {
        Image(systemName: systemImage).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      }
      Text(option.label).foregroundStyle(Palette.ink).lineLimit(1)
    }
  }
}

struct ManorSelectOptionDisplay {
  let label: String
  let systemImage: String?
  let swatch: Color?
}

/// A filter dropdown that keeps several values: checkboxes, and the popover stays open while you tick.
public struct ManorMultiSelect<Value: Hashable>: View {
  let title: String
  @Binding var selection: Set<Value>
  let options: [ManorSelectOption<Value>]
  let style: ManorPickerStyle
  let searchable: Bool
  let width: CGFloat?
  @State private var open = false

  public init(_ title: String, selection: Binding<Set<Value>>, options: [ManorSelectOption<Value>], style: ManorPickerStyle = .toolbar,
              searchable: Bool? = nil, width: CGFloat? = nil) {
    self.title = title
    _selection = selection
    self.options = options
    self.style = style
    self.searchable = searchable ?? (options.count > 10)
    self.width = width
  }

  private var summary: String {
    let chosen = options.filter { selection.contains($0.value) }
    switch chosen.count {
    case 0: return "Any"
    case 1: return chosen[0].label
    default: return "\(chosen.count) selected"
    }
  }

  public var body: some View {
    PickerTrigger(style: style, isOpen: $open, accessibilityLabel: title, accessibilityValue: summary, matchTriggerWidth: true) {
      HStack(spacing: Space.s1) {
        Text(title).foregroundStyle(selection.isEmpty ? Palette.inkBody : Palette.primary)
        if !selection.isEmpty { Text("\(selection.count)").foregroundStyle(Palette.primary).tabular() }
      }
      .fontWeight(selection.isEmpty ? .medium : .semibold)
    } popover: {
      ManorSelectList(options: options, selected: selection, noneLabel: nil, multiple: true, searchable: searchable, searchPrompt: "Search", width: width) { value in
        guard let value else { return false }
        if selection.contains(value) { selection.remove(value) } else { selection.insert(value) }
        return false
      }
    }
    .help(title)
  }
}

// MARK: List

/// The popover list behind `ManorSelect` and `ManorMultiSelect`. `onPick` returns whether the popover closes.
struct ManorSelectList<Value: Hashable>: View {
  let options: [ManorSelectOption<Value>]
  let selected: Set<Value>
  let noneLabel: String?
  let multiple: Bool
  let searchable: Bool
  let searchPrompt: String
  let width: CGFloat?
  let onPick: (Value?) -> Bool

  @Environment(\.manorPopover) private var popover
  @State private var query = ""
  @State private var highlighted: Row.ID?
  @State private var typeAhead = TypeAheadBuffer()
  @State private var keyboardScroll = 0
  @FocusState private var searchFocused: Bool

  struct Row: Identifiable {
    enum ID: Hashable { case none, value(Value) }
    let id: ID
    let option: ManorSelectOption<Value>?
    var section: String?
  }

  private var rows: [Row] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    var rows: [Row] = []
    if let noneLabel, needle.isEmpty || noneLabel.lowercased().contains(needle) { rows.append(Row(id: .none, option: nil)) }
    for option in options {
      if !needle.isEmpty {
        let haystack = (option.label + " " + (option.keywords ?? "") + " " + (option.detail ?? "")).lowercased()
        guard haystack.contains(needle) else { continue }
      }
      rows.append(Row(id: .value(option.value), option: option, section: option.section))
    }
    return rows
  }

  private func selectable(_ row: Row) -> Bool { !(row.option?.isDisabled ?? false) }

  var body: some View {
    let rows = rows
    VStack(spacing: 0) {
      if searchable {
        PickerInput(text: $query, prompt: searchPrompt, focused: $searchFocused, accessibilityLabel: searchPrompt)
          .padding([.horizontal, .top], Space.s2)
          .padding(.bottom, Space.s1)
      }
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 1) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
              if let section = row.section, index == 0 || rows[index - 1].section != section {
                PickerSectionHeader(title: section)
              }
              rowView(row).id(row.id)
            }
            if rows.isEmpty {
              Text("No matches").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
                .padding(.horizontal, Space.s2).frame(height: 30)
            }
          }
          .padding(Space.s1)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: 320)
        .fixedSize(horizontal: false, vertical: true)
        .onAppear {
          let start = selected.first.map { Row.ID.value($0) } ?? rows.first(where: selectable)?.id
          highlighted = start
          if let start { proxy.scrollTo(start, anchor: .center) }
        }
        .onChange(of: keyboardScroll) { _, _ in
          if let highlighted { proxy.scrollTo(highlighted) }
        }
      }
    }
    .frame(width: width, alignment: .leading)
    .frame(minWidth: 180, maxWidth: width ?? 360)
    .onAppear {
      if searchable { searchFocused = true }
      popover?.onKey(handle)
    }
    .onChange(of: query) { _, _ in highlighted = self.rows.first(where: selectable)?.id }
    .accessibilityElement(children: .contain)
  }

  private func rowView(_ row: Row) -> some View {
    let isSelected: Bool
    switch row.id {
    case .none: isSelected = selected.isEmpty
    case .value(let value): isSelected = selected.contains(value)
    }
    let label = row.option?.label ?? noneLabel ?? "None"
    return Button { pick(row) } label: {
      PickerRow(
        label: label, systemImage: row.option?.systemImage, swatch: row.option?.swatch, detail: row.option?.detail,
        selected: isSelected, highlighted: highlighted == row.id, muted: row.option == nil, multiple: multiple,
        disabled: !selectable(row)
      )
    }
    .buttonStyle(.plain)
    .disabled(!selectable(row))
    .onHover { if $0, selectable(row) { highlighted = row.id } }
    .accessibilityLabel(label)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }

  private func pick(_ row: Row) {
    guard selectable(row) else { return }
    let value: Value?
    switch row.id {
    case .none: value = nil
    case .value(let picked): value = picked
    }
    if onPick(value) { popover?.close() }
  }

  private func move(_ delta: Int) {
    let candidates = rows.filter(selectable)
    guard !candidates.isEmpty else { return }
    let index = candidates.firstIndex { $0.id == highlighted }
    let next: Int
    switch (index, delta) {
    case (nil, let d): next = d > 0 ? 0 : candidates.count - 1
    case (let i?, let d) where abs(d) > 1: next = min(max(i + d, 0), candidates.count - 1)
    case (let i?, let d): next = (i + d + candidates.count) % candidates.count
    }
    highlighted = candidates[next].id
    keyboardScroll += 1
    announcePickerChange(candidates[next].option?.label ?? noneLabel ?? "None")
  }

  private func handle(_ press: ManorPopoverKeyPress) -> Bool {
    switch press.key {
    case .down: move(1); return true
    case .up: move(-1); return true
    case .pageDown: move(8); return true
    case .pageUp: move(-8); return true
    case .home where !press.editingText: move(-rows.count); return true
    case .end where !press.editingText: move(rows.count); return true
    case .returnKey:
      if let row = rows.first(where: { $0.id == highlighted }) { pick(row) }
      return true
    case .character(" ") where !press.editingText:
      if let row = rows.first(where: { $0.id == highlighted }) { pick(row) }
      return true
    case .escape where !query.isEmpty:
      query = ""
      return true
    case .character(let typed) where !press.editingText:
      if searchable {
        searchFocused = true
        query += typed
        return true
      }
      let prefix = typeAhead.append(typed)
      let candidates = rows.filter(selectable)
      let start = (candidates.firstIndex { $0.id == highlighted } ?? -1) + (prefix.count == 1 ? 1 : 0)
      let ordered = Array(candidates[max(0, min(start, candidates.count))...] + candidates[..<max(0, min(start, candidates.count))])
      if let match = ordered.first(where: { ($0.option?.label ?? noneLabel ?? "").lowercased().hasPrefix(prefix) }) {
        highlighted = match.id
        keyboardScroll += 1
      }
      return true
    default:
      return false
    }
  }
}
