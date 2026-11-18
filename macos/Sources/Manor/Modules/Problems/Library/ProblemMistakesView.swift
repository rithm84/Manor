import ManorKit
import SwiftUI

/// Quick notes about mistakes and recurring patterns. Return saves, Shift-Return breaks a line, and clicking a
/// note edits it in place.
struct ProblemMistakesView: View {
  let store: ProblemLibraryStore
  let timeZone: TimeZone
  @Environment(AppContext.self) private var context
  @State private var draft = ""
  @State private var saving = false
  @State private var error: String?
  @State private var editingId: String?
  @State private var editText = ""
  @FocusState private var composerFocused: Bool
  @FocusState private var editorFocused: Bool

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Space.s4) {
        composer
        if let error { ErrorBanner(error) }
        if store.mistakes.isEmpty {
          Text("What tripped you up today goes here.")
            .font(.ui(Typography.Size.body)).foregroundStyle(Palette.inkMuted)
            .padding(.top, Space.s2)
        } else {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(store.mistakes) { note in
              row(note)
              Hairline()
            }
          }
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .frame(maxWidth: .infinity)
      .padding(.horizontal, Space.s8)
      .padding(.vertical, Space.s6)
    }
  }

  private var composer: some View {
    VStack(alignment: .trailing, spacing: Space.s1) {
      noteField("Jot a mistake or pattern", text: $draft, focus: $composerFocused) { add() }
      if draft.unicodeScalars.count > ProblemMistake.maxLength - 200 {
        Text("\(draft.unicodeScalars.count.formatted()) / 2,000")
          .font(.ui(Typography.Size.xs))
          .foregroundStyle(draft.unicodeScalars.count > ProblemMistake.maxLength ? Palette.overdueError : Palette.inkMuted)
          .tabular()
      }
    }
  }

  private func noteField(_ prompt: String, text: Binding<String>, focus: FocusState<Bool>.Binding, submit: @escaping () -> Void) -> some View {
    TextField(prompt, text: text, axis: .vertical)
      .textFieldStyle(.plain)
      .font(.ui(Typography.Size.body))
      .foregroundStyle(Palette.ink)
      .lineLimit(1...12)
      .focused(focus)
      .onKeyPress(.return, phases: .down) { press in
        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) {
          text.wrappedValue += "\n"
          return .handled
        }
        submit()
        return .handled
      }
      .padding(.horizontal, Space.s3)
      .padding(.vertical, Space.s2)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceCanvas))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
        .strokeBorder(focus.wrappedValue ? Palette.focusBorder : Palette.hairlineStrong, lineWidth: focus.wrappedValue ? 1.5 : 1))
      .accessibilityLabel(prompt)
  }

  @ViewBuilder
  private func row(_ note: ProblemMistake) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
      if editingId == note.id {
        noteField("Edit note", text: $editText, focus: $editorFocused) { saveEdit(note) }
          .onExitCommand { editingId = nil }
          .onChange(of: editorFocused) { _, focused in if !focused && editingId == note.id { saveEdit(note) } }
      } else {
        Text(note.text)
          .font(.ui(Typography.Size.body))
          .foregroundStyle(Palette.inkBody)
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
          .contentShape(Rectangle())
          .onTapGesture {
            editingId = note.id
            editText = note.text
            DispatchQueue.main.async { editorFocused = true }
          }
          .accessibilityAddTraits(.isButton)
          .accessibilityHint("Edit note")
      }
      MistakeMeta(date: dateLabel(note.createdAt), disabled: saving) { delete(note) }
    }
    .padding(.vertical, Space.s3)
    .contextMenu {
      Button("Edit") {
        editingId = note.id
        editText = note.text
        DispatchQueue.main.async { editorFocused = true }
      }
      Button("Copy") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(note.text, forType: .string)
      }
      Divider()
      Button("Delete", role: .destructive) { delete(note) }
    }
  }

  private func dateLabel(_ timestamp: String) -> String {
    guard let date = ProblemSourceDate.instant(timestamp) else { return "" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = timeZone
    formatter.setLocalizedDateFormatFromTemplate("MMMd")
    return formatter.string(from: date)
  }

  private func add() {
    guard !saving, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    let text = draft
    saving = true
    error = nil
    Task {
      do {
        try await store.addMistake(text)
        draft = ""
      } catch {
        self.error = "Could not save the note. \(error.localizedDescription)"
      }
      saving = false
    }
  }

  private func saveEdit(_ note: ProblemMistake) {
    let text = editText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard editingId == note.id else { return }
    if text.isEmpty || text == note.text {
      editingId = nil
      return
    }
    guard !saving else { return }
    saving = true
    error = nil
    Task {
      do {
        try await store.updateMistake(note, text: text)
        editingId = nil
      } catch {
        self.error = "Could not update the note. \(error.localizedDescription)"
      }
      saving = false
    }
  }

  private func delete(_ note: ProblemMistake) {
    guard !saving else { return }
    saving = true
    error = nil
    Task {
      do {
        try await store.deleteMistake(note)
        context.toasts.show("Note deleted", actionLabel: "Undo") {
          Task { try? await store.addMistake(note.text) }
        }
      } catch {
        self.error = "Could not delete the note. \(error.localizedDescription)"
      }
      saving = false
    }
  }
}

/// A note's date and its delete action, which appears on hover.
private struct MistakeMeta: View {
  let date: String
  let disabled: Bool
  let delete: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s1) {
      Text(date).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular().frame(minWidth: 48, alignment: .trailing)
      IconButton("trash", label: "Delete note", size: 24, action: delete)
        .opacity(hovering ? 1 : 0.35)
        .disabled(disabled)
    }
    .onHover { hovering = $0 }
  }
}
