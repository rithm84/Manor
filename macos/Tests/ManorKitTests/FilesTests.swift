import CryptoKit
import Foundation
import Testing
@testable import ManorKit

@Suite("File upload policy")
struct FileUploadPolicyTests {
  @Test func refusesEmptyInvalidAndOversizedFiles() {
    #expect(throws: FileUploadSizeError(.empty)) { try FileUploadPolicy.validate(size: 0) }
    #expect(throws: FileUploadSizeError(.invalid)) { try FileUploadPolicy.validate(size: -1) }
    #expect(throws: FileUploadSizeError(.tooLarge)) { try FileUploadPolicy.validate(size: 1_000_000_001) }
    #expect(throws: Never.self) { try FileUploadPolicy.validate(size: 1_000_000_000) }
    #expect(FileUploadSizeError(.tooLarge).localizedDescription == "Choose a file no larger than 1 GB.")
  }

  @Test func reportsMonotonicOverallProgress() {
    let steps: [FileUploadProgress] = [
      .staged, .hashing(0.5), .hashing(1), .transferring(sent: 0, total: 10), .transferring(sent: 10, total: 10),
      .verifying(verified: 5, total: 10), .verifying(verified: 10, total: 10)
    ]
    let fractions = steps.map(\.fraction)
    #expect(fractions == fractions.sorted())
    #expect(fractions.allSatisfy { $0 >= 0 && $0 <= 1 })
  }
}

@Suite("File checksum")
struct FileChecksumTests {
  @Test func matchesAOneShotDigestAcrossSlicesAndAPartialFinalSlice() async throws {
    var bytes = [UInt8](repeating: 0, count: 3 * 1024 * 1024 + 17)
    for index in bytes.indices { bytes[index] = UInt8(index % 251) }
    let data = Data(bytes)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("manor-checksum-\(UUID().uuidString)")
    try data.write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }
    let expected = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let collector = ProgressCollector()
    let digest = try await FileChecksum.sha256(of: url) { await collector.add($0) }
    #expect(digest == expected)
    #expect(FileChecksum.sha256(of: data) == expected)
    let reported = await collector.values
    #expect(!reported.isEmpty)
    #expect(reported == reported.sorted())
  }
}

private actor ProgressCollector {
  var values: [Double] = []
  func add(_ value: Double) { values.append(value) }
}

