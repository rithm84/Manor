import ManorKit
import SwiftUI

/// The one control that chooses what the note list shows: the fixed views and the folders, with counts.
/// Folders are created and renamed here as well.
struct NotesScopeMenu: View {
  let store: NotesStore
  let close: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      ForEach(NotesScope.views, id: \.self) { scope in
        row(scope, label: scope.label, symbol: NotesListPane.symbol(for: scope), count: store.counts.count(for: scope))
      }
      Hairline().padding(.vertical, Space.s1)
      Text("Folders")
        .font(.ui(Typography.Size.xs, weight: .semibold))
        .foregroundStyle(Palette.inkMuted)
        .padding(.horizontal, Space.s2)
        .padding(.vertical, 2)
      if store.data.folders.isEmpty {
        Text("No folders yet.").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).padding(.horizontal, Space.s2).padding(.vertical, 4)
      }
      ScrollView {
        VStack(spacing: 1) {
          ForEach(store.data.folders) { folder in
            HStack(spacing: 0) {
              row(.folder(folder.id), label: folder.name, symbol: "folder", count: store.counts.count(for: .folder(folder.id)))
              IconButton("pencil", label: "Rename \(folder.name)", size: 26) {
                close()
                store.dialog = .renameFolder(folder)
              }
            }
          }
        }
      }
      .frame(maxHeight: 280)
      .scrollBounceBehavior(.basedOnSize)
      Button {
        close()
        store.dialog = .newFolder
      } label: {
        HStack(spacing: Space.s2) {
          Image(systemName: "folder.badge.plus").frame(width: 18)
          Text("New folder")
          Spacer()
        }
        .font(.ui(Typography.Size.sm))
        .foregroundStyle(Palette.inkBody)
        .padding(.horizontal, Space.s2)
        .frame(height: 30)
        .contentShape(Rectangle())
      }
      .buttonStyle(NotesHoverButtonStyle())
    }
    .padding(5)
    .frame(width: 252)
  }

  private func row(_ scope: NotesScope, label: String, symbol: String, count: Int?) -> some View {
    let selected = store.scope == scope
    return Button {
      close()
      Task { await store.selectScope(scope) }
    } label: {
      HStack(spacing: Space.s2) {
        Image(systemName: symbol).frame(width: 18).foregroundStyle(selected ? Palette.ink : Palette.inkMuted)
        Text(label).lineLimit(1)
        Spacer(minLength: Space.s2)
        if let count, count > 0 || scope.folderId != nil {
          Text("\(count)").font(.ui(Typography.Size.xs)).foregroundStyle(Palette.inkMuted).tabular()
        }
      }
      .font(.ui(Typography.Size.sm, weight: selected ? .semibold : .regular))
      .foregroundStyle(selected ? Palette.ink : Palette.inkBody)
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(selected ? Palette.surfaceSelected : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(NotesHoverButtonStyle())
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
