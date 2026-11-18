import ManorKit
import SwiftUI

/// A one-click date for the calendar's footer.
public enum ManorDateQuickPick: Hashable, Sendable {
  case today, tomorrow, nextWeek, yesterday
  case custom(String, days: Int)

  var label: String {
    switch self {
    case .today: return "Today"
    case .tomorrow: return "Tomorrow"
    case .nextWeek: return "Next week"
    case .yesterday: return "Yesterday"
    case .custom(let label, _): return label
    }
  }

  func date(from today: CivilDate) -> CivilDate {
    switch self {
    case .today: return today
    case .tomorrow: return today.adding(days: 1)
    case .nextWeek: return today.adding(days: 7)
    case .yesterday: return today.adding(days: -1)
    case .custom(_, let days): return today.adding(days: days)
    }
  }
}

/// Labels for account-local dates: "Today", "Tomorrow", "Yesterday", otherwise "Thu, Nov 20", with the year when it
/// isn't this year's.
public enum ManorDateFormat {
  @MainActor private static var formatters: [String: DateFormatter] = [:]

  @MainActor
  static func formatter(_ template: String) -> DateFormatter {
    if let cached = formatters[template] { return cached }
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = .current
    formatter.setLocalizedDateFormatFromTemplate(template)
    formatters[template] = formatter
    return formatter
  }

  @MainActor
  public static func label(_ date: CivilDate, today: CivilDate) -> String {
    switch today.days(until: date) {
    case 0: return "Today"
    case 1: return "Tomorrow"
    case -1: return "Yesterday"
    default:
      return formatter(date.year == today.year ? "EEEMMMd" : "EEEMMMdyyyy").string(from: date.utcDate)
    }
  }

  /// "Tuesday, November 17, 2026", for VoiceOver.
  @MainActor
  public static func spoken(_ date: CivilDate) -> String { formatter("EEEEMMMMdyyyy").string(from: date.utcDate) }

  @MainActor
  static func monthTitle(_ month: CivilMonth) -> String { formatter("MMMMyyyy").string(from: month.first.utcDate) }
}

/// Manor's date control for account-local `YYYY-MM-DD` values: a field showing the date (or a placeholder), a clear
/// button when the date is optional, and a popover with a Monday-first month calendar, typed dates ("fri",
/// "12/3", "next week"), quick picks, and full keyboard control.
public struct ManorDatePicker: View {
  let title: String
  @Binding var selection: String?
  let explicitToday: String?
  let bounds: DateBounds
  let placeholder: String
  let clearable: Bool
  let quickPicks: [ManorDateQuickPick]
  let style: ManorPickerStyle
  let format: ((CivilDate) -> String)?
  @Environment(AppContext.self) private var context: AppContext?
  @State private var open = false
  @State private var typedSeed: String?

  /// - Parameters:
  ///   - title: The accessible name ("Due date"); also the tooltip.
  ///   - today: The account's today. Defaults to the signed-in account's.
  ///   - minimum, maximum: Inclusive `YYYY-MM-DD` bounds; days outside them are disabled.
  ///   - clearable: Offers a clear button and Clear in the popover.
  public init(_ title: String, selection: Binding<String?>, today: String? = nil, minimum: String? = nil, maximum: String? = nil,
              placeholder: String = "Not set", clearable: Bool = true, quickPicks: [ManorDateQuickPick] = [.today, .tomorrow, .nextWeek],
              style: ManorPickerStyle = .field, format: ((CivilDate) -> String)? = nil) {
    self.title = title
    _selection = selection
    explicitToday = today
    bounds = DateBounds(minimum: minimum.flatMap(CivilDate.init), maximum: maximum.flatMap(CivilDate.init))
    self.placeholder = placeholder
    self.clearable = clearable
    self.quickPicks = quickPicks
    self.style = style
    self.format = format
  }

