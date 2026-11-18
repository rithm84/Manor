import Foundation
import Observation
import Supabase

/// Private files for one signed-in account: resumable uploads into the private `manor-files` bucket and
/// short-lived access URLs for finished files.
///
/// ## Uploading
///
/// ```swift
/// let files = FileService.shared(for: gateway)
/// let request = FileUploadRequest(purpose: .note, parentId: noteId, name: "diagram.png", mimeType: "image/png", source: url)
/// for try await step in files.upload(request) {
///   switch step {
///   case .finished(let file): attach(file.id)
///   default: showProgress(step.fraction)
///   }
/// }
/// ```
///
/// An upload runs through four phases, each reported on the stream:
/// 1. **Staging.** The size is checked against the 1 GB policy and the source is copied (an APFS clone,
///    so no extra disk space for large files) into Manor's upload storage with a journal entry, so the
///    upload survives relaunch and the caller may discard its original.
/// 2. **Hashing.** SHA-256 is computed off the main actor over 1 MiB slices.
/// 3. **Allocation and transfer.** `allocate_file` runs with the file id as its command id (a retry
///    replays), then bytes go to Storage as a resumable TUS transfer in 6 MiB chunks. The transfer address
///    is journaled with its resume identity (Storage origin, object path, checksum), so a relaunch
///    continues from the server's offset. Bytes already in Storage are never sent again.
/// 4. **Verification.** `file-finalize` is called until the server has verified every 32 MiB range
///    (each `202` reports progress) and the file is `ready`. Finalization also writes the file's metadata
///    row, such as the `resumes` row, and the affected tables are published so pages reload.
///
/// The stream ends after `.finished` or throws. Ending iteration early does not stop the upload; call
/// `cancel(_:)` to stop it and discard its local copy. A failed upload stays in `pending` with its
/// `failure` text until it is retried with `resume(_:)` or cancelled.
///
/// ## After relaunch
///
/// `pending` lists unfinished uploads recorded on this Mac for the account. Call `resumePending()` (or
/// `resume(_:)` for one) after sign-in to continue them; `progress` holds each running upload's latest step
/// for views that bind to state instead of iterating a stream. `observe(_:)` attaches another stream to an
/// upload that is already running.
///
/// ## Reading files
///
/// `accessURL(for:)` returns a signed URL valid for 15 minutes, cached until shortly before it expires.
@MainActor
@Observable
public final class FileService {
  /// Unfinished uploads on this Mac for the account, oldest first.
  public private(set) var pending: [PendingFileUpload] = []
  /// The latest step of each upload that is running now.
  public private(set) var progress: [UUID: FileUploadProgress] = [:]

  @ObservationIgnored private let gateway: Gateway
  @ObservationIgnored private let directory: URL
  @ObservationIgnored private var tasks: [UUID: Task<Void, Never>] = [:]
  @ObservationIgnored private var observers: [UUID: [UUID: AsyncThrowingStream<FileUploadProgress, Error>.Continuation]] = [:]
  @ObservationIgnored private var signedURLs: [String: (url: URL, expires: Date)] = [:]
  @ObservationIgnored private let transferSession: URLSession

  private static var instances: [String: FileService] = [:]

  /// The service for the gateway's account. One instance per account, so every page sees the same uploads.
  public static func shared(for gateway: Gateway) -> FileService {
    if let existing = instances[gateway.accountId], existing.gateway === gateway { return existing }
    let service = FileService(gateway: gateway)
    instances[gateway.accountId] = service
    return service
  }

