import ManorKit
import SwiftUI

/// Find in note (Command-F): a query field with the match count and next and previous. Matches never change the
/// document. Return walks forward, Shift-Return back, Escape closes.
struct NoteFindBar: View {
  @Bindable var store: NotesStore
  let blocks: [JSONValue]
  @FocusState private var focused: Bool

  private var matches: [NoteFindMatch] {
    store.findQuery.isEmpty ? [] : NoteFind.matches(of: store.findQuery, in: NoteDocumentCoding.blocks(from: blocks))
  }

  var body: some View {
    let count = matches.count
    HStack(spacing: Space.s2) {
      Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.inkMuted)
      TextField("Find in note", text: $store.findQuery)
        .textFieldStyle(.plain)
        .font(.ui(Typography.Size.body))
        .focused($focused)
        .onSubmit { step(NSApp.currentEvent?.modifierFlags.contains(.shift) == true ? -1 : 1, count: count) }
        .onExitCommand { store.findOpen = false }
        .onChange(of: store.findQuery) { store.findIndex = 0 }
      Text(store.findQuery.isEmpty ? "" : count == 0 ? "No matches" : "\(min(store.findIndex, count - 1) + 1) of \(count)")
        .font(.ui(Typography.Size.xs))
        .foregroundStyle(Palette.inkMuted)
        .tabular()
      IconButton("chevron.up", label: "Previous match", size: 24) { step(-1, count: count) }.disabled(count == 0)
      IconButton("chevron.down", label: "Next match", size: 24) { step(1, count: count) }.disabled(count == 0)
      IconButton("xmark", label: "Close find", size: 24) { store.findOpen = false }
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 36)
    .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(Palette.surfaceSoft))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Palette.hairline))
    .onAppear { focused = true }
  }

  private func step(_ delta: Int, count: Int) {
    guard count > 0 else { return }
    store.findIndex = (store.findIndex + delta + count) % count
  }
}
