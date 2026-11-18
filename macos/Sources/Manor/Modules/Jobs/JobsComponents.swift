import ManorKit
import SwiftUI

extension JobTone {
  /// Text and mark color.
  var foreground: Color {
    switch self {
    case .today: return Palette.pillToday
    case .tomorrow: return Palette.pillTomorrow
    case .week: return Palette.pillWeek
    case .neutral: return Palette.inkBody
    case .gold: return Palette.gold
    case .plum: return Palette.thisWeekPlum
    case .success: return Palette.success
    case .info: return Palette.frozenInfo
    case .forest: return Palette.forest
    case .overdue: return Palette.pillOverdue
    }
  }

  /// Tinted fill behind the text.
  var fill: Color {
    switch self {
    case .today: return Palette.pillTodayTint
    case .tomorrow: return Palette.pillTomorrowTint
    case .week: return Palette.pillWeekTint
    case .neutral: return Palette.surfaceSoft
    case .gold: return Palette.goldSoft
    case .plum: return Palette.thisWeekPlumTint
    case .success: return Palette.successSoft
    case .info: return Palette.frozenInfoTint
    case .forest: return Palette.forestSoft
    case .overdue: return Palette.pillOverdueTint
    }
  }
}

extension JobColumn {
  /// The quiet line an empty column shows.
  var emptyLine: String {
    switch self {
    case .toApply: return "Nothing saved"
    case .applied: return "No applications"
    case .oa: return "No assessments"
    case .interview: return "No interviews"
    case .decided: return "No decisions yet"
    }
  }
}

/// A tinted job pill in one of the semantic tones.
struct JobPill: View {
  let text: String
  let tone: JobTone
  var systemImage: String?

  init(_ text: String, tone: JobTone, systemImage: String? = nil) {
    self.text = text
    self.tone = tone
    self.systemImage = systemImage
  }

  var body: some View {
    Pill(text, systemImage: systemImage, foreground: tone.foreground, fill: tone.fill)
  }
}

/// A small caption above a form control.
struct FieldLabel: View {
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
  }
}

/// A labelled form control.
struct LabeledField<Content: View>: View {
  let label: String
  @ViewBuilder let content: () -> Content
  init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
    self.label = label
    self.content = content
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      FieldLabel(label)
      content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A menu-backed picker that looks like the other form controls.
struct MenuField<Value: Hashable>: View {
  let options: [(value: Value, label: String)]
  @Binding var selection: Value?
  let placeholder: String
  var tone: ((Value) -> JobTone)?
  var accessibilityLabel: String

  var body: some View {
    ManorSelect(accessibilityLabel, selection: $selection,
                options: options.map { option in ManorSelectOption(option.value, option.label, swatch: tone.map { $0(option.value).foreground }) },
                placeholder: placeholder)
  }
}

/// A date that may stay unset: "Not set" until picked, then typed, picked, or cleared in Manor's calendar.
struct OptionalDateField: View {
  @Binding var value: String?
  let label: String
  /// Seeds the calendar when the date is unset, usually account today.
  let suggested: String

  var body: some View {
    ManorDatePicker(label, selection: $value, today: suggested, placeholder: "Not set", format: { JobDates.long($0.string) })
  }
}
