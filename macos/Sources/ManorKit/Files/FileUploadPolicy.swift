import Foundation

/// The shared upload limits, matching `supabase/functions/_shared/fileUploadPolicy.ts`.
public enum FileUploadPolicy {
  /// Decimal 1 GB is the largest file Manor stores. Profile pictures have a narrower limit on the server.
  public static let maxBytes: Int64 = 1_000_000_000
  /// The server verifies this many bytes per `file-finalize` call.
  public static let verificationChunkBytes: Int64 = 32 * 1024 * 1024
  /// Resumable transfers send this many bytes per request.
  public static let transferChunkBytes: Int64 = 6 * 1024 * 1024
  /// Checksums read the file in slices this size, so a large file is never held in memory whole.
  public static let checksumSliceBytes = 1024 * 1024

  /// Call before reading bytes or recording a pending upload.
  public static func validate(size: Int64) throws {
    if size < 0 { throw FileUploadSizeError(.invalid) }
    if size == 0 { throw FileUploadSizeError(.empty) }
    if size > maxBytes { throw FileUploadSizeError(.tooLarge) }
  }
}

/// A file that is empty, unreadable, or larger than Manor accepts, worded as the action to take.
public struct FileUploadSizeError: LocalizedError, Equatable, Sendable {
  public enum Code: String, Sendable { case tooLarge = "file_too_large", empty = "file_empty", invalid = "file_size_invalid" }
  public let code: Code
  public init(_ code: Code) { self.code = code }
  public var errorDescription: String? {
    switch code {
    case .tooLarge: return "Choose a file no larger than 1 GB."
    case .empty: return "This file is empty. Choose a file with content."
    case .invalid: return "This file has an invalid size. Choose the file again."
    }
  }
}

/// SHA-256 of a file on disk, read in bounded slices off the main actor.
public enum FileChecksum {
  /// The lowercase hex digest of the file at `url`. `progress` receives the fraction read so far; the hash
  /// stops with `CancellationError` when its task is cancelled.
  public static func sha256(of url: URL, progress: (@Sendable (Double) async -> Void)? = nil) async throws -> String {
    try await Task.detached(priority: .utility) {
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      let total = Double(max(1, (try? handle.seekToEnd()) ?? 1))
      try handle.seek(toOffset: 0)
      var hasher = SHA256Stream()
      var read: Double = 0
      var reported = 0.0
      while true {
        try Task.checkCancellation()
        let slice = try autoreleasepool { try handle.read(upToCount: FileUploadPolicy.checksumSliceBytes) } ?? Data()
        if slice.isEmpty { break }
        hasher.update(slice)
        read += Double(slice.count)
        if let progress, read / total - reported >= 0.02 {
          reported = read / total
          await progress(min(1, reported))
        }
      }
      return hasher.hexDigest()
    }.value
  }

  /// The digest of bytes already in memory.
  public static func sha256(of data: Data) -> String {
    var hasher = SHA256Stream()
    hasher.update(data)
    return hasher.hexDigest()
  }
}

#if canImport(CryptoKit)
import CryptoKit

struct SHA256Stream {
  private var hasher = SHA256()
  mutating func update(_ data: Data) { hasher.update(data: data) }
  func hexDigest() -> String { hasher.finalize().map { String(format: "%02x", $0) }.joined() }
}
#endif
