import ManorKit
import SwiftUI

/// Manor's time control for `HH:MM` values: a field showing the time on the system's 12- or 24-hour clock and a
/// popover with a typed-time input ("5:30 pm", "17:30") over a scrolling list of steps, centered on the value.
public struct ManorTimePicker: View {
  let title: String
  @Binding var selection: String?
  let step: Int
  let range: ClosedRange<Int>
  let placeholder: String
  let clearable: Bool
  let style: ManorPickerStyle
  let twentyFourHour: Bool
  @State private var open = false
  @State private var typedSeed: String?

  /// - Parameters:
  ///   - step: Minutes between listed times.
  ///   - range: Minutes after midnight the control accepts, inclusive.
  ///   - twentyFourHour: Defaults to the system's clock setting.
  public init(_ title: String, selection: Binding<String?>, step: Int = 15, range: ClosedRange<Int> = 0...(24 * 60 - 1),
              placeholder: String = "Not set", clearable: Bool = true, style: ManorPickerStyle = .field, twentyFourHour: Bool? = nil) {
    self.title = title
    _selection = selection
    self.step = step
    self.range = range
    self.placeholder = placeholder
    self.clearable = clearable
    self.style = style
    self.twentyFourHour = twentyFourHour ?? ClockTime.systemUsesTwentyFourHour()
  }

  /// A time that is always set.
  public init(_ title: String, selection: Binding<String>, step: Int = 15, range: ClosedRange<Int> = 0...(24 * 60 - 1),
              style: ManorPickerStyle = .field, twentyFourHour: Bool? = nil) {
    self.init(title, selection: Binding(get: { selection.wrappedValue }, set: { if let value = $0 { selection.wrappedValue = value } }),
              step: step, range: range, clearable: false, style: style, twentyFourHour: twentyFourHour)
  }

  private var value: ClockTime? { selection.flatMap(ClockTime.init) }

  public var body: some View {
    PickerTrigger(
      style: style,
      isOpen: $open,
      accessibilityLabel: title,
      accessibilityValue: value.map { $0.label(twentyFourHour: twentyFourHour) } ?? placeholder,
      showsChevron: false,
      clearLabel: "Clear \(title.lowercased())",
      onClear: clearable && selection != nil ? { selection = nil } : nil,
      matchTriggerWidth: true,
      onKey: { press in
        guard press.modifiers.isDisjoint(with: [.command, .control]), let first = press.characters.unicodeScalars.first,
              CharacterSet.decimalDigits.contains(first) || "nm".unicodeScalars.contains(first) else { return .ignored }
        typedSeed = press.characters
        open = true
        return .handled
      }
    ) {
      HStack(spacing: Space.s2) {
        Image(systemName: "clock").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
        if let value {
          Text(value.label(twentyFourHour: twentyFourHour)).foregroundStyle(Palette.ink).lineLimit(1).tabular()
        } else {
          PickerPlaceholder(text: placeholder)
        }
      }
    } popover: {
      ManorTimeList(selection: value, step: step, range: range, twentyFourHour: twentyFourHour, clearable: clearable && selection != nil,
                    typedSeed: typedSeed) { picked in
        selection = picked?.string
      }
      .onDisappear { typedSeed = nil }
    }
    .help(title)
  }
}

/// The time popover: typing on top, steps below. Typing highlights the nearest step; Return keeps exactly what was
/// typed when it reads as a time, otherwise the highlighted step.
struct ManorTimeList: View {
  let selection: ClockTime?
  let step: Int
  let range: ClosedRange<Int>
  let twentyFourHour: Bool
  let clearable: Bool
  var typedSeed: String?
  let onPick: (ClockTime?) -> Void

  @Environment(\.manorPopover) private var popover
  @State private var typed = ""
  @State private var highlighted: ClockTime?
  @State private var preferTyped = false
  @State private var scrollRequest = 0
  @FocusState private var inputFocused: Bool

  private var options: [ClockTime] { TimeOptions.list(step: step, start: range.lowerBound, end: range.upperBound, including: selection) }

  private var parsed: ClockTime? { TimeTextParser.parse(typed) }
  private var typedInvalid: Bool {
    guard !typed.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
    guard let parsed else { return typed.count > 2 }
    return !range.contains(parsed.minutes)
  }

  var body: some View {
    let options = options
    VStack(spacing: 0) {
      PickerInput(text: $typed, prompt: "Type a time", systemImage: "clock",
                  invalid: typedInvalid, focused: $inputFocused, accessibilityLabel: "Type a time")
        .onSubmit(commit)
        .padding([.horizontal, .top], Space.s2)
        .padding(.bottom, Space.s1)
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 1) {
            ForEach(options, id: \.self) { time in
              Button { choose(time) } label: {
                PickerRow(label: time.label(twentyFourHour: twentyFourHour), selected: time == selection, highlighted: time == highlighted)
                  .tabular()
              }
              .buttonStyle(.plain)
              .onHover { if $0 { highlighted = time; preferTyped = false } }
              .accessibilityAddTraits(time == selection ? .isSelected : [])
              .id(time)
            }
          }
          .padding(Space.s1)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(CGFloat(options.count) * 31 + Space.s2, 248))
        .onAppear {
          highlighted = selection ?? options.first { $0.minutes >= 9 * 60 } ?? options.first
          if let highlighted { proxy.scrollTo(highlighted, anchor: .center) }
        }
        .onChange(of: scrollRequest) { _, _ in
          if let highlighted { proxy.scrollTo(highlighted, anchor: .center) }
        }
      }
      if clearable {
        Hairline()
        HStack {
          Spacer()
          Button("Clear") {
            onPick(nil)
            popover?.close()
          }
          .buttonStyle(.manor(.ghost, size: .small))
          .foregroundStyle(Palette.inkMuted)
        }
        .padding(Space.s1)
      }
    }
    .frame(minWidth: 168, idealWidth: 188, maxWidth: 220)
    .onAppear {
      popover?.onKey(handle)
      if let typedSeed { typed = typedSeed }
      inputFocused = true
    }
    .onChange(of: typed) { _, _ in
      guard let parsed else { return }
      preferTyped = true
      if let nearest = TimeOptions.nearest(to: parsed, in: options) {
        highlighted = nearest
        scrollRequest += 1
      }
    }
  }

  private func choose(_ time: ClockTime) {
    guard range.contains(time.minutes) else { return }
    onPick(time)
    popover?.close()
  }

  private func commit() {
    if preferTyped, let parsed {
      if range.contains(parsed.minutes) { choose(parsed) } else { announcePickerChange("Outside the times this accepts") }
      return
    }
    if let highlighted { choose(highlighted) }
  }

  private func move(_ delta: Int) {
    let options = options
    guard !options.isEmpty else { return }
    let index = highlighted.flatMap { options.firstIndex(of: $0) } ?? (delta > 0 ? -1 : options.count)
    let next = min(max(index + delta, 0), options.count - 1)
    highlighted = options[next]
    preferTyped = false
    scrollRequest += 1
    announcePickerChange(options[next].label(twentyFourHour: twentyFourHour))
  }

  private func handle(_ press: ManorPopoverKeyPress) -> Bool {
    switch press.key {
    case .down: move(1); return true
    case .up: move(-1); return true
    case .pageDown: move(4); return true
    case .pageUp: move(-4); return true
    case .returnKey: commit(); return true
    case .escape where !typed.isEmpty:
      typed = ""
      preferTyped = false
      return true
    default: return false
    }
  }
}
