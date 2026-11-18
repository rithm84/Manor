import Foundation
import ManorKit
import UniformTypeIdentifiers

/// Note attachments: `manor-attachment://<file id>` URLs resolved to short-lived signed downloads, and local
/// files uploaded as private files of a note. The Files service copies the source into its own journaled
/// folder before anything else, so an upload interrupted by a relaunch or a dropped connection resumes.
enum NotesAttachments {
  static let scheme = "manor-attachment"

  static func resolver(gateway: Gateway) -> ((String) async throws -> URL)? {
    { stored in
      guard let url = URL(string: stored), url.scheme == scheme, let id = url.host() ?? url.pathComponents.last, !id.isEmpty else {
        guard let web = URL(string: stored) else { throw URLError(.badURL) }
        return web
      }
      return try await FileService.shared(for: gateway).accessURL(for: id)
    }
  }

  /// Uploads a file as an attachment of `noteId` and returns its stable URL once the server has verified it,
  /// so a note never references a file the server would refuse.
  static func uploader(gateway: Gateway, noteId: String) -> ((URL) async throws -> String)? {
    { source in
      let type = UTType(filenameExtension: source.pathExtension)
      let request = FileUploadRequest(
        purpose: .note, parentId: noteId, name: source.lastPathComponent,
        mimeType: type?.preferredMIMEType ?? "application/octet-stream", source: source
      )
      let service = await MainActor.run { FileService.shared(for: gateway) }
      for try await step in await service.upload(request) {
        if case .finished(let file) = step { return "\(scheme)://\(file.id.uuidString.lowercased())" }
      }
      return "\(scheme)://\(request.id.uuidString.lowercased())"
    }
  }
}

/// Uploads into a note's media blocks, linked to their blocks on this Mac until the block holds the file.
/// The Files service journals the bytes; the link (in the Notes draft store) lets a reopened note finish an
/// upload that a lost connection or a relaunch interrupted, instead of leaving the block with an error.
@MainActor
final class NoteBlockUploads: NoteBlockUploading {
  private let gateway: Gateway
  private let noteId: String
  private let store: NoteDraftStore?

  init(gateway: Gateway, noteId: String, store: NoteDraftStore?) {
    self.gateway = gateway
    self.noteId = noteId
    self.store = store
  }

  private var files: FileService { FileService.shared(for: gateway) }

  func upload(_ source: URL, blockID: String) async throws -> String {
    let type = UTType(filenameExtension: source.pathExtension)
    let request = FileUploadRequest(
      purpose: .note, parentId: noteId, name: source.lastPathComponent,
      mimeType: type?.preferredMIMEType ?? "application/octet-stream", source: source
    )
    let link = PendingNoteUpload(accountId: gateway.accountId, noteId: noteId, blockId: blockID, uploadId: request.id, name: source.lastPathComponent)
    try? await store?.protectUpload(link)
    do {
      return try await finish(link, files.upload(request))
    } catch {
      // Staging failed (unreadable or oversized file): nothing is journaled, so nothing can resume.
      if !files.pending.contains(where: { $0.id == request.id }) { try? await store?.acknowledgeUpload(accountId: link.accountId, uploadId: link.uploadId) }
      throw error
    }
  }

  func pending() async -> [PendingNoteUpload] {
    (try? await store?.uploads(accountId: gateway.accountId, noteId: noteId)) ?? []
  }

  func resume(_ upload: PendingNoteUpload) async throws -> String {
    let id = upload.uploadId
    if files.isRunning(id) { return try await finish(upload, files.observe(id)) }
    if files.pending.contains(where: { $0.id == id }) { return try await finish(upload, files.resume(id)) }
    // Not on this Mac anymore: it either finished in the background (the file is ready) or was lost.
    guard try await files.serverStatus(of: id) == "ready" else { throw NoteUploadLost() }
    try? await store?.acknowledgeUpload(accountId: upload.accountId, uploadId: id)
    return "\(NotesAttachments.scheme)://\(id.uuidString.lowercased())"
  }

  func forget(_ upload: PendingNoteUpload, cancel: Bool) async {
    if cancel, files.pending.contains(where: { $0.id == upload.uploadId }) { files.cancel(upload.uploadId) }
    try? await store?.acknowledgeUpload(accountId: upload.accountId, uploadId: upload.uploadId)
  }

  private func finish(_ link: PendingNoteUpload, _ stream: AsyncThrowingStream<FileUploadProgress, Error>) async throws -> String {
    for try await step in stream {
      if case .finished(let file) = step {
        try? await store?.acknowledgeUpload(accountId: link.accountId, uploadId: link.uploadId)
        return "\(NotesAttachments.scheme)://\(file.id.uuidString.lowercased())"
      }
    }
    throw FileServiceError.notPending
  }
}

/// An upload whose local copy is gone before it reached the server (for example after signing out elsewhere).
struct NoteUploadLost: LocalizedError {
  var errorDescription: String? { "This file didn't finish uploading. Choose it again." }
}
