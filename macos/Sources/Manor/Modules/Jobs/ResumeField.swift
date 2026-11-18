import AppKit
import ManorKit
import SwiftUI
import UniformTypeIdentifiers

/// The resume version a role was sent with: pick a version, upload a new PDF (named by its file), open the
/// selected PDF, or remove a version no application records.
struct ResumeField: View {
  @Binding var selection: String?
  let store: JobsStore
  let openExternal: (URL) -> Void

  @State private var upload: (id: UUID, name: String)?
  @State private var fraction: Double = 0
  @State private var uploadError: String?
  @State private var confirmingRemoval = false
  @State private var removing = false
  @State private var opening = false

  private var selected: ResumeVersion? { selection.flatMap { id in store.resumes.first { $0.id == id } } }

  private var options: [(value: String, label: String)] {
    var options: [(value: String, label: String)] = [("", "None")]
    options += store.resumes.map { ($0.id, $0.fileName) }
    if let selection, selected == nil, store.resumesLoaded { options.append((selection, "Removed version")) }
    return options
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s2) {
        MenuField(options: options, selection: Binding(get: { selection ?? "" }, set: { value in
          selection = (value ?? "").isEmpty ? nil : value
          confirmingRemoval = false
        }), placeholder: "None", accessibilityLabel: "Resume")
        if selected != nil {
          IconButton("arrow.up.forward.square", label: "Open resume", size: 30) { openResume() }
            .disabled(opening)
          IconButton("trash", label: "Remove this version", size: 30) { confirmingRemoval = true }
            .disabled(removing || store.rolesUsing(resume: selection ?? "") > 0)
            .help(store.rolesUsing(resume: selection ?? "") > 0 ? "A role records this version, so it stays" : "Remove this version")
        }
      }
      if let upload {
        HStack(spacing: Space.s2) {
          ProgressView(value: fraction).progressViewStyle(.linear).tint(Palette.primary).frame(maxWidth: 160)
          Text("Uploading \(upload.name)").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.inkMuted).lineLimit(1)
          Spacer(minLength: 0)
          Button("Cancel") { cancelUpload() }.buttonStyle(.manor(.ghost, size: .small))
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(Int(fraction * 100)) percent")
      } else if confirmingRemoval, let selected {
        HStack(spacing: Space.s2) {
          Text("Remove \(selected.fileName)?").font(.ui(Typography.Size.sm)).foregroundStyle(Palette.ink).lineLimit(1)
          Spacer(minLength: 0)
          Button("Keep") { confirmingRemoval = false }.buttonStyle(.manor(.ghost, size: .small))
          Button("Remove") { remove(selected) }.buttonStyle(.manor(.danger, size: .small)).disabled(removing)
        }
      } else {
        Button { pick() } label: { Label("Upload new version…", systemImage: "arrow.up.doc") }
          .buttonStyle(.manor(.ghost, size: .small))
      }
      if let error = uploadError ?? store.resumesError {
        Text(error).font(.ui(Typography.Size.sm)).foregroundStyle(Palette.overdueError).fixedSize(horizontal: false, vertical: true)
      }
    }
    .onAppear { if !store.resumesLoaded { Task { await store.reloadResumes() } } }
  }

  private func pick() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.pdf]
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.prompt = "Upload"
    panel.message = "Choose a resume PDF"
    panel.begin { response in
      guard response == .OK, let url = panel.url else { return }
      Task { @MainActor in start(url) }
    }
  }

  private func start(_ url: URL) {
    uploadError = nil
    confirmingRemoval = false
    let id = UUID()
    let stream: AsyncThrowingStream<FileUploadProgress, Error>
    do { stream = try store.resumesService.upload(url, id: id) } catch {
      uploadError = error.localizedDescription
      return
    }
    upload = (id, url.lastPathComponent)
    fraction = 0
    Task {
      do {
        for try await step in stream {
          withAnimation(Motion.fast) { fraction = step.fraction }
          if case .finished(let file) = step, let version = await store.resumeUploaded(file.id.uuidString.lowercased()) {
            selection = version.id
          }
        }
      } catch is CancellationError {
      } catch {
        uploadError = "Could not upload \(url.lastPathComponent). \(error.localizedDescription)"
      }
      if upload?.id == id { upload = nil }
    }
  }

  private func cancelUpload() {
    guard let upload else { return }
    FileService.shared(for: store.gateway).cancel(upload.id)
    self.upload = nil
  }

  private func openResume() {
    guard let selection else { return }
    opening = true
    Task {
      do { openExternal(try await store.resumesService.accessURL(selection)) } catch {
        uploadError = "Could not open the resume. \(error.localizedDescription)"
      }
      opening = false
    }
  }

  private func remove(_ version: ResumeVersion) {
    removing = true
    Task {
      do {
        try await store.removeResume(version.id)
        if selection == version.id { selection = nil }
        confirmingRemoval = false
      } catch {
        uploadError = error.localizedDescription
      }
      removing = false
    }
  }
}