  /// A date that is always set.
  public init(_ title: String, selection: Binding<String>, today: String? = nil, minimum: String? = nil, maximum: String? = nil,
              quickPicks: [ManorDateQuickPick] = [.today, .tomorrow, .nextWeek], style: ManorPickerStyle = .field,
              format: ((CivilDate) -> String)? = nil) {
    self.init(title, selection: Binding(get: { selection.wrappedValue }, set: { if let value = $0 { selection.wrappedValue = value } }),
              today: today, minimum: minimum, maximum: maximum, clearable: false, quickPicks: quickPicks, style: style, format: format)
  }

  private var today: CivilDate {
    explicitToday.flatMap(CivilDate.init)
      ?? context.flatMap { CivilDate($0.today) }
      ?? CivilDate.today(in: .current)
  }

  private var value: CivilDate? { selection.flatMap(CivilDate.init) }

  private func label(_ date: CivilDate) -> String { format?(date) ?? ManorDateFormat.label(date, today: today) }

  public var body: some View {
    PickerTrigger(
      style: style,
      isOpen: $open,
      accessibilityLabel: title,
      accessibilityValue: value.map(ManorDateFormat.spoken) ?? placeholder,
      accessibilityHint: "Shows a calendar",
      showsChevron: false,
      clearLabel: "Clear \(title.lowercased())",
      onClear: clearable && selection != nil ? { selection = nil } : nil,
      onKey: { press in
        // Typing on the focused field opens the calendar with what was typed.
        guard press.modifiers.isDisjoint(with: [.command, .control]), let first = press.characters.unicodeScalars.first,
              CharacterSet.alphanumerics.contains(first) else { return .ignored }
        typedSeed = press.characters
        open = true
        return .handled
      }
    ) {
      HStack(spacing: Space.s2) {
        Image(systemName: "calendar").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
        if let value {
          Text(label(value)).foregroundStyle(Palette.ink).lineLimit(1).tabular()
        } else {
          PickerPlaceholder(text: placeholder)
        }
      }
    } popover: {
      ManorCalendarPanel(
        selection: value, today: today, bounds: bounds, quickPicks: quickPicks, clearable: clearable && selection != nil,
        typedSeed: typedSeed
      ) { picked in
        selection = picked?.string
      }
      .onDisappear { typedSeed = nil }
    }
    .help(open ? "" : title)
  }
}

// MARK: Calendar

/// The popover's calendar: typed input, month header, weekday row, the 6-week grid, and quick picks.
struct ManorCalendarPanel: View {
  let selection: CivilDate?
  let today: CivilDate
  let bounds: DateBounds
  let quickPicks: [ManorDateQuickPick]
  let clearable: Bool
  var typedSeed: String?
  let onPick: (CivilDate?) -> Void
  /// For the render harness: show the keyboard focus on the focused day.
  var initialKeyboardFocus = false

  @Environment(\.manorPopover) private var popover
  @State private var month: CivilMonth
  @State private var focusedDay: CivilDate
  @State private var keyboardActive = false
  @State private var typed = ""
  @State private var typedInvalid = false
  @FocusState private var inputFocused: Bool

  static let cell = CGSize(width: 36, height: 32)

