import Foundation

/// A resumable TUS 1.0 transfer to Supabase Storage. It sends the file in 6 MiB `PATCH` requests,
/// attaches a fresh session token to each one, and resumes from the server's offset after a failure or
/// a relaunch when it is given the transfer address it reported earlier.
struct ResumableTransfer: Sendable {
  static let bucket = "manor-files"
  static let retryDelays: [Double] = [0, 1, 3, 5]

  let endpoint: URL
  let apiKey: String
  let session: URLSession
  let token: @Sendable () async throws -> String

  /// The direct Storage host's resumable endpoint. Hosted projects move `<ref>.supabase.co` to
  /// `<ref>.storage.supabase.co`, which accepts large transfers without the API gateway's limits.
  static func endpoint(for supabaseURL: URL) -> URL {
    var components = URLComponents(url: supabaseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
    if let host = components.host, host.hasSuffix(".supabase.co"), !host.hasSuffix(".storage.supabase.co") {
      components.host = host.replacingOccurrences(of: ".supabase.co", with: ".storage.supabase.co")
    }
    components.path = "/storage/v1/upload/resumable"
    components.query = nil
    return components.url ?? supabaseURL.appendingPathComponent("storage/v1/upload/resumable")
  }

  /// The resume identity: the same object path and checksum on the same Storage origin.
  static func fingerprint(endpoint: URL, path: String, checksum: String) -> String {
    "manor-file:\(endpoint.scheme ?? "https")://\(endpoint.host ?? ""):\(path):\(checksum)"
  }

  struct TransferError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
    var retryable: Bool { status == 0 || status == 423 || status == 429 || status >= 500 }
  }

  /// Sends `file` to `objectName`. `existing` resumes an earlier transfer; `created` records a new
  /// transfer's address so a relaunch can resume it; `progress` receives bytes the server has stored.
  func upload(file: URL, size: Int64, objectName: String, mimeType: String, existing: URL?,
              created: @Sendable (URL) async -> Void, progress: @Sendable (Int64) async -> Void) async throws {
    var location = existing
    var offset: Int64 = 0
    if let current = location {
      if let stored = try await currentOffset(current) {
        offset = stored
      } else {
        location = nil
      }
    }
    if location == nil {
      let url = try await create(size: size, objectName: objectName, mimeType: mimeType)
      await created(url)
      location = url
      offset = 0
    }
    guard let location else { return }
    await progress(offset)

    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var attempt = 0
    while offset < size {
      try Task.checkCancellation()
      do {
        try handle.seek(toOffset: UInt64(offset))
        let count = Int(min(FileUploadPolicy.transferChunkBytes, size - offset))
        let chunk = try handle.read(upToCount: count) ?? Data()
        guard chunk.count == count else {
          throw TransferError(status: -1, message: "The file changed while it was uploading. Choose it again.")
        }
        offset = try await patch(location, offset: offset, chunk: chunk)
        attempt = 0
        await progress(offset)
      } catch let error as TransferError where error.status == 409 {
        // The server holds a different offset than ours; ask where it stands and continue from there.
        guard let stored = try await currentOffset(location) else { throw error }
        offset = stored
      } catch let error as TransferError where error.retryable && attempt < Self.retryDelays.count {
        try await Task.sleep(for: .seconds(Self.retryDelays[attempt]))
        attempt += 1
      }
    }
  }

  // MARK: Requests

  private func makeRequest(_ url: URL, method: String) async throws -> URLRequest {
    guard url.scheme == endpoint.scheme, url.host == endpoint.host, url.port == endpoint.port, url.path.hasPrefix(endpoint.path) else {
      throw TransferError(status: -1, message: "The saved upload destination does not belong to Manor Storage. Choose the file again.")
    }
    let accessToken: String
    do { accessToken = try await token() } catch {
      throw TransferError(status: -1, message: "Sign in again to resume the upload. Your file is saved on this Mac.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue(apiKey, forHTTPHeaderField: "apikey")
    request.timeoutInterval = 120
    return request
  }

  private func send(_ request: URLRequest) async throws -> HTTPURLResponse {
    do {
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { throw TransferError(status: 0, message: "Storage sent an unreadable answer.") }
      return http
    } catch let error as URLError where error.code == .cancelled {
      throw CancellationError()
    } catch let error as URLError {
      throw TransferError(status: 0, message: "The upload lost its connection. It resumes where it stopped. (\(error.localizedDescription))")
    }
  }

  private func create(size: Int64, objectName: String, mimeType: String) async throws -> URL {
    var request = try await makeRequest(endpoint, method: "POST")
    func encode(_ value: String) -> String { Data(value.utf8).base64EncodedString() }
    let metadata = [("bucketName", Self.bucket), ("objectName", objectName), ("contentType", mimeType), ("cacheControl", "3600")]
      .map { "\($0.0) \(encode($0.1))" }.joined(separator: ",")
    request.setValue(String(size), forHTTPHeaderField: "Upload-Length")
    request.setValue(metadata, forHTTPHeaderField: "Upload-Metadata")
    var attempt = 0
    while true {
      let response: HTTPURLResponse
      do { response = try await send(request) } catch let error as TransferError where error.retryable && attempt < Self.retryDelays.count {
        try await Task.sleep(for: .seconds(Self.retryDelays[attempt]))
        attempt += 1
        continue
      }
      if response.statusCode == 201, let location = response.value(forHTTPHeaderField: "Location"),
         let url = URL(string: location, relativeTo: endpoint)?.absoluteURL {
        return url
      }
      let error = TransferError(status: response.statusCode, message: Self.describe(response.statusCode, creating: true))
      if error.retryable && attempt < Self.retryDelays.count {
        try await Task.sleep(for: .seconds(Self.retryDelays[attempt]))
        attempt += 1
        continue
      }
      throw error
    }
  }

  /// The server's stored offset for a transfer, or nil when the transfer is gone and must start over.
  private func currentOffset(_ url: URL) async throws -> Int64? {
    let request = try await makeRequest(url, method: "HEAD")
    let response = try await send(request)
    switch response.statusCode {
    case 200, 204:
      return response.value(forHTTPHeaderField: "Upload-Offset").flatMap(Int64.init)
    case 403, 404, 410:
      return nil
    default:
      throw TransferError(status: response.statusCode, message: Self.describe(response.statusCode, creating: false))
    }
  }

  private func patch(_ url: URL, offset: Int64, chunk: Data) async throws -> Int64 {
    var request = try await makeRequest(url, method: "PATCH")
    request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
    request.setValue(String(offset), forHTTPHeaderField: "Upload-Offset")
    request.httpBody = chunk
    let response = try await send(request)
    guard response.statusCode == 204 || response.statusCode == 200,
          let next = response.value(forHTTPHeaderField: "Upload-Offset").flatMap(Int64.init), next > offset else {
      throw TransferError(status: response.statusCode, message: Self.describe(response.statusCode, creating: false))
    }
    return next
  }

  private static func describe(_ status: Int, creating: Bool) -> String {
    switch status {
    case 401, 403: return "Storage refused the upload. Sign in again and retry."
    case 409: return creating ? "A file already exists at this upload's destination." : "The upload fell out of step with Storage."
    case 413: return "Choose a file no larger than 1 GB."
    case 429: return "Storage is busy. The upload retries on its own."
    default: return status >= 500 ? "Storage could not take the upload right now (\(status)). Retry in a moment." : "The upload failed (\(status))."
    }
  }
}
