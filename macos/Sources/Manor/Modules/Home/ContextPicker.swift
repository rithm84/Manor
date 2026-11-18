import ManorKit
import SwiftUI

/// The Context property: a popover to search, pick, create, edit (name, icon, color), and remove contexts.
/// Removal is refused while tasks reference the context; the refusal shows inline.
struct TaskContextPicker: View {
  @Environment(HomeModel.self) private var model
  let value: String?
  var placeholder = "Empty"
  let onChange: (String) -> Void
  /// Called after a context is removed, so a draft that selected it can let go.
  var onRemoved: (String) -> Void = { _ in }
  /// Called after a rename, with the old and new names.
  var onRenamed: (String, String) -> Void = { _, _ in }

  @State private var open = false
  @State private var hovering = false
  @FocusState private var triggerFocused: Bool

  var body: some View {
    Button { open.toggle() } label: {
      HStack(spacing: Space.s1) {
        if let value {
          HomeContextPill(name: value, contexts: model.store.contexts)
        } else {
          HomeEmptyValue(text: placeholder)
        }
        Spacer(minLength: Space.s1)
        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.inkMuted)
      }
      .padding(.horizontal, Space.s2)
      .frame(height: 30)
      .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(hovering || open ? Palette.surfaceHover : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .focused($triggerFocused)
    .onHover { hovering = $0 }
    .onChange(of: open) { _, isOpen in
      guard !isOpen else { return }
      // Focus returns to this control, not to the title field the dialog focused first (which would select all
      // of its text). Without keyboard navigation a plain button cannot hold focus, so nothing keeps it.
      DispatchQueue.main.async {
        triggerFocused = true
        if let window = NSApp.keyWindow, window.firstResponder is NSTextView { window.makeFirstResponder(nil) }
      }
    }
    .accessibilityLabel(value.map { "Context: \($0)" } ?? "Context")
    .popover(isPresented: $open, arrowEdge: .bottom) {
      TaskContextMenuPanel(value: value, onPick: { name in
        onChange(name)
        open = false
      }, onRemoved: onRemoved, onRenamed: onRenamed)
      .environment(model)
    }
  }
}

private struct TaskContextMenuPanel: View {
  @Environment(HomeModel.self) private var model
  let value: String?
  let onPick: (String) -> Void
  let onRemoved: (String) -> Void
  let onRenamed: (String, String) -> Void

  private enum Sheet { case icon, color }

  @State private var query = ""
  @State private var name = ""
  @State private var color: ContextColor = .plum
  @State private var icon: ContextIcon = .target
  @State private var editing: TaskContext?
  @State private var sheet: Sheet?
  @State private var busy = false
  @State private var error: String?
  @State private var confirmingRemoval: TaskContext?
  @FocusState private var searchFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      switch sheet {
      case .icon: iconGrid
      case .color: colorList
      case nil: list
      }
      Hairline()
      composer
      if let error {
        Text(error).font(.ui(Typography.Size.xs)).foregroundStyle(Palette.overdueError)
          .padding(.horizontal, Space.s3).padding(.bottom, Space.s3)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(width: 300)
    .onAppear { searchFocused = true }
  }

  private var matches: [TaskContext] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return model.store.contexts.filter { needle.isEmpty || $0.name.lowercased().contains(needle) }
  }

