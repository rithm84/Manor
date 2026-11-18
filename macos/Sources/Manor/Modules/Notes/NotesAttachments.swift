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