  init(selection: CivilDate?, today: CivilDate, bounds: DateBounds, quickPicks: [ManorDateQuickPick], clearable: Bool,
       typedSeed: String? = nil, initialKeyboardFocus: Bool = false, onPick: @escaping (CivilDate?) -> Void) {
    self.selection = selection
    self.today = today
    self.bounds = bounds
    self.quickPicks = quickPicks
    self.clearable = clearable
    self.typedSeed = typedSeed
    self.initialKeyboardFocus = initialKeyboardFocus
    self.onPick = onPick
    let start = bounds.clamp(selection ?? today)
    _month = State(initialValue: start.monthValue)
    _focusedDay = State(initialValue: start)
    _keyboardActive = State(initialValue: initialKeyboardFocus)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      PickerInput(text: $typed, prompt: "Type a date", systemImage: "text.cursor", invalid: typedInvalid, focused: $inputFocused,
                  accessibilityLabel: "Type a date")
        .onSubmit(commitTyped)
        .padding([.horizontal, .top], Space.s3)
      header.padding(.horizontal, Space.s3).padding(.top, Space.s3).padding(.bottom, Space.s1)
      weekdayRow.padding(.horizontal, Space.s3)
      grid.padding(.horizontal, Space.s3).padding(.bottom, Space.s2)
      if !quickPicks.isEmpty || clearable {
        Hairline()
        footer.padding(.horizontal, Space.s2).padding(.vertical, Space.s2)
      }
    }
    .frame(width: Self.cell.width * 7 + Space.s3 * 2)
    .onAppear {
      popover?.onKey(handle)
      if let typedSeed {
        typed = typedSeed
        inputFocused = true
      }
    }
    .onChange(of: typed) { _, text in preview(text) }
  }

  // MARK: Pieces

  private var header: some View {
    HStack(spacing: Space.s1) {
      Button { show(today.monthValue) } label: {
        Text(ManorDateFormat.monthTitle(month))
          .font(.display(Typography.Size.md, weight: .semibold))
          .foregroundStyle(Palette.ink)
          .contentTransition(.numericText())
      }
      .buttonStyle(.plain)
      .help("Go to this month")
      .accessibilityLabel(ManorDateFormat.monthTitle(month))
      .accessibilityHint("Goes to the current month")
      Spacer()
      monthButton("chevron.left", label: "Previous month", target: month.adding(months: -1))
      monthButton("chevron.right", label: "Next month", target: month.adding(months: 1))
    }
  }

  private func monthButton(_ symbol: String, label: String, target: CivilMonth) -> some View {
    IconButton(symbol, label: label, size: 26) { show(target) }
      .disabled(!bounds.allowsAny(of: target))
      .opacity(bounds.allowsAny(of: target) ? 1 : 0.35)
  }

  private var weekdayRow: some View {
    let symbols = ManorDateFormat.formatter("EEEEEE").shortStandaloneWeekdaySymbols ?? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return HStack(spacing: 0) {
      ForEach(MonthGrid.weekdays(), id: \.self) { iso in
        Text(String(symbols[iso % 7].prefix(2)))
          .font(.ui(Typography.Size.xs, weight: .medium))
          .foregroundStyle(Palette.inkMuted)
          .frame(width: Self.cell.width, height: 24)
      }
    }
    .accessibilityHidden(true)
  }

  private var grid: some View {
    let days = MonthGrid.days(for: month)
    return VStack(spacing: 0) {
      ForEach(0..<6, id: \.self) { week in
        HStack(spacing: 0) {
          ForEach(days[(week * 7)..<(week * 7 + 7)], id: \.self) { day in
            dayCell(day)
          }
        }
      }
    }
    .id(month)
    .transition(.opacity)
  }

  private func dayCell(_ day: CivilDate) -> some View {
    let inMonth = month.contains(day)
    let enabled = bounds.contains(day)
    let selected = day == selection
    let isToday = day == today
    let focused = keyboardActive && day == focusedDay && !inputFocused
    return Button { pick(day) } label: {
      CalendarDayCell(day: day.day, inMonth: inMonth, enabled: enabled, selected: selected, isToday: isToday, focused: focused)
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel(ManorDateFormat.spoken(day) + (isToday ? ", today" : ""))
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var footer: some View {
    HStack(spacing: Space.s1) {
      ForEach(quickPicks, id: \.self) { quick in
        let date = quick.date(from: today)
        Button(quick.label) { pick(date) }
          .buttonStyle(.manor(.ghost, size: .small))
          .disabled(!bounds.contains(date))
      }
      Spacer(minLength: 0)
      if clearable {
        Button("Clear") {
          onPick(nil)
          popover?.close()
        }
        .buttonStyle(.manor(.ghost, size: .small))
        .foregroundStyle(Palette.inkMuted)
      }
    }
  }

  // MARK: Behavior

  private func show(_ target: CivilMonth) {
    guard bounds.allowsAny(of: target) else { return }
    withAnimation(Motion.fast) { month = target }
    if !target.contains(focusedDay) { focusedDay = bounds.clamp(target.contains(today) ? today : target.first) }
  }

  private func pick(_ day: CivilDate) {
    guard bounds.contains(day) else { return }
    onPick(day)
    popover?.close()
  }

  private func preview(_ text: String) {
    guard !text.trimmingCharacters(in: .whitespaces).isEmpty else {
      typedInvalid = false
      return
    }
    if let parsed = DateTextParser.parse(text, today: today, dayFirst: DateTextParser.localeIsDayFirst()) {
      typedInvalid = !bounds.contains(parsed)
      focusedDay = parsed
      if !month.contains(parsed) { withAnimation(Motion.fast) { month = parsed.monthValue } }
    }
  }

  private func commitTyped() {
    guard let parsed = DateTextParser.parse(typed, today: today, dayFirst: DateTextParser.localeIsDayFirst()), bounds.contains(parsed) else {
      typedInvalid = !typed.trimmingCharacters(in: .whitespaces).isEmpty
      if typedInvalid { announcePickerChange("Not a date Manor can use") }
      return
    }
    pick(parsed)
  }

  private func moveFocus(_ key: DateKey) {
    keyboardActive = true
    let next = DateNavigation.move(focusedDay, by: key, within: bounds)
    focusedDay = next
    if !month.contains(next) { withAnimation(Motion.fast) { month = next.monthValue } }
    announcePickerChange(ManorDateFormat.spoken(next))
  }

  private func handle(_ press: ManorPopoverKeyPress) -> Bool {
    if press.editingText {
      switch press.key {
      case .returnKey:
        commitTyped()
        return true
      case .down, .tab:
        inputFocused = false
        keyboardActive = true
        return true
      case .escape where !typed.isEmpty:
        typed = ""
        inputFocused = false
        keyboardActive = true
        return true
      default:
        return false
      }
    }
    switch press.key {
    case .left: moveFocus(.previousDay)
    case .right: moveFocus(.nextDay)
    case .up: moveFocus(.previousWeek)
    case .down: moveFocus(.nextWeek)
    case .pageUp: moveFocus(press.shift ? .previousYear : .previousMonth)
    case .pageDown: moveFocus(press.shift ? .nextYear : .nextMonth)
    case .home: moveFocus(.startOfWeek)
    case .end: moveFocus(.endOfWeek)
    case .returnKey, .character(" "): pick(focusedDay)
    case .tab:
      inputFocused = true
    case .character(let text):
      guard let scalar = text.unicodeScalars.first, CharacterSet.alphanumerics.contains(scalar) || text == "+" || text == "-" else { return false }
      typed = text
      inputFocused = true
    default:
      return false
    }
    return true
  }
}

/// One day of the grid. Today is ringed, the selection is filled plum, keyboard focus adds Manor's halo, other
/// months' days are muted, and days outside the bounds fade further and take no clicks.
struct CalendarDayCell: View {
  let day: Int
  let inMonth: Bool
  let enabled: Bool
  let selected: Bool
  let isToday: Bool
  let focused: Bool
  @State private var hovering = false

  var body: some View {
    let shape = Circle()
    Text("\(day)")
      .font(.ui(Typography.Size.sm, weight: selected || isToday ? .semibold : .regular))
      .tabular()
      .foregroundStyle(foreground)
      .frame(width: 30, height: 30)
      .background {
        if selected {
          shape.fill(Palette.primary)
        } else if hovering && enabled {
          shape.fill(Palette.surfaceHover)
        }
      }
      .overlay {
        if isToday && !selected { shape.strokeBorder(Palette.primary, lineWidth: 1.5) }
      }
      .modifier(FocusRing(shape: shape, focused: focused, border: .clear))
      .frame(width: ManorCalendarPanel.cell.width, height: ManorCalendarPanel.cell.height)
      .contentShape(Rectangle())
      .onHover { hovering = $0 }
      .animation(Motion.press, value: hovering)
  }

  private var foreground: Color {
    if selected { return Palette.onPrimary }
    if !enabled { return Palette.inkMuted.opacity(0.4) }
    if isToday { return Palette.primary }
    return inMonth ? Palette.ink : Palette.inkMuted
  }
}
