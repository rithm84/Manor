import Foundation

/// One uploaded resume PDF. Its id is the private file's id; a role records the version it was sent with.
public struct ResumeVersion: Identifiable, Equatable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let fileName: String
  public let byteSize: Int64?
  /// ISO timestamp.
  public let uploadedAt: String

  public init(id: String, label: String, fileName: String, byteSize: Int64?, uploadedAt: String) {
    self.id = id
    self.label = label
    self.fileName = fileName
    self.byteSize = byteSize
    self.uploadedAt = uploadedAt
  }

  public init?(row: Row) {
    guard let id = row["id"]?.string, let fileName = row["file_name"]?.string else { return nil }
    self.init(id: id, label: row["label"]?.string ?? fileName, fileName: fileName,
              byteSize: row["byte_size"]?.double.map(Int64.init), uploadedAt: row["uploaded_at"]?.string ?? "")
  }
}

/// Resume versions: private PDFs uploaded through `FileService` and listed from `resumes`.
@MainActor
public struct ResumesService {
  public let gateway: Gateway
  public init(gateway: Gateway) { self.gateway = gateway }

  /// The label column holds 1 to 120 characters; a longer file name keeps its start and extension.
  nonisolated static func label(for fileName: String) -> String {
    let trimmed = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count > 120 else { return trimmed.isEmpty ? "Resume.pdf" : trimmed }
    let ext = (trimmed as NSString).pathExtension
    let suffix = ext.isEmpty ? "" : ".\(ext)"
    return String(trimmed.prefix(120 - suffix.count)) + suffix
  }

  /// Checks a picked file before anything is read: a PDF by name.
  public nonisolated static func validate(fileName: String) throws {
    guard fileName.lowercased().hasSuffix(".pdf") else {
      throw JobValidationError("resume", "Choose a PDF. \(fileName) is not one.")
    }
  }

  /// Versions, newest first.
  public func list() async throws -> [ResumeVersion] {
    try await gateway.rows("resumes").compactMap(ResumeVersion.init(row:)).sorted { $0.uploadedAt > $1.uploadedAt }
  }

  /// Starts uploading a PDF as a new version, named by its file. The stream ends with `.finished`; read the
  /// version with `version(id:)` afterward.
  public func upload(_ file: URL, id: UUID = UUID()) throws -> AsyncThrowingStream<FileUploadProgress, Error> {
    let name = file.lastPathComponent
    try Self.validate(fileName: name)
    let request = FileUploadRequest(id: id, purpose: .resume, name: name, label: Self.label(for: name), mimeType: "application/pdf", source: file)
    return FileService.shared(for: gateway).upload(request)
  }

  /// A finished upload's version. The row is committed once finalization returns, so a mirror that has not
  /// caught up yet is answered from the server.
  public func version(id: String) async throws -> ResumeVersion {
    if let cached = try await list().first(where: { $0.id == id }) { return cached }
    let fresh = try await gateway.rowsFromServer("resumes", where: [RowFilter("id", .string(id))]).compactMap(ResumeVersion.init(row:))
    guard let version = fresh.first else { throw JobValidationError("resume", "The uploaded resume was not returned. Reopen the role to see it.") }
    return version
  }

  /// Removes a version. The server refuses while any application records it.
  public func remove(_ id: String) async throws {
    try await gateway.command("remove_resume", ["id": .string(id)])
  }

  /// A short-lived URL that opens the PDF.
  public func accessURL(_ id: String) async throws -> URL {
    try await FileService.shared(for: gateway).accessURL(for: id)
  }
}
