import Foundation

/// One row of a change feed: which row changed and how, never what it now holds.
public struct FeedChange: Sendable, Equatable {
  public enum Kind: String, Sendable { case insert, update, delete, purge }
  public let cursor: Int
  public let objectType: String
  public let objectKey: Row
  public let change: Kind
  public let revision: Int?

  public init(cursor: Int, objectType: String, objectKey: Row, change: Kind, revision: Int?) {
    self.cursor = cursor
    self.objectType = objectType
    self.objectKey = objectKey
    self.change = change
    self.revision = revision
  }
}

/// What one row needs after every change in a batch is folded together, in cursor order.
public struct KeyedChange: Sendable, Equatable {
  public enum Action: String, Sendable { case remove, reread }
  public let key: String
  public let action: Action
  public let identity: [String: String]
  public let revision: Int?
  /// A remove for this key came earlier in the same batch. Rows keyed by their natural identity are recreated
  /// with `revision` restarting at 1 (clearing a habit entry and logging it again), so a local revision above
  /// the feed's says nothing about such a row and its re-read can never be skipped.
  public let recreated: Bool
}

/// One table's share of a feed page.
public struct TableChanges: Sendable {
  /// Set when the feed named a row the table's key columns cannot address, which only a full pull resolves.
  public var fullRefresh = false
  /// Changes by key, in the order each key first appeared.
  public private(set) var byKey: [String: KeyedChange] = [:]
  public private(set) var order: [String] = []

  public var changes: [KeyedChange] { order.compactMap { byKey[$0] } }

  mutating func set(_ change: KeyedChange) {
    if byKey[change.key] == nil { order.append(change.key) }
    byKey[change.key] = change
  }
}

/// A folded feed page.
public struct FeedBatch: Sendable {
  public let tables: [String: TableChanges]
  /// Tables in the order the page first named them.
  public let tableOrder: [String]
  public let lastCursor: Int
  /// The object types the mirror does not hold. They still advance the cursor.
  public let ignored: [String]
}

/// What a table's apply does: delete these keys, re-read these rows.
public struct TableApplyPlan: Sendable, Equatable {
  public let removals: [String]
  public let lookups: [KeyedChange]
}

public enum PullPlan {
  /// Folds a page of the feed into per-table work. The feed is contiguous and ascending, so the last change for
  /// a key decides its fate: an insert followed by a delete is a delete, and a delete followed by an insert is a
  /// re-read of a recreated row. A cursor that does not ascend means the feed contract broke.
  public static func group(_ changes: [FeedChange], since: Int) throws -> FeedBatch {
    var tables: [String: TableChanges] = [:]
    var tableOrder: [String] = []
    var ignored: [String] = []
    var lastCursor = since
    for change in changes {
      guard change.cursor > lastCursor else {
        throw MirrorError("The change feed returned cursor \(change.cursor) after \(lastCursor); cursors ascend")
      }
      lastCursor = change.cursor
      guard let table = MirrorTables.mirroredTable(change.objectType) else {
        if !ignored.contains(change.objectType) { ignored.append(change.objectType) }
        continue
      }
      if tables[table] == nil {
        tables[table] = TableChanges()
        tableOrder.append(table)
      }
      guard let identity = try MirrorTables.identity(table, objectKey: change.objectKey) else {
        tables[table]?.fullRefresh = true
        continue
      }
      let key = try MirrorTables.key(table, identity: identity)
      let previous = tables[table]?.byKey[key]
      let action: KeyedChange.Action = change.change == .delete || change.change == .purge ? .remove : .reread
      let recreated = action == .reread && previous.map { $0.action == .remove || $0.recreated } == true
      tables[table]?.set(KeyedChange(key: key, action: action, identity: identity, revision: change.revision, recreated: recreated))
    }
    return FeedBatch(tables: tables, tableOrder: tableOrder, lastCursor: lastCursor, ignored: ignored)
  }

  /// Splits a table's folded changes into deletions and re-reads. A local row already at or past the feed's
  /// revision came from this app's own command, so its re-read is skipped; a table without a revision column
  /// reports nil and is always re-read, and so is a row this batch deleted before recreating it.
  public static func plan(_ changes: TableChanges, localRevisions: [String: Int?]) -> TableApplyPlan {
    var removals: [String] = []
    var lookups: [KeyedChange] = []
    for change in changes.changes {
      if change.action == .remove {
        removals.append(change.key)
        continue
      }
      let local = localRevisions[change.key] ?? nil
      if !change.recreated, let revision = change.revision, let local, local >= revision { continue }
      lookups.append(change)
    }
    return TableApplyPlan(removals: removals, lookups: lookups)
  }
}
