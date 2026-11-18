import ManorKit
import SwiftUI

/// Creating, renaming, and deleting a folder. Deleting moves its notes and folders up one level.
struct NoteFolderDialog: View {
  let store: NotesStore
  let folder: NoteFolder?
  let close: () -> Void
  @State private var name = ""
  @State private var confirmingDelete = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    if confirmingDelete, let folder {
      ConfirmPanel(title: "Delete this folder?", message: "Its notes and folders move up one level.", confirmLabel: "Delete folder",
                   onCancel: { confirmingDelete = false }) {
        Task {
          if let message = await store.deleteFolder(folder) { error = message; confirmingDelete = false } else { close() }
        }
      }
    } else {
      DialogPanel(folder == nil ? "New folder" : "Rename folder", onClose: close) {
        VStack(alignment: .leading, spacing: Space.s2) {
          Text("Folder name").font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody)
          TextField("Folder name", text: $name)
            .textFieldStyle(.manor)
            .onSubmit(submit)
            .onChange(of: name) { if name.count > NoteLimits.folderNameLength { name = String(name.prefix(NoteLimits.folderNameLength)) } }
          if let error { Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError) }
        }
      } footer: {
        if folder != nil {
          Button("Delete folder") { confirmingDelete = true }.buttonStyle(.manor(.ghost))
        }
        Spacer()
        Button("Cancel", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
        Button(folder == nil ? "Create" : "Save", action: submit)
          .buttonStyle(.primary)
          .keyboardShortcut(.defaultAction)
          .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      .onAppear { name = folder?.name ?? "" }
    }
  }

  private func submit() {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !busy else { return }
    busy = true
    Task {
      let failure: String?
      if let folder { failure = await store.renameFolder(folder, name: trimmed) } else { failure = await store.createFolder(name: trimmed) }
      busy = false
      if let failure { error = failure } else { close() }
    }
  }
}

/// Moving a note to another folder or under another page.
struct NoteMoveDialog: View {
  let store: NotesStore
  let page: NotePage
  let close: () -> Void
  @State private var folderId: String?
  @State private var parentPageId: String?
  @State private var busy = false
  @State private var error: String?

  /// Pages that can hold this one: active, in the chosen folder, and not the page itself or one of its subpages.
  private var parents: [NotePage] {
    let excluded = NotesModel.withDescendants([page.id], in: store.data.pages)
    return store.data.pages
      .filter { $0.status == .active && !excluded.contains($0.id) && $0.folderId == folderId }
      .sorted { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
  }

  var body: some View {
    DialogPanel("Move note", onClose: close) {
      VStack(alignment: .leading, spacing: Space.s4) {
        field("Folder") {
          Picker("Folder", selection: $folderId) {
            Text("Notes").tag(String?.none)
            ForEach(store.data.folders) { folder in Text(folder.name).tag(Optional(folder.id)) }
          }
          .onChange(of: folderId) { parentPageId = nil }
        }
        field("Parent page") {
          Picker("Parent page", selection: $parentPageId) {
            Text("No parent page").tag(String?.none)
            ForEach(parents) { candidate in Text(candidate.displayTitle).tag(Optional(candidate.id)) }
          }
        }
        if let error { Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError) }
      }
    } footer: {
      Button("Cancel", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      Button("Move") {
        busy = true
        Task {
          let failure = await store.move(page, folderId: folderId, parentPageId: parentPageId)
          busy = false
          if let failure { error = failure } else { close() }
        }
      }
      .buttonStyle(.primary)
      .keyboardShortcut(.defaultAction)
      .disabled(busy || (folderId == page.folderId && parentPageId == page.parentPageId))
    }
    .onAppear {
      folderId = page.folderId
      parentPageId = page.parentPageId
    }
  }

  private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      Text(label).font(.ui(Typography.Size.sm, weight: .medium)).foregroundStyle(Palette.inkBody)
      content().labelsHidden().pickerStyle(.menu).frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// Chooses the note that receives blocks moved out of the open note.
struct NoteMoveBlocksDialog: View {
  let store: NotesStore
  let page: NotePage
  let blockIds: [String]
  let close: () -> Void
  @State private var query = ""
  @State private var targetId: String?
  @State private var busy = false
  @State private var error: String?

  private var candidates: [NotePage] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return store.data.pages
      .filter { $0.status == .active && $0.id != page.id && (needle.isEmpty || $0.displayTitle.lowercased().contains(needle)) }
      .sorted { $0.updatedAt > $1.updatedAt }
  }

  var body: some View {
    DialogPanel(blockIds.count == 1 ? "Move block to" : "Move \(blockIds.count) blocks to", onClose: close) {
      VStack(alignment: .leading, spacing: Space.s3) {
        SearchField(text: $query, prompt: "Find a note")
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(candidates.prefix(200)) { candidate in
            Button { targetId = candidate.id } label: {
              HStack(spacing: Space.s2) {
                Image(systemName: "doc.text").foregroundStyle(Palette.inkMuted)
                Text(candidate.displayTitle).font(.ui(Typography.Size.body)).foregroundStyle(Palette.ink).lineLimit(1)
                Spacer(minLength: 0)
              }
              .padding(.horizontal, Space.s2)
              .frame(height: 30)
              .contentShape(Rectangle())
              .rowBackground(selected: targetId == candidate.id)
            }
            .buttonStyle(.plain)
          }
        }
        if candidates.isEmpty {
          Text("No other notes match.").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted)
        }
        if let error { Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError) }
      }
    } footer: {
      Button("Cancel", action: close).buttonStyle(.secondary).keyboardShortcut(.cancelAction)
      Button("Move") {
        guard let targetId else { return }
        busy = true
        Task {
          let failure = await store.moveBlocks(blockIds, from: page, to: targetId)
          busy = false
          if let failure { error = failure } else { close() }
        }
      }
      .buttonStyle(.primary)
      .keyboardShortcut(.defaultAction)
      .disabled(busy || targetId == nil)
    }
  }
}

/// Permanent deletion asks once; the count and the loss are stated plainly.
struct NotePurgeDialog: View {
  let store: NotesStore
  let ids: [String]

  var body: some View {
    ConfirmPanel(
      title: ids.count == 1 ? "Delete this note permanently?" : "Delete \(ids.count) notes permanently?",
      message: ids.count == 1
        ? "The note, its subpages, versions, and attachments are removed now. There is no way to get them back."
        : "These notes, their subpages, versions, and attachments are removed now. There is no way to get them back.",
      confirmLabel: "Delete permanently",
      onCancel: { store.purgeRequest = nil },
      onConfirm: { Task { await store.purge(ids) } }
    )
  }
}
