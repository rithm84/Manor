import Foundation

/// The answer to a single-row lookup.
public enum MirrorLookup: Sendable {
  /// The mirror cannot answer for this table right now; read the server.
  case notServing
  case row(Row?)
}

/// The account's local copy, kept in SQLite and updated from the backend's change feeds. The gateway reads
/// through it once it is serving and asks it to pull after every command. The implementation is `MirrorSync`.
public protocol LocalMirror: AnyObject, Sendable {
  /// Whether reads of this table come from disk right now.
  func isServing(_ table: String) async -> Bool
  /// The table's rows filtered by equality filters, or nil when the read belongs on the server.
  func rows(_ table: String, filters: [RowFilter]) async throws -> [Row]?
  /// One stored row by its mirror key.
  func row(_ table: String, key: String) async throws -> MirrorLookup
  /// Pulls the feed after this device committed a command, so pages that reload find the change on disk.
  func afterCommand() async
  /// An account-derived RPC result cached against the feed cursor and the account-local day.
  func derived(_ name: String, day: String, load: @Sendable () async throws -> JSONValue) async throws -> JSONValue
  /// Stops pulling. Sign-out calls this before wiping the file.
  func stop() async
}