  /// Where this account's pending uploads are journaled on this Mac.
  public static func storageDirectory(accountId: String) -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let app = Bundle.main.bundleIdentifier ?? "Manor"
    return base.appendingPathComponent(app, isDirectory: true).appendingPathComponent("FileUploads", isDirectory: true)
      .appendingPathComponent(accountId, isDirectory: true)
  }

  /// Removes an account's pending uploads from this Mac, for example when it signs out for good.
  public static func discardPendingUploads(accountId: String) {
    if let service = instances[accountId] {
      for task in service.tasks.values { task.cancel() }
      instances[accountId] = nil
    }
    try? FileManager.default.removeItem(at: storageDirectory(accountId: accountId))
  }

  init(gateway: Gateway, directory: URL? = nil) {
    self.gateway = gateway
    self.directory = directory ?? Self.storageDirectory(accountId: gateway.accountId)
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 120
    configuration.waitsForConnectivity = false
    self.transferSession = URLSession(configuration: configuration)
    try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    pending = loadJournal()
  }

  // MARK: Public API

  /// Starts uploading `request` and returns its progress. If an upload with the same id is already pending
  /// it is resumed instead, so retrying with the same request is safe.
  public func upload(_ request: FileUploadRequest) -> AsyncThrowingStream<FileUploadProgress, Error> {
    let stream = observe(request.id)
    if tasks[request.id] != nil { return stream }
    if pending.contains(where: { $0.id == request.id }) {
      start(request.id)
      return stream
    }
    do {
      let entry = try stage(request)
      record(entry)
      emit(request.id, .staged)
      start(request.id)
    } catch {
      finish(request.id, throwing: error)
    }
    return stream
  }

  /// Continues a pending upload (after relaunch or a failure) and returns its progress.
  public func resume(_ id: UUID) -> AsyncThrowingStream<FileUploadProgress, Error> {
    let stream = observe(id)
    guard pending.contains(where: { $0.id == id }) else {
      finish(id, throwing: FileServiceError.notPending)
      return stream
    }
    if tasks[id] == nil { start(id) }
    return stream
  }

  /// Continues every pending upload that is not running, optionally only those of the given purposes.
  public func resumePending(purposes: Set<FilePurpose>? = nil) {
    for entry in pending where tasks[entry.id] == nil && (purposes?.contains(entry.request.purpose) ?? true) {
      start(entry.id)
    }
  }

  /// A progress stream for an upload, starting with its latest step. It ends when the upload finishes,
  /// fails, or is cancelled.
  public func observe(_ id: UUID) -> AsyncThrowingStream<FileUploadProgress, Error> {
    let (stream, continuation) = AsyncThrowingStream<FileUploadProgress, Error>.makeStream(bufferingPolicy: .bufferingNewest(8))
    let token = UUID()
    observers[id, default: [:]][token] = continuation
    if let latest = progress[id] { continuation.yield(latest) }
    continuation.onTermination = { [weak self] _ in
      Task { @MainActor in self?.observers[id]?[token] = nil }
    }
    return stream
  }

  /// Whether an upload is running now.
  public func isRunning(_ id: UUID) -> Bool { tasks[id] != nil }

  /// The server's lifecycle state for a file (`allocated`, `ready`, `purging`), or nil when it has none. An
  /// upload that finished while nobody was watching is recognized by its file being `ready`.
  public func serverStatus(of id: UUID) async throws -> String? {
    let rows = try await gateway.rowsFromServer("file_objects", where: [RowFilter("id", .string(id.uuidString.lowercased()))], columns: "id,status")
    return rows.first?["status"]?.string
  }

  /// Stops an upload and discards its local copy. A file the server already allocated stays allocated and
  /// is cleaned up by the server's abandoned-upload job.
  public func cancel(_ id: UUID) {
    tasks[id]?.cancel()
    tasks[id] = nil
    remove(id)
    finish(id, throwing: CancellationError())
  }

  /// A signed URL for a ready file, valid for 15 minutes. Repeated calls reuse it until a minute before
  /// it expires. `downloadName` makes the browser save the file under that name instead of showing it.
  public func accessURL(for fileId: String, downloadName: String? = nil) async throws -> URL {
    let key = "\(fileId)|\(downloadName ?? "")"
    if let cached = signedURLs[key], cached.expires > Date().addingTimeInterval(60) { return cached.url }
    let rows = try await gateway.rowsFromServer("file_objects", where: [RowFilter("id", .string(fileId))], columns: "id,storage_path,status")
    guard let row = rows.first, let path = row["storage_path"]?.string else { throw FileServiceError.missing }
    guard row["status"]?.string == "ready" else { throw FileServiceError.notReady }
    let lifetime = 900
    let url = try await gateway.perform("Open file") {
      try await gateway.client.storage.from(ResumableTransfer.bucket).createSignedURL(path: path, expiresIn: lifetime, download: downloadName)
    }
    signedURLs[key] = (url, Date().addingTimeInterval(TimeInterval(lifetime)))
    return url
  }

  // MARK: Running

  private func start(_ id: UUID) {
    guard tasks[id] == nil else { return }
    update(id) { $0.failure = nil }
    tasks[id] = Task { [weak self] in
      guard let self else { return }
      do {
        let file = try await self.run(id)
        self.tasks[id] = nil
        self.remove(id)
        self.emit(id, .finished(file))
        self.finish(id, throwing: nil)
      } catch {
        self.tasks[id] = nil
        if error is CancellationError || Task.isCancelled {
          self.finish(id, throwing: CancellationError())
        } else {
          self.update(id) { $0.failure = error.localizedDescription }
          self.finish(id, throwing: error)
        }
      }
    }
  }

  private func run(_ id: UUID) async throws -> UploadedFile {
    guard var entry = pending.first(where: { $0.id == id }) else { throw FileServiceError.notPending }
    let staged = dataURL(id)
    guard FileManager.default.fileExists(atPath: staged.path) else { throw FileServiceError.stagedCopyMissing }

    let sha256: String
    if let known = entry.sha256 {
      sha256 = known
    } else {
      emit(id, .hashing(0))
      sha256 = try await FileChecksum.sha256(of: staged) { [weak self] fraction in
        await self?.emit(id, .hashing(fraction))
      }
      entry.sha256 = sha256
      update(id) { $0.sha256 = sha256 }
    }
    try Task.checkCancellation()

    let request = entry.request
    let input: JSONObject = [
      "id": .string(id.uuidString.lowercased()), "purpose": .string(request.purpose.rawValue), "parent_id": .from(request.parentId),
      "name": .string(request.name), "label": .from(request.label), "mime_type": .string(request.mimeType),
      "size": .number(Double(entry.size)), "sha256": .string(sha256)
    ]
    let receipt = try await gateway.command("allocate_file", input, id: id)
    guard let record = receipt.record, let path = record["storage_path"]?.string else { throw FileServiceError.allocationIncomplete }
    if entry.storagePath != path { update(id) { $0.storagePath = path } }

    // A replayed allocation receipt describes the original state, not whether finalization has since committed.
    let current = try await gateway.rowsFromServer("file_objects", where: [RowFilter("id", .string(id.uuidString.lowercased()))], columns: "id,status")
    guard let status = current.first?["status"]?.string else { throw FileServiceError.missing }
    if status == "purging" { throw FileServiceError.purging }
    if status == "allocated" {
      let exists = try await gateway.perform("Check upload") {
        try await gateway.client.storage.from(ResumableTransfer.bucket).exists(path: path)
      }
      if !exists {
        try await transfer(id: id, entry: entry, path: path, sha256: sha256)
      }
      // Completed but unacknowledged transfers are verified without sending their bytes again.
      try await finalize(id: id, size: entry.size)
    }
    // Finalization wrote the file's metadata row outside a command, so the mirror has not pulled it yet.
    await gateway.afterServerWrite(tables: request.purpose.affectedTables)
    return UploadedFile(id: id, path: path, size: entry.size, mimeType: request.mimeType)
  }

  private func transfer(id: UUID, entry: PendingFileUpload, path: String, sha256: String) async throws {
    let endpoint = ResumableTransfer.endpoint(for: gateway.config.supabaseURL)
    let fingerprint = ResumableTransfer.fingerprint(endpoint: endpoint, path: path, checksum: sha256)
    let existing = entry.transferFingerprint == fingerprint ? entry.transferURL : nil
    let client = gateway.client
    let transfer = ResumableTransfer(endpoint: endpoint, apiKey: gateway.config.supabaseKey, session: transferSession) {
      try await client.auth.session.accessToken
    }
    let total = entry.size
    emit(id, .transferring(sent: 0, total: total))
    try await transfer.upload(
      file: dataURL(id), size: total, objectName: path, mimeType: entry.request.mimeType, existing: existing,
      created: { [weak self] url in
        await self?.recordTransfer(id, url: url, fingerprint: fingerprint)
      },
      progress: { [weak self] sent in
        await self?.emit(id, .transferring(sent: sent, total: total))
      }
    )
    gateway.markConnected(true)
  }

  private func finalize(id: UUID, size: Int64) async throws {
    var verified: Int64 = 0
    emit(id, .verifying(verified: 0, total: size))
    let steps = Int((size + FileUploadPolicy.verificationChunkBytes - 1) / FileUploadPolicy.verificationChunkBytes) + 1
    let idString = id.uuidString.lowercased()
    for _ in 0..<steps {
      try Task.checkCancellation()
      let result = try await verifyNextPart(idString)
      let status = result["status"]?.string
      if status == "ready" {
        guard result["id"]?.string?.lowercased() == idString, Int64(result["size"]?.double ?? -1) == size else {
          throw FileServiceError.verificationMismatch
        }
        emit(id, .verifying(verified: size, total: size))
        return
      }
      guard status == "verifying", result["id"]?.string?.lowercased() == idString,
            let next = result["verified_bytes"]?.double.map(Int64.init), Int64(result["total_bytes"]?.double ?? -1) == size,
            next > verified, next < size else {
        throw FileServiceError.verificationInconsistent
      }
      verified = next
      emit(id, .verifying(verified: verified, total: size))
    }
    throw FileServiceError.verificationUnfinished
  }

  private func verifyNextPart(_ id: String) async throws -> JSONValue {
    var attempt = 0
    while true {
      do {
        return try await gateway.function("file-finalize", ["id": .string(id)])
      } catch let error as ManorRequestError {
        let status = Int(error.code) ?? 0
        guard attempt < 2, status == 0 || status == 429 || status >= 500 else {
          throw FileServiceError.verificationFailed(status: status, detail: error.detail)
        }
      } catch let error as ManorConnectionError {
        guard attempt < 2 else { throw error }
      }
      attempt += 1
      try await Task.sleep(for: .seconds(Double(attempt)))
    }
  }

  private func recordTransfer(_ id: UUID, url: URL, fingerprint: String) {
    update(id) { $0.transferURL = url; $0.transferFingerprint = fingerprint }
  }

  // MARK: Observers

  private func emit(_ id: UUID, _ step: FileUploadProgress) {
    progress[id] = step
    for continuation in observers[id].map({ Array($0.values) }) ?? [] { continuation.yield(step) }
  }

  private func finish(_ id: UUID, throwing error: Error?) {
    progress[id] = nil
    let continuations = observers[id].map { Array($0.values) } ?? []
    observers[id] = nil
    for continuation in continuations {
      if let error { continuation.finish(throwing: error) } else { continuation.finish() }
    }
  }

  // MARK: Journal

  private func journalURL(_ id: UUID) -> URL { directory.appendingPathComponent("\(id.uuidString.lowercased()).json") }
  private func dataURL(_ id: UUID) -> URL { directory.appendingPathComponent("\(id.uuidString.lowercased()).upload") }

  /// Validates the size and copies the source into upload storage.
  private func stage(_ request: FileUploadRequest) throws -> PendingFileUpload {
    let attributes = try FileManager.default.attributesOfItem(atPath: request.source.path)
    let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
    try FileUploadPolicy.validate(size: size)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = dataURL(request.id)
    try? FileManager.default.removeItem(at: destination)
    let accessed = request.source.startAccessingSecurityScopedResource()
    defer { if accessed { request.source.stopAccessingSecurityScopedResource() } }
    try FileManager.default.copyItem(at: request.source, to: destination)
    var stored = request
    stored.source = destination
    return PendingFileUpload(request: stored, size: size, sha256: nil, storagePath: nil, transferURL: nil,
                             transferFingerprint: nil, createdAt: Date(), failure: nil)
  }

  private func record(_ entry: PendingFileUpload) {
    if let index = pending.firstIndex(where: { $0.id == entry.id }) { pending[index] = entry } else { pending.append(entry) }
    save(entry)
  }

  private func update(_ id: UUID, _ change: (inout PendingFileUpload) -> Void) {
    guard let index = pending.firstIndex(where: { $0.id == id }) else { return }
    change(&pending[index])
    save(pending[index])
  }

  private func save(_ entry: PendingFileUpload) {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    guard let data = try? encoder.encode(entry) else { return }
    try? data.write(to: journalURL(entry.id), options: .atomic)
  }

  private func remove(_ id: UUID) {
    pending.removeAll { $0.id == id }
    try? FileManager.default.removeItem(at: journalURL(id))
    try? FileManager.default.removeItem(at: dataURL(id))
  }

  private func loadJournal() -> [PendingFileUpload] {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
    return files.filter { $0.pathExtension == "json" }
      .compactMap { try? decoder.decode(PendingFileUpload.self, from: Data(contentsOf: $0)) }
      .filter { FileManager.default.fileExists(atPath: dataURL($0.id).path) }
      .sorted { $0.createdAt < $1.createdAt }
  }
}

/// Upload and access failures, worded for the reader.
public enum FileServiceError: LocalizedError, Equatable {
  case notPending
  case stagedCopyMissing
  case allocationIncomplete
  case missing
  case notReady
  case purging
  case verificationMismatch
  case verificationInconsistent
  case verificationUnfinished
  case verificationFailed(status: Int, detail: String)

  public var errorDescription: String? {
    switch self {
    case .notPending: return "This upload is no longer waiting on this Mac. Choose the file again."
    case .stagedCopyMissing: return "The saved copy of this upload is gone. Choose the file again."
    case .allocationIncomplete: return "Manor could not reserve space for this file. Retry the upload."
    case .missing: return "This file is no longer available."
    case .notReady: return "This file is still uploading."
    case .purging: return "This file is being removed and cannot be uploaded again."
    case .verificationMismatch: return "The verified file does not match this upload."
    case .verificationInconsistent: return "File verification returned inconsistent progress. Retry the upload to continue verification."
    case .verificationUnfinished: return "File verification did not finish. Retry the upload to continue verification."
    case .verificationFailed(let status, let detail): return "The file could not be verified (\(status)): \(detail)"
    }
  }
}
