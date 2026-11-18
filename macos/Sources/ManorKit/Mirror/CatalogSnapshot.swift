import Compression
import CryptoKit
import Foundation

/// The published catalog snapshot, which lets a first sync download the shared problem catalog as one
/// compressed file instead of walking every row through the API.
///
/// `tools/problem-import/catalog-snapshot.mjs` writes it to the private `manor-catalog` bucket after each import:
/// `catalog/manifest.json` names the current snapshot, and the snapshot is gzip-compressed NDJSON whose first
/// line is a header and whose other lines each carry one `problem_catalog` or `problem_catalog_content` row. The
/// exporter reads the catalog head cursor before the rows, so anything committed during the export lands after
/// the header's cursor and reaches the copy through the catalog feed. Everything here is pure: `CatalogSync`
/// downloads, and these functions check and decide.
public enum CatalogSnapshot {
  public static let bucket = "manor-catalog"
  public static let manifestPath = "catalog/manifest.json"
  /// A copy this far behind the feed head reads a newer snapshot instead of walking the changes page by page.
  public static let snapshotGap = 5_000

  public struct Manifest: Sendable, Equatable {
    public let cursor: Int
    public let path: String
    public let bytes: Int
    public let sha256: String
    public let problems: Int
    public let contents: Int
    public let createdAt: String
  }

  public struct Header: Sendable, Equatable {
    public let cursor: Int
    public let problems: Int
    public let contents: Int
  }

  public struct Entry: Sendable, Equatable {
    public enum Kind: String, Sendable { case problem, content }
    public let type: Kind
    public let row: Row
  }

  /// How far a snapshot has been read: the header once seen, the rows counted so far, and an unfinished line.
  public struct Progress: Sendable, Equatable {
    public var header: Header?
    public var problems = 0
    public var contents = 0
    /// Bytes after the last newline, which the next chunk completes.
    public var carry = Data()
    /// Lines read so far, for error messages.
    public var lines = 0
    public init() {}
  }

  // MARK: Validation

  private static func count(_ value: JSONValue?) -> Int? {
    guard case .number(let number)? = value, number.rounded() == number, number >= 0, number < 9_007_199_254_740_992 else { return nil }
    return Int(number)
  }

  private static func matches(_ text: String, _ pattern: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
  }

