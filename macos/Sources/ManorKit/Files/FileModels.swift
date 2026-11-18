import Foundation

/// What a private file belongs to. The server checks the parent and the allowed types for each purpose.
public enum FilePurpose: String, Codable, Sendable, Hashable {
  /// A Notes attachment; `parentId` is the note id.
  case note
  /// A resume version (PDF only). The finalized file id is the `resumes` row id.
  case resume
  /// A profile picture (PNG, JPEG, or WebP, 5 MB at most).
  case avatar
  /// A knowledge-base capture asset; `parentId` is the capture id.
  case capture

  /// The tables a finished upload of this purpose changes, so their pages reload.
  var affectedTables: Set<String> {
    switch self {
    case .note: return ["note_attachments", "note_pages"]
    case .resume: return ["resumes"]
    case .avatar: return ["profiles"]
    case .capture: return ["kb_entries"]
    }
  }
}

/// A file to upload. `id` is the file's permanent identity: choose it once and reuse it on every retry, so
/// a repeated allocation replays instead of creating a second file.
public struct FileUploadRequest: Codable, Sendable, Hashable, Identifiable {
  public var id: UUID
  public var purpose: FilePurpose
  public var parentId: String?
  /// The file's own name, shown in downloads and lists.
  public var name: String
  /// An optional display label, 1 to 120 characters.
  public var label: String?
  public var mimeType: String
  /// The local file to send. `FileService` copies it into its own storage before returning, so the caller
  /// may delete or move the original once `upload` has been called.
  public var source: URL

  public init(id: UUID = UUID(), purpose: FilePurpose, parentId: String? = nil, name: String, label: String? = nil, mimeType: String, source: URL) {
    self.id = id
    self.purpose = purpose
    self.parentId = parentId
    self.name = name
    self.label = label
    self.mimeType = mimeType
    self.source = source
  }
}

/// A finalized private file.
public struct UploadedFile: Sendable, Hashable, Identifiable {
  public let id: UUID
  /// The object path inside the private `manor-files` bucket.
  public let path: String
  public let size: Int64
  public let mimeType: String
}

/// Where an upload stands. Each case after `.staged` reports progress through its own phase.
public enum FileUploadProgress: Sendable, Equatable {
  /// The file is copied into Manor's upload storage and survives relaunch.
  case staged
  /// The checksum is being computed (fraction 0 to 1).
  case hashing(Double)
  /// Bytes are being transferred to Storage.
  case transferring(sent: Int64, total: Int64)
  /// The server is checking the stored bytes against the checksum.
  case verifying(verified: Int64, total: Int64)
  /// The file is ready; any metadata row (a resume version, an attachment) is committed.
  case finished(UploadedFile)

  /// A single 0 to 1 estimate across every phase, for one progress bar.
  public var fraction: Double {
    switch self {
    case .staged: return 0
    case .hashing(let value): return 0.1 * value
    case .transferring(let sent, let total): return 0.1 + 0.75 * (total > 0 ? Double(sent) / Double(total) : 0)
    case .verifying(let verified, let total): return 0.85 + 0.15 * (total > 0 ? Double(verified) / Double(total) : 0)
    case .finished: return 1
    }
  }
}

/// An upload that has not finished, as recorded on this Mac. It survives relaunch until it finishes or is cancelled.
public struct PendingFileUpload: Codable, Sendable, Identifiable, Hashable {
  public var request: FileUploadRequest
  public var size: Int64
  public var sha256: String?
  /// Set once the server allocated the file.
  public var storagePath: String?
  /// The resumable transfer's address and the identity it was created for.
  public var transferURL: URL?
  public var transferFingerprint: String?
  public var createdAt: Date
  /// The last failure, worded for the reader; nil while running or waiting.
  public var failure: String?

  public var id: UUID { request.id }
}
