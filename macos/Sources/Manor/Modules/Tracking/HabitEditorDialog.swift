import ManorKit
import Observation
import SwiftUI

/// The fields of the New habit and Edit habit dialog. The page holds it so a backdrop click or Escape can
/// ask before discarding typed fields.
@MainActor
@Observable
final class HabitEditorModel: Identifiable {
  let id = UUID()
  /// The habit being edited; nil when creating one.
  let habitId: String?
  let baseline: HabitDraft
  var name: String
  var kind: HabitKind
  var targetLabel: String
  var saving = false
  var error: String?
  var confirmDiscard = false

  init(habit: HabitDefinition?) {
    habitId = habit?.id
    baseline = habit.map(HabitDraft.init(habit:)) ?? HabitDraft(name: "", kind: .binary, targetLabel: nil)
    name = baseline.name
    kind = baseline.kind
    targetLabel = baseline.targetLabel ?? ""
  }

  var isEditing: Bool { habitId != nil }
  var isValid: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (kind == .binary || !targetLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
  }
  var isDirty: Bool { name != baseline.name || kind != baseline.kind || targetLabel != (baseline.targetLabel ?? "") }
  var changingToBinary: Bool { baseline.kind == .quantized && kind == .binary }

  var draft: HabitDraft {
    HabitDraft(
      expectedRevision: baseline.expectedRevision, name: name.trimmingCharacters(in: .whitespacesAndNewlines), kind: kind,
      targetLabel: kind == .quantized ? targetLabel.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    )
  }
}

struct HabitEditorPanel: View {
  @Bindable var model: HabitEditorModel
  let onClose: () -> Void
  let onSave: () -> Void
  @FocusState private var nameFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      HStack {
        Text(model.isEditing ? "Edit habit" : "New habit").font(.dialogTitle).foregroundStyle(Palette.ink)
        Spacer()
        IconButton("xmark", label: "Close", action: onClose).disabled(model.saving)
      }

      field("Name") {
        TextField("Stretch 10 minutes", text: $model.name)
          .textFieldStyle(.manor)
          .focused($nameFocused)
          .onSubmit(onSave)
          .accessibilityLabel("Habit name")
      }

      field("How you log it") {
        HStack(spacing: Space.s2) {
          KindCard(title: "One tap", detail: "Complete or incomplete", systemImage: "checkmark", selected: model.kind == .binary) { model.kind = .binary }
          KindCard(title: "By amount", detail: "Partial progress counts", systemImage: "gauge.with.dots.needle.33percent", selected: model.kind == .quantized) { model.kind = .quantized }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("How you log it")
      }

      if model.kind == .quantized {
        field("Daily target") {
          TextField("3 tablets, 48 oz, 25 pages", text: $model.targetLabel)
            .textFieldStyle(.manor)
            .onSubmit(onSave)
            .accessibilityLabel("Daily target")
          let target = model.targetLabel.trimmingCharacters(in: .whitespacesAndNewlines)
          if !target.isEmpty {
            Text(HabitRules.stepsHint(target)).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
          }
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      }

      if model.changingToBinary {
        Text("Past entries keep their recorded percentages. From today, this habit becomes one tap.")
          .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.frozenInfo)
          .fixedSize(horizontal: false, vertical: true)
          .padding(Space.s3)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.frozenInfoTint))
      }

      if let error = model.error {
        Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, Space.s3).padding(.vertical, Space.s2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.overdueErrorTint))
      }

      HStack(spacing: Space.s2) {
        Spacer()
        Button("Cancel", action: onClose).buttonStyle(.ghost).disabled(model.saving)
        Button(model.isEditing ? "Save changes" : "Add habit", action: onSave)
          .buttonStyle(.primary)
          .keyboardShortcut(.defaultAction)
          .disabled(!model.isValid || model.saving)
      }
      .padding(.top, Space.s1)
    }
    .padding(.horizontal, Space.s6)
    .padding(.vertical, Space.s5)
    .animation(Motion.base, value: model.kind)
    .onAppear { nameFocused = true }
  }

  private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkMuted)
      content()
    }
  }
}

/// One of the two ways a habit logs, as a selectable card.
private struct KindCard: View {
  let title: String
  let detail: String
  let systemImage: String
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 3) {
        Image(systemName: systemImage).font(.system(size: 14, weight: .medium))
          .foregroundStyle(selected ? Palette.primaryActive : Palette.inkMuted)
          .frame(height: 18)
        Text(title).font(.ui(Typography.Size.body, weight: .semibold)).foregroundStyle(Palette.ink)
        Text(detail).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(Space.s3)
      .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(selected ? Palette.primaryTint : (hovering ? Palette.surfacePaper : Palette.surfaceCard)))
      .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(selected ? Palette.primary : Palette.hairline, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
    .buttonStyle(HabitPressStyle(scale: 0.98))
    .onHover { hovering = $0 }
    .animation(Motion.fast, value: selected)
    .animation(Motion.fast, value: hovering)
    .accessibilityAddTraits(selected ? [.isSelected] : [])
  }
}