  public static func parseManifest(_ value: JSONValue) throws -> Manifest {
    var problems: [String] = []
    let object = value.object ?? [:]
    if value.object == nil { problems.append("not an object") }
    if object["schema"] != .number(1) { problems.append("schema must be 1") }
    let cursor = count(object["cursor"])
    if cursor == nil { problems.append("cursor must be a non-negative integer") }
    let path = object["path"]?.string ?? ""
    if !matches(path, #"^catalog/[0-9]+\.ndjson\.gz$"#) { problems.append("path must name catalog/<cursor>.ndjson.gz") }
    let bytes = count(object["bytes"]) ?? 0
    if bytes <= 0 { problems.append("bytes must be a positive integer") }
    let digest = object["sha256"]?.string ?? ""
    if !matches(digest, #"^[0-9a-f]{64}$"#) { problems.append("sha256 must be 64 lowercase hex digits") }
    let problemCount = count(object["problems"])
    if problemCount == nil { problems.append("problems must be a non-negative integer") }
    let contentCount = count(object["contents"])
    if contentCount == nil { problems.append("contents must be a non-negative integer") }
    let created = object["createdAt"]?.string ?? ""
    if !matches(created, #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$"#) { problems.append("createdAt must be an ISO date-time with an offset") }
    guard problems.isEmpty, let cursor, let problemCount, let contentCount else {
      throw MirrorError("The catalog manifest is not in the expected form: \(problems.joined(separator: "; "))")
    }
    return Manifest(cursor: cursor, path: path, bytes: bytes, sha256: digest, problems: problemCount, contents: contentCount, createdAt: created)
  }

  /// Checks downloaded bytes against the manifest's length and SHA-256 before anything is decompressed.
  public static func verify(_ data: Data, against manifest: Manifest) throws {
    guard data.count == manifest.bytes else {
      throw MirrorError("The catalog snapshot \(manifest.path) is \(data.count) bytes but its manifest says \(manifest.bytes)")
    }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard digest == manifest.sha256 else {
      throw MirrorError("The catalog snapshot \(manifest.path) has SHA-256 \(digest) but its manifest says \(manifest.sha256)")
    }
  }

  // MARK: Lines

  private static func parseLine(_ line: Data, _ number: Int) throws -> JSONValue {
    do { return try MirrorJSON.parse(line) }
    catch { throw MirrorError("Catalog snapshot line \(number) is not JSON: \(error.localizedDescription)") }
  }

  private static func readHeader(_ line: Data, _ number: Int, _ manifest: Manifest) throws -> Header {
    let value = try parseLine(line, number)
    guard let object = value.object, object["schema"] == .number(1), let cursor = count(object["cursor"]),
          let problems = count(object["problems"]), let contents = count(object["contents"]) else {
      throw MirrorError("The catalog snapshot header is not in the expected form: it needs schema 1, cursor, problems, and contents")
    }
    let header = Header(cursor: cursor, problems: problems, contents: contents)
    if header.cursor != manifest.cursor || header.problems != manifest.problems || header.contents != manifest.contents {
      throw MirrorError("The catalog snapshot header (cursor \(header.cursor), \(header.problems) problems, \(header.contents) statements) does not match its manifest (cursor \(manifest.cursor), \(manifest.problems) problems, \(manifest.contents) statements)")
    }
    return header
  }

  private static func readEntry(_ line: Data, _ number: Int) throws -> Entry {
    let value = try parseLine(line, number)
    guard let type = value["type"]?.string.flatMap(Entry.Kind.init(rawValue:)), case .object(let row)? = value["row"] else {
      throw MirrorError("Catalog snapshot line \(number) is not a problem or statement row")
    }
    return Entry(type: type, row: row)
  }

  private static func isBlank(_ line: Data) -> Bool {
    line.allSatisfy { $0 == 0x20 || $0 == 0x09 || $0 == 0x0D || $0 == 0x0A }
  }

  /// Reads complete lines: the first non-blank one is the header, and every later one is a row.
  private static func readLines(_ progress: inout Progress, _ lines: [Data], _ manifest: Manifest) throws -> [Entry] {
    var entries: [Entry] = []
    for line in lines {
      progress.lines += 1
      if isBlank(line) { continue }
      guard progress.header != nil else {
        progress.header = try readHeader(line, progress.lines, manifest)
        continue
      }
      let entry = try readEntry(line, progress.lines)
      if entry.type == .problem { progress.problems += 1 } else { progress.contents += 1 }
      entries.append(entry)
    }
    return entries
  }

  /// Reads one decompressed chunk of the snapshot and returns the rows it completed.
  public static func readChunk(_ progress: inout Progress, _ chunk: Data, _ manifest: Manifest) throws -> [Entry] {
    var buffer = progress.carry
    buffer.append(chunk)
    var lines: [Data] = []
    var start = buffer.startIndex
    while let newline = buffer[start...].firstIndex(of: 0x0A) {
      lines.append(buffer[start..<newline])
      start = buffer.index(after: newline)
    }
    progress.carry = Data(buffer[start...])
    return try readLines(&progress, lines, manifest)
  }

  /// Reads the last line, which has no newline after it, and checks the snapshot was whole: a header, and as
  /// many problem and statement rows as it promised. A short or padded snapshot is refused rather than half applied.
  public static func finish(_ progress: inout Progress, _ manifest: Manifest) throws -> (header: Header, entries: [Entry]) {
    let last = progress.carry
    progress.carry = Data()
    let entries = try readLines(&progress, last.isEmpty ? [] : [last], manifest)
    guard let header = progress.header else { throw MirrorError("The catalog snapshot is empty; it has no header line") }
    guard progress.problems == header.problems, progress.contents == header.contents else {
      throw MirrorError("The catalog snapshot holds \(progress.problems) problems and \(progress.contents) statements but its header promises \(header.problems) and \(header.contents)")
    }
    return (header, entries)
  }

  // MARK: Plan

  public enum Plan: Sendable, Equatable { case feed, snapshot, tables }

  /// How a catalog pull catches up. A complete copy within `snapshotGap` of the head walks the feed. Otherwise
  /// a snapshot newer than the copy wins; a copy that must be rebuilt (never filled, or holding a cursor past
  /// the head) with no usable snapshot reads the tables, and a complete copy that is merely far behind walks
  /// the feed anyway.
  public static func plan(ready: Bool, cursor: Int, head: Int, manifestCursor: Int?) -> Plan {
    let rebuild = !ready || cursor > head
    if !rebuild && head - cursor <= snapshotGap { return .feed }
    if let manifestCursor, rebuild || manifestCursor > cursor { return .snapshot }
    return rebuild ? .tables : .feed
  }

  /// Whether a catalog pull needs to read the manifest before choosing its plan.
  public static func needsManifest(ready: Bool, cursor: Int, head: Int) -> Bool {
    !ready || cursor > head || head - cursor > snapshotGap
  }
}

/// Inflates a gzip file one chunk at a time with the Compression framework, which decodes raw deflate. The
/// gzip framing (RFC 1952) is read here: the header, the deflate body, and the CRC-32 and length trailer, which
/// are checked once the body ends. The exporter writes one member, and the decoder reads its input ahead, so the
/// trailer is taken from the last eight bytes rather than from where the body happens to stop.
public final class GzipInflater {
  private let input: Data
  private var offset = 0
  private var end = 0
  private var stream: UnsafeMutablePointer<compression_stream>?
  private var crc: UInt32 = 0
  private var length: UInt32 = 0
  private let chunkSize: Int
  private var started = false
  private var finished = false

  public init(_ data: Data, chunkSize: Int = 1 << 20) {
    input = data
    self.chunkSize = chunkSize
  }

  deinit { closeStream() }

  /// Inflates a whole gzip file at once.
  public static func inflate(_ data: Data) throws -> Data {
    let inflater = GzipInflater(data)
    var output = Data()
    while let chunk = try inflater.next() { output.append(chunk) }
    return output
  }

  private func closeStream() {
    if let stream {
      compression_stream_destroy(stream)
      stream.deallocate()
      self.stream = nil
    }
  }

  private func byte(_ at: Int) throws -> UInt8 {
    guard at < input.count else { throw MirrorError("The catalog snapshot is not a complete gzip file") }
    return input[input.startIndex + at]
  }

  private func little32(_ at: Int) throws -> UInt32 {
    try (0..<4).reduce(UInt32(0)) { $0 | UInt32(try byte(at + $1)) << (8 * UInt32($1)) }
  }

  /// Reads the header and starts a deflate stream over the body between it and the trailer.
  private func open() throws {
    guard input.count >= 18, try byte(0) == 0x1F, try byte(1) == 0x8B else { throw MirrorError("The catalog snapshot is not gzip data") }
    guard try byte(2) == 8 else { throw MirrorError("The catalog snapshot uses a compression method other than deflate") }
    let flags = try byte(3)
    var at = 10
    if flags & 0x04 != 0 { at += 2 + Int(try byte(at)) + Int(try byte(at + 1)) << 8 }
    if flags & 0x08 != 0 { while try byte(at) != 0 { at += 1 }; at += 1 }
    if flags & 0x10 != 0 { while try byte(at) != 0 { at += 1 }; at += 1 }
    if flags & 0x02 != 0 { at += 2 }
    guard at <= input.count - 8 else { throw MirrorError("The catalog snapshot is not a complete gzip file") }
    offset = at
    end = input.count - 8
    let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
      stream.deallocate()
      throw MirrorError("The catalog snapshot could not be decompressed")
    }
    self.stream = stream
  }

  /// Checks the trailer once the body has ended.
  private func close() throws {
    closeStream()
    guard try little32(input.count - 8) == crc else { throw MirrorError("The catalog snapshot failed its gzip checksum") }
    guard try little32(input.count - 4) == length else { throw MirrorError("The catalog snapshot is not the length its gzip trailer records") }
  }

  /// The next decompressed chunk, or nil once the body has been read and its trailer checked.
  public func next() throws -> Data? {
    if finished { return nil }
    if !started {
      started = true
      try open()
    }
    guard let stream else { return nil }
    var output = Data(count: chunkSize)
    var produced = 0
    var ended = false
    let available = end - offset
    try input.withUnsafeBytes { (source: UnsafeRawBufferPointer) in
      try output.withUnsafeMutableBytes { (target: UnsafeMutableRawBufferPointer) in
        stream.pointee.src_ptr = source.bindMemory(to: UInt8.self).baseAddress! + offset
        stream.pointee.src_size = available
        stream.pointee.dst_ptr = target.bindMemory(to: UInt8.self).baseAddress!
        stream.pointee.dst_size = chunkSize
        let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
        let consumed = available - stream.pointee.src_size
        produced = chunkSize - stream.pointee.dst_size
        offset += consumed
        switch status {
        case COMPRESSION_STATUS_END: ended = true
        case COMPRESSION_STATUS_OK:
          if produced == 0 && consumed == 0 { throw MirrorError("The catalog snapshot ends in the middle of its compressed data") }
        default: throw MirrorError("The catalog snapshot's compressed data is damaged")
        }
      }
    }
    output.count = produced
    crc = CRC32.update(crc, output)
    length = length &+ UInt32(truncatingIfNeeded: produced)
    if ended {
      finished = true
      try close()
    }
    return output
  }
}

/// CRC-32 (IEEE 802.3), as gzip's trailer records it.
enum CRC32 {
  private static let table: [UInt32] = (0..<256).map { index in
    (0..<8).reduce(UInt32(index)) { crc, _ in crc & 1 == 1 ? 0xEDB8_8320 ^ (crc >> 1) : crc >> 1 }
  }

  static func update(_ crc: UInt32, _ data: Data) -> UInt32 {
    var value = ~crc
    table.withUnsafeBufferPointer { table in
      data.withUnsafeBytes { bytes in
        for byte in bytes { value = table[Int((value ^ UInt32(byte)) & 0xFF)] ^ (value >> 8) }
      }
    }
    return ~value
  }
}
