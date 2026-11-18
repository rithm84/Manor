import ManorKit
import SwiftUI

/// Repeats: quick presets, or a custom rule with an interval, unit, exact weekdays, and an optional end date.
struct TaskRecurrenceEditor: View {
  let value: String?
  let today: String
  let onChange: (String?) -> Void

  @State private var custom = false
  @State private var rule = RecurrenceRule.customDefault
  @State private var everyText = "2"
  @FocusState private var intervalFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      HomeFlowLayout(spacing: Space.s1, lineSpacing: Space.s1) {
        ForEach(Recurrence.presets, id: \.label) { preset in
          chip(preset.label, active: !custom && value == preset.value) {
            custom = false
            onChange(preset.value)
          }
        }
        chip("Custom", active: custom) { openCustom() }
      }
      if custom {
        VStack(alignment: .leading, spacing: Space.s2) {
          HStack(spacing: Space.s2) {
            Text("Every").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).frame(width: 44, alignment: .leading)
            TextField("", text: $everyText)
              .textFieldStyle(.manor)
              .frame(width: 56)
              .tabular()
              .focused($intervalFocused)
              .onSubmit(commitInterval)
              .onChange(of: intervalFocused) { _, focused in if !focused { commitInterval() } }
              .accessibilityLabel("Repeat interval")
            Stepper("", value: Binding(get: { rule.every }, set: { apply(every: $0) }), in: RecurrenceRule.intervalRange)
              .labelsHidden()
            HomePropertyMenu(accessibilityLabel: "Repeat unit") {
              ForEach(RecurrenceUnit.allCases, id: \.self) { unit in
                Button(unit.pluralLabel) {
                  var next = rule
                  next.unit = unit
                  apply(next)
                }
              }
            } label: {
              Text(rule.unit.pluralLabel).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink)
            }
            .fixedSize()
          }
          if rule.unit == .week {
            HStack(spacing: Space.s2) {
              Text("On").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).frame(width: 44, alignment: .leading)
              HStack(spacing: 3) {
                ForEach(RecurrenceWeekday.allCases, id: \.self) { day in
                  let on = rule.weekdays.contains(day)
                  Button { toggle(day) } label: {
                    Text(String(day.short.prefix(2)))
                      .font(.ui(Typography.Size.xs, weight: on ? .semibold : .medium))
                      .foregroundStyle(on ? Palette.onPrimary : Palette.inkBody)
                      .frame(width: 28, height: 26)
                      .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(on ? Palette.primary : Palette.surfaceSoft))
                  }
                  .buttonStyle(.plain)
                  .accessibilityLabel(day.long)
                  .accessibilityAddTraits(on ? .isSelected : [])
                }
              }
              .animation(Motion.fast, value: rule.weekdays)
            }
          }
          HStack(spacing: Space.s2) {
            Text("Until").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).frame(width: 44, alignment: .leading)
            HomeDateField(date: rule.until, placeholder: "No end date", today: today, accessibilityLabel: "Repeat until") { until in
              var next = rule
              next.until = until
              apply(next)
            }
            if rule.until != nil {
              IconButton("xmark", label: "Remove end date", size: 22) {
                var next = rule
                next.until = nil
                apply(next)
              }
            }
          }
          Text((try? Recurrence.serialize(rule)).map(Recurrence.label) ?? "")
            .font(.ui(Typography.Size.sm, weight: .medium))
            .foregroundStyle(Palette.primary)
            .padding(.top, Space.s1)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .animation(Motion.base, value: custom)
    .onAppear {
      let presetValues = Recurrence.presets.map(\.value)
      custom = value != nil && !presetValues.contains(value)
      if custom, let value, let parsed = try? Recurrence.parse(value) {
        rule = parsed
        everyText = String(parsed.every)
      }
    }
  }

  private func chip(_ title: String, active: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.ui(Typography.Size.sm, weight: active ? .semibold : .medium))
        .foregroundStyle(active ? Palette.primary : Palette.inkBody)
        .padding(.horizontal, Space.s2 + 2)
        .frame(height: 26)
        .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(active ? Palette.primaryTint : Palette.surfaceSoft))
        .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(active ? Palette.primary.opacity(0.35) : .clear))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(active ? .isSelected : [])
  }

  /// Shows the saved custom rule rather than the default; nothing commits until something changes.
  private func openCustom() {
    let saved = value.flatMap { $0.hasPrefix("FREQ=") ? try? Recurrence.parse($0) : nil }
    rule = saved ?? .customDefault
    everyText = String(rule.every)
    custom = true
  }

  private func apply(_ next: RecurrenceRule) {
    rule = next
    everyText = String(next.every)
    if let serialized = try? Recurrence.serialize(next) { onChange(serialized) }
  }

  private func apply(every: Int) {
    var next = rule
    next.every = every
    apply(next)
  }

  private func commitInterval() {
    let parsed = Int(everyText.trimmingCharacters(in: .whitespaces)) ?? rule.every
    apply(every: min(RecurrenceRule.intervalRange.upperBound, max(RecurrenceRule.intervalRange.lowerBound, parsed == 0 ? rule.every : parsed)))
  }

  private func toggle(_ day: RecurrenceWeekday) {
    var next = rule
    if let index = next.weekdays.firstIndex(of: day) { next.weekdays.remove(at: index) } else { next.weekdays = (next.weekdays + [day]).sorted() }
    apply(next)
  }
}
