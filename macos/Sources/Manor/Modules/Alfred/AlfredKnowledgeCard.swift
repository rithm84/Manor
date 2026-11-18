import Alfred
import SwiftUI
import UniformTypeIdentifiers

/// Personal context: résumé, stories, job descriptions, and notes that shape every answer. Compact rows; a row
/// opens its document in a centered dialog. Files can be imported or dropped onto the card.
struct AlfredKnowledgeCard: View {
  @ObservedObject private var knowledge = AlfredHost.shared.knowledge
  @Binding var editing: KnowledgeDoc?
  @State private var importing = false
  @State private var dropTargeted = false
  @State private var importError: String?

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(alignment: .firstTextBaseline) {
        Text("Personal context").font(.ui(Typography.Size.sm, weight: .semibold)).foregroundStyle(Palette.inkMuted)
        Spacer()
        if !knowledge.docs.isEmpty { budget }
      }
      .padding(.leading, Space.s1)
      VStack(spacing: 0) {
        if knowledge.docs.isEmpty {
          empty
        } else {
          ForEach(Array(knowledge.docs.enumerated()), id: \.element.id) { index, doc in
            if index > 0 { Hairline() }
            AlfredDocumentRow(doc: doc, open: { editing = doc }, toggle: {
              var updated = doc
              updated.enabled.toggle()
              knowledge.update(updated)
            }, remove: { knowledge.remove([doc.id]) })
          }
          Hairline()
          HStack(spacing: Space.s2) {
            Button("Import Files…") { importing = true }.buttonStyle(.manor(.ghost, size: .small))
            Button("New Note") { newNote() }.buttonStyle(.manor(.ghost, size: .small))
            Spacer()
          }
          .padding(.vertical, Space.s2)
        }
      }
      .padding(.horizontal, Space.s4)
      .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Palette.surfaceCard))
      .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        .strokeBorder(dropTargeted ? Palette.primary : Palette.hairline, lineWidth: dropTargeted ? 2 : 1))
      .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
        load(providers)
        return true
      }
      if let importError { SettingsNotice(text: importError, failed: true) { self.importError = nil } }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: DocumentText.importable, allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { importFiles(urls) }
    }
    .animation(Motion.fast, value: dropTargeted)
  }

  private var empty: some View {
    VStack(spacing: Space.s3) {
      Image(systemName: "doc.badge.plus").font(.system(size: 26, weight: .light)).foregroundStyle(Palette.inkMuted)
        .accessibilityHidden(true)
      Text("Add your résumé and notes").font(.display(Typography.Size.emphasis)).foregroundStyle(Palette.ink)
      Text("Drop PDF, Word, Markdown, or text files here. Alfred answers from your real experience.")
        .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).multilineTextAlignment(.center)
      HStack(spacing: Space.s2) {
        Button("Import Files…") { importing = true }.buttonStyle(.manor(.secondary, size: .small))
        Button("New Note") { newNote() }.buttonStyle(.manor(.ghost, size: .small))
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, Space.s6)
  }

  private var budget: some View {
    let used = knowledge.enabledCharacters
    let limit = KnowledgeStore.budget
    let over = used > limit
    return HStack(spacing: Space.s2) {
      ProgressView(value: min(1, Double(used) / Double(limit)))
        .progressViewStyle(.linear).tint(over ? Palette.warning : Palette.primary).frame(width: 64)
      Text("\(used.formatted(.number.notation(.compactName))) of \(limit.formatted(.number.notation(.compactName)))")
        .font(.ui(Typography.Size.xs)).foregroundStyle(over ? Palette.warning : Palette.inkMuted).tabular()
    }
    .help(over ? "Answers use the first \(limit.formatted()) characters. Turn off or shorten a document."
               : "Characters of personal context in every answer")
    .accessibilityElement(children: .combine)
  }

  private func newNote() {
    let doc = KnowledgeDoc(title: "Untitled note", kind: .notes, text: "")
    knowledge.add(doc)
    editing = doc
  }

  private func importFiles(_ urls: [URL]) {
    let failed = knowledge.importFiles(urls)
    importError = failed.isEmpty ? nil : "Alfred couldn't read \(failed.formatted(.list(type: .and)))."
  }

  private func load(_ providers: [NSItemProvider]) {
    for provider in providers {
      _ = provider.loadObject(ofClass: URL.self) { url, _ in
        guard let url else { return }
        DispatchQueue.main.async { importFiles([url]) }
      }
    }
  }
}