  private var list: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      SearchField(text: $query, prompt: "Search contexts").focused($searchFocused)
      ScrollView {
        VStack(alignment: .leading, spacing: 1) {
          ForEach(matches) { context in
            if confirmingRemoval?.id == context.id {
              HStack(spacing: Space.s2) {
                Text("Remove \(context.name)?").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(1)
                Spacer()
                Button("Cancel") { confirmingRemoval = nil }.buttonStyle(.manor(.ghost, size: .small))
                Button("Remove") { remove(context) }.buttonStyle(.manor(.danger, size: .small)).disabled(busy)
              }
              .padding(.horizontal, Space.s2)
              .frame(height: 32)
            } else {
              TaskContextRow(context: context, selected: context.name == value, pick: { onPick(context.name) }, edit: { beginEdit(context) }, remove: {
                error = nil
                confirmingRemoval = context
              })
            }
          }
          if matches.isEmpty {
            Text(model.store.contexts.isEmpty ? "No contexts yet. Create one below." : "No matching contexts")
              .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).padding(Space.s2)
          }
        }
      }
      .frame(maxHeight: 220)
      .scrollBounceBehavior(.basedOnSize)
    }
    .padding(Space.s2)
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack {
        Text(editing.map { "Edit \($0.name)" } ?? "Create context").font(.ui(Typography.Size.xs, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        Spacer()
        if editing != nil { IconButton("xmark", label: "Stop editing", size: 20) { resetComposer() } }
      }
      HStack(spacing: Space.s1) {
        TextField("Context name", text: $name)
          .textFieldStyle(.manor)
          .onSubmit { save() }
          .onChange(of: name) { _, value in
            if value.count > 48 { name = String(value.prefix(48)) }
            error = nil
          }
        Button { sheet = sheet == .icon ? nil : .icon } label: {
          Image(systemName: icon.systemImage).font(.system(size: 13, weight: .medium)).foregroundStyle(HomeTone(color).foreground)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(sheet == .icon ? Palette.surfaceSelected : Palette.surfaceSoft))
        }
        .buttonStyle(.plain).help("Icon: \(icon.label)").accessibilityLabel("Context icon, \(icon.label)")
        Button { sheet = sheet == .color ? nil : .color } label: {
          RoundedRectangle(cornerRadius: 4, style: .continuous).fill(HomeTone(color).foreground).frame(width: 14, height: 14)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).fill(sheet == .color ? Palette.surfaceSelected : Palette.surfaceSoft))
        }
        .buttonStyle(.plain).help("Color: \(color.label)").accessibilityLabel("Context color, \(color.label)")
        Button(editing == nil ? "Add" : "Save") { save() }
          .buttonStyle(.manor(.primary, size: .small))
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
      }
    }
    .padding(Space.s3)
  }

  private var iconGrid: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      sheetHeader("Choose icon")
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s3) {
          ForEach(ContextIcon.Category.allCases, id: \.self) { category in
            VStack(alignment: .leading, spacing: Space.s1) {
              Text(category.rawValue).font(.ui(Typography.Size.xs, weight: .medium)).foregroundStyle(Palette.inkMuted)
              LazyVGrid(columns: Array(repeating: GridItem(.fixed(36), spacing: Space.s1), count: 6), alignment: .leading, spacing: Space.s1) {
                ForEach(ContextIcon.allCases.filter { $0.category == category }, id: \.self) { option in
                  Button {
                    icon = option
                    sheet = nil
                  } label: {
                    Image(systemName: option.systemImage).font(.system(size: 14))
                      .foregroundStyle(icon == option ? HomeTone(color).foreground : Palette.inkBody)
                      .frame(width: 36, height: 32)
                      .background(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).fill(icon == option ? HomeTone(color).tint : Palette.surfaceSoft.opacity(0.0001)))
                      .overlay(RoundedRectangle(cornerRadius: Radius.chip, style: .continuous).strokeBorder(icon == option ? HomeTone(color).foreground.opacity(0.4) : .clear))
                  }
                  .buttonStyle(.plain)
                  .help(option.label)
                  .accessibilityLabel(option.label)
                  .accessibilityAddTraits(icon == option ? .isSelected : [])
                }
              }
            }
          }
        }
      }
      .frame(maxHeight: 260)
    }
    .padding(Space.s3)
  }

  private var colorList: some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      sheetHeader("Choose color")
      ForEach(ContextColor.allCases, id: \.self) { option in
        Button {
          color = option
          sheet = nil
        } label: {
          HStack(spacing: Space.s2) {
            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(HomeTone(option).foreground).frame(width: 14, height: 14)
            Text(option.label).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink)
            Spacer()
            if option == color { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.primary) }
          }
          .padding(.horizontal, Space.s2)
          .frame(height: 30)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .rowBackground(selected: option == color)
      }
    }
    .padding(Space.s3)
  }

  private func sheetHeader(_ title: String) -> some View {
    HStack {
      Button { sheet = nil } label: {
        Label("Back", systemImage: "chevron.left").font(.ui(Typography.Size.sm, weight: .medium))
      }
      .buttonStyle(.manor(.ghost, size: .small))
      Spacer()
      Text(title).font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.ink)
    }
  }

  private func beginEdit(_ context: TaskContext) {
    editing = context
    name = context.name
    color = context.color
    icon = context.icon
    sheet = nil
    error = nil
  }

  private func resetComposer() {
    editing = nil
    name = ""
    color = .plum
    icon = .target
    sheet = nil
  }

  private func save() {
    let draft = ContextDraft(name: name, color: color, icon: icon)
    guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        if let editing {
          let saved = try await model.store.updateContext(editing, to: draft)
          if editing.name != saved.name { onRenamed(editing.name, saved.name) }
          if editing.name == value { onPick(saved.name) }
          resetComposer()
        } else {
          let saved = try await model.store.addContext(draft)
          resetComposer()
          onPick(saved.name)
        }
      } catch {
        self.error = (editing == nil ? "Could not add context. " : "Could not save context. ") + error.localizedDescription
      }
    }
  }

  private func remove(_ context: TaskContext) {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        try await model.store.removeContext(context)
        confirmingRemoval = nil
        onRemoved(context.name)
      } catch {
        confirmingRemoval = nil
        self.error = "Could not remove \(context.name). \(error.localizedDescription)"
      }
    }
  }
}

private struct TaskContextRow: View {
  let context: TaskContext
  let selected: Bool
  let pick: () -> Void
  let edit: () -> Void
  let remove: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s1) {
      Button(action: pick) {
        HStack {
          HomePill(text: context.name, systemImage: context.icon.systemImage, tone: HomeTone(context.color))
          Spacer()
          if selected { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.primary) }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(selected ? .isSelected : [])
      IconButton("pencil", label: "Edit \(context.name)", size: 24, action: edit).opacity(hovering ? 1 : 0)
      IconButton("trash", label: "Remove \(context.name)", size: 24, action: remove).opacity(hovering ? 1 : 0)
    }
    .padding(.horizontal, Space.s2)
    .frame(height: 32)
    .rowBackground(selected: selected)
    .onHover { hovering = $0 }
  }
}