@Suite("Resumable transfer", .serialized)
struct ResumableTransferTests {
  @Test func usesTheDirectStorageHost() {
    #expect(ResumableTransfer.endpoint(for: URL(string: "https://abc.supabase.co")!).absoluteString
            == "https://abc.storage.supabase.co/storage/v1/upload/resumable")
    #expect(ResumableTransfer.endpoint(for: URL(string: "https://abc.storage.supabase.co")!).absoluteString
            == "https://abc.storage.supabase.co/storage/v1/upload/resumable")
    #expect(ResumableTransfer.endpoint(for: URL(string: "http://127.0.0.1:54321")!).absoluteString
            == "http://127.0.0.1:54321/storage/v1/upload/resumable")
  }

  @Test func bindsResumeIdentityToPathAndChecksum() {
    let endpoint = URL(string: "https://abc.storage.supabase.co/storage/v1/upload/resumable")!
    let one = ResumableTransfer.fingerprint(endpoint: endpoint, path: "u/1", checksum: "aa")
    #expect(one == ResumableTransfer.fingerprint(endpoint: endpoint, path: "u/1", checksum: "aa"))
    #expect(one != ResumableTransfer.fingerprint(endpoint: endpoint, path: "u/1", checksum: "bb"))
    #expect(one != ResumableTransfer.fingerprint(endpoint: endpoint, path: "u/2", checksum: "aa"))
  }

  @Test func createsThenSendsChunksAndResumesFromTheServerOffset() async throws {
    let size = Int(FileUploadPolicy.transferChunkBytes) * 2 + 1234
    let data = Data((0..<size).map { UInt8($0 % 253) })
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("manor-tus-\(UUID().uuidString)")
    try data.write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }

    StubTusServer.reset(failAfterChunks: 1)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubTusServer.self]
    let session = URLSession(configuration: configuration)
    let endpoint = URL(string: "https://abc.storage.supabase.co/storage/v1/upload/resumable")!
    let transfer = ResumableTransfer(endpoint: endpoint, apiKey: "anon", session: session) { "token" }
    let created = LocationBox()

    // The first attempt stores one chunk, then the server refuses outright, as if the app quit.
    await #expect(throws: (any Error).self) {
      try await transfer.upload(file: file, size: Int64(size), objectName: "user/file", mimeType: "application/pdf", existing: nil,
                                created: { await created.set($0) }, progress: { _ in })
    }
    let location = try #require(await created.value)
    #expect(StubTusServer.state.stored.count == Int(FileUploadPolicy.transferChunkBytes))
    #expect(StubTusServer.state.metadata?.contains("bucketName \(Data("manor-files".utf8).base64EncodedString())") == true)
    #expect(StubTusServer.state.authorization == "Bearer token")

    // A relaunch resumes from the stored offset without creating a second transfer.
    StubTusServer.state.failAfterChunks = nil
    let progress = ProgressCollector()
    try await transfer.upload(file: file, size: Int64(size), objectName: "user/file", mimeType: "application/pdf", existing: location,
                              created: { _ in Issue.record("A resumed transfer must not be created again") },
                              progress: { await progress.add(Double($0)) })
    #expect(StubTusServer.state.stored == data)
    #expect(StubTusServer.state.creations == 1)
    let offsets = await progress.values
    #expect(offsets.first == Double(FileUploadPolicy.transferChunkBytes))
    #expect(offsets.last == Double(size))
  }

  @Test func refusesASavedDestinationOnAnotherHost() async throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("manor-tus-\(UUID().uuidString)")
    try Data([1, 2, 3]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubTusServer.self]
    let endpoint = URL(string: "https://abc.storage.supabase.co/storage/v1/upload/resumable")!
    let transfer = ResumableTransfer(endpoint: endpoint, apiKey: "anon", session: URLSession(configuration: configuration)) { "token" }
    await #expect(throws: (any Error).self) {
      try await transfer.upload(file: file, size: 3, objectName: "user/file", mimeType: "application/pdf",
                                existing: URL(string: "https://elsewhere.example/upload/1")!, created: { _ in }, progress: { _ in })
    }
  }
}

private actor LocationBox {
  var value: URL?
  func set(_ url: URL) { value = url }
}

/// A minimal TUS server: creation, HEAD offsets, and PATCH appends, with an optional hard failure.
final class StubTusServer: URLProtocol, @unchecked Sendable {
  struct State {
    var stored = Data()
    var length = 0
    var creations = 0
    var patches = 0
    var failAfterChunks: Int?
    var metadata: String?
    var authorization: String?
  }
  nonisolated(unsafe) static var state = State()
  private static let lock = NSLock()

  static func reset(failAfterChunks: Int?) {
    lock.withLock { state = State(failAfterChunks: failAfterChunks) }
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let (status, headers) = Self.lock.withLock { () -> (Int, [String: String]) in
      Self.state.authorization = request.value(forHTTPHeaderField: "Authorization")
      switch request.httpMethod {
      case "POST":
        Self.state.creations += 1
        Self.state.length = Int(request.value(forHTTPHeaderField: "Upload-Length") ?? "0") ?? 0
        Self.state.metadata = request.value(forHTTPHeaderField: "Upload-Metadata")
        return (201, ["Location": "/storage/v1/upload/resumable/transfer-1"])
      case "HEAD":
        return (200, ["Upload-Offset": String(Self.state.stored.count), "Upload-Length": String(Self.state.length)])
      case "PATCH":
        if let limit = Self.state.failAfterChunks, Self.state.patches >= limit { return (400, [:]) }
        let offset = Int(request.value(forHTTPHeaderField: "Upload-Offset") ?? "-1") ?? -1
        guard offset == Self.state.stored.count else { return (409, [:]) }
        Self.state.stored.append(Self.body(of: request))
        Self.state.patches += 1
        return (204, ["Upload-Offset": String(Self.state.stored.count)])
      default:
        return (405, [:])
      }
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data())
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  /// URLSession hands protocols a body stream rather than `httpBody`.
  private static func body(of request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while stream.hasBytesAvailable {
      let read = stream.read(&buffer, maxLength: buffer.count)
      if read <= 0 { break }
      data.append(buffer, count: read)
    }
    return data
  }
}