/// One document: kind icon, title, kind and size, and an include switch.
private struct AlfredDocumentRow: View {
  let doc: KnowledgeDoc
  let open: () -> Void
  let toggle: () -> Void
  let remove: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack(spacing: Space.s3) {
      Button(action: open) {
        HStack(spacing: Space.s3) {
          Image(systemName: doc.kind.icon)
            .font(.system(size: 14))
            .foregroundStyle(doc.enabled ? Palette.primary : Palette.inkMuted)
            .frame(width: 20)
          VStack(alignment: .leading, spacing: 1) {
            Text(doc.title.isEmpty ? "Untitled" : doc.title)
              .font(.ui(Typography.Size.body, weight: .medium))
              .foregroundStyle(doc.enabled ? Palette.ink : Palette.inkMuted)
              .lineLimit(1)
            Text("\(doc.kind.title) · \(doc.text.count.formatted()) characters")
              .font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Toggle("Use in answers", isOn: Binding(get: { doc.enabled }, set: { _ in toggle() }))
        .toggleStyle(.switch).labelsHidden().controlSize(.small).tint(Palette.primary)
        .help(doc.enabled ? "Used in answers" : "Not used in answers")
    }
    .padding(.vertical, Space.s2 + 2)
    .contextMenu {
      Button("Open") { open() }
      Button(doc.enabled ? "Stop Using in Answers" : "Use in Answers") { toggle() }
      Divider()
      Button("Delete", role: .destructive) { remove() }
    }
    .accessibilityElement(children: .contain)
  }
}

/// Edits one document in a centered dialog; changes save as you type.
struct AlfredDocumentDialog: View {
  @ObservedObject private var knowledge = AlfredHost.shared.knowledge
  @State private var draft: KnowledgeDoc
  @State private var confirmDelete = false
  @State private var saveTask: Task<Void, Never>?
  let close: () -> Void

  init(doc: KnowledgeDoc, close: @escaping () -> Void) {
    _draft = State(initialValue: doc)
    self.close = close
  }

  var body: some View {
    DialogPanel(draft.title.isEmpty ? "Untitled" : draft.title, onClose: finish) {
      VStack(alignment: .leading, spacing: Space.s3) {
        TextField("Title", text: $draft.title).textFieldStyle(.manor)
        HStack(spacing: Space.s3) {
          Picker("Kind", selection: $draft.kind) {
            ForEach(KnowledgeDoc.Kind.allCases) { Label($0.title, systemImage: $0.icon).tag($0) }
          }
          .labelsHidden().fixedSize()
          Toggle("Use in answers", isOn: $draft.enabled).toggleStyle(.switch).controlSize(.small).tint(Palette.primary)
          Spacer()
          Text("\(draft.text.count.formatted()) characters").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).tabular()
        }
        AlfredTextArea(text: $draft.text, placeholder: "Paste or write anything Alfred should know.", minHeight: 320)
      }
    } footer: {
      if confirmDelete {
        Text("Delete this document?").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkBody)
        Button("Cancel") { confirmDelete = false }.buttonStyle(.manor(.ghost, size: .small))
        Button("Delete") {
          saveTask?.cancel()
          knowledge.remove([draft.id])
          close()
        }
        .buttonStyle(.manor(.danger, size: .small))
      } else {
        Button("Delete") { confirmDelete = true }.buttonStyle(.manor(.ghost, size: .small))
        Spacer()
        Button("Done", action: finish).buttonStyle(.manor(.primary, size: .small)).keyboardShortcut(.defaultAction)
      }
    }
    .onChange(of: draft) { _, new in
      saveTask?.cancel()
      saveTask = Task {
        try? await Task.sleep(for: .milliseconds(400))
        if !Task.isCancelled { knowledge.update(new) }
      }
    }
  }

  private func finish() {
    saveTask?.cancel()
    knowledge.update(draft)
    close()
  }
}
