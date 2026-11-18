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

/// A bordered control body matching the text-field treatment, for menus and date buttons.
struct ControlChrome<Content: View>: View {
  var focused = false
  @ViewBuilder let content: () -> Content
  var body: some View {
    content()
      .padding(.horizontal, Space.s3)
      .frame(minHeight: 32)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCanvas))
      .overlay(
        RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
          .strokeBorder(focused ? Palette.focusBorder : Palette.hairlineStrong, lineWidth: focused ? 1.5 : 1)
      )
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
    Menu {
      ForEach(options, id: \.value) { option in
        Button {
          selection = option.value
        } label: {
          if option.value == selection { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
        }
      }
    } label: {
      ControlChrome {
        HStack(spacing: Space.s2) {
          if let selection, let option = options.first(where: { $0.value == selection }) {
            if let tone { Circle().fill(tone(selection).foreground).frame(width: 7, height: 7) }
            Text(option.label).foregroundStyle(Palette.ink)
          } else {
            Text(placeholder).foregroundStyle(Palette.inkMuted)
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        }
        .font(.ui(Typography.Size.body))
        .lineLimit(1)
      }
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityValue(selection.flatMap { value in options.first { $0.value == value }?.label } ?? placeholder)
  }
}

/// A date that may stay unset. Unset reads "Not set" and a click opens a calendar; a set date can be typed,
/// picked, or cleared.
struct OptionalDateField: View {
  @Binding var value: String?
  let label: String
  /// Seeds the calendar when the date is unset, usually account today.
  let suggested: String
  @State private var open = false

  private static let utc = TimeZone(identifier: "UTC")!

  private var dateBinding: Binding<Date> {
    Binding(
      get: { value.flatMap(JobDates.date) ?? JobDates.date(suggested) ?? Date() },
      set: { value = JobDates.string($0) }
    )
  }

  var body: some View {
    ControlChrome(focused: open) {
      HStack(spacing: Space.s2) {
        Button { open.toggle() } label: {
          HStack(spacing: Space.s2) {
            Image(systemName: "calendar").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
            Text(value.map(JobDates.long) ?? "Not set")
              .font(.ui(Typography.Size.body))
              .foregroundStyle(value == nil ? Palette.inkMuted : Palette.ink)
              .tabular()
            Spacer(minLength: 0)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
          VStack(alignment: .leading, spacing: Space.s2) {
            DatePicker(label, selection: dateBinding, displayedComponents: .date)
              .datePickerStyle(.graphical)
              .labelsHidden()
              .calendarFocusRingHidden()
              .environment(\.timeZone, Self.utc)
            HStack {
              Button("Today") { value = suggested; open = false }.buttonStyle(.manor(.ghost, size: .small))
              Spacer()
              if value != nil {
                Button("Clear") { value = nil; open = false }.buttonStyle(.manor(.ghost, size: .small))
              }
              Button("Done") { if value == nil { value = JobDates.string(dateBinding.wrappedValue) }; open = false }
                .buttonStyle(.manor(.secondary, size: .small))
                .keyboardShortcut(.defaultAction)
            }
          }
          .padding(Space.s3)
          .frame(width: 260)
        }
        if value != nil {
          Button { value = nil } label: {
            Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.inkMuted)
          }
          .buttonStyle(.plain)
          .help("Clear \(label.lowercased())")
          .accessibilityLabel("Clear \(label.lowercased())")
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
    .accessibilityValue(value.map(JobDates.long) ?? "Not set")
  }
}
