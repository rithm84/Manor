import Foundation
import Synchronization
import os

let mirrorLog = Logger(subsystem: "app.manor", category: "mirror")

/// The facts a read consults without waiting on a pull: whether each copy is serving, the account cursor the
/// derived cache keys on, and whether the mirror has stopped.
final class MirrorFlags: Sendable {
  struct State {
    var accountServing = false
    var catalogServing = false
    var stopped = false
    var cursor = 0
  }

  private let state = Mutex(State())

  var accountServing: Bool { state.withLock { $0.accountServing } }
  var catalogServing: Bool { state.withLock { $0.catalogServing } }
  var stopped: Bool { state.withLock { $0.stopped } }
  var cursor: Int { state.withLock { $0.cursor } }

  func setAccountServing(_ serving: Bool) { state.withLock { if !$0.stopped || !serving { $0.accountServing = serving } } }
  func setCatalogServing(_ serving: Bool) { state.withLock { if !$0.stopped || !serving { $0.catalogServing = serving } } }
  func setCursor(_ cursor: Int) { state.withLock { $0.cursor = cursor } }

  func stop() {
    state.withLock {
      $0.stopped = true
      $0.accountServing = false
      $0.catalogServing = false
    }
  }

  /// Whether reads of this stored table come from disk right now. The catalog is ready on its own schedule.
  func serves(_ table: String) -> Bool {
    if table == MirrorTables.catalogDetailTable || MirrorTables.isCatalogTable(table) { return catalogServing }
    return MirrorTables.isMirrored(table) && accountServing
  }
}

/// One writer at a time, in the order they asked.
actor SerialGate {
  private var busy = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func acquire() async {
    guard busy else {
      busy = true
      return
    }
    await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
  }
}

/// What a pass tells the rest of the app: which tables changed, so pages that show them reload.
typealias MirrorPublish = @Sendable (Set<String>) async -> Void

/// Keeps this account's copy current.
///
/// The server stays authoritative: nothing is written locally except what the server returns, and every
/// change arrives as a poke followed by a pull of `manor_workspace_changes`. A pull never trusts the feed's
/// contents, only its ordering: it deletes by key and re-reads inserted or updated rows by identity. The cursor
/// moves only after an apply finishes, so an interrupted pull repeats instead of skipping.
actor AccountSync {
  /// One pull walks at most this many pages. Beyond it the next pass rebuilds rather than chase the feed.
  static let maxFeedBatches = 100
  /// How many tables a bootstrap fills at once: enough to overlap round trips, few enough to leave the
  /// connection to the page that is still loading behind it.
  static let bootstrapConcurrency = 4

  let accountId: String
  private let store: MirrorStore
  private let remote: MirrorRemote
  private let flags: MirrorFlags
  private let publish: MirrorPublish
  private let gate = SerialGate()
  private var queued: Task<Void, Never>?
  /// The copy holds a complete copy of every account table as of `cursor`.
  private var isReady: Bool
  private var cursor: Int
  /// The launch pass ends only when it succeeds, so a launch that failed offline still checks the head cursor
  /// and refreshes the feed-less tables at the next poke.
  private var firstRun = true

  init(accountId: String, store: MirrorStore, remote: MirrorRemote, flags: MirrorFlags, status: MirrorStatus, publish: @escaping MirrorPublish) {
    self.accountId = accountId
    self.store = store
    self.remote = remote
    self.flags = flags
    self.publish = publish
    isReady = status.ready
    cursor = status.cursor
    flags.setCursor(status.cursor)
    flags.setAccountServing(status.ready)
  }

  /// Catches the copy up. Pokes that arrive while one pull runs collapse into a single follow-up.
  func pull() async {
    if let queued {
      await queued.value
      return
    }
    let task = Task { await self.runQueued() }
    queued = task
    await task.value
  }

  private func runQueued() async {
    await gate.acquire()
    queued = nil
    await run()
    await gate.release()
  }

  /// Replaces the feed-less shared tables on their hourly cadence, in line with the pulls.
  func refreshFeedless() async {
    guard !flags.stopped, isReady else { return }
    await gate.acquire()
    do {
      try await refreshTables(MirrorTables.hourlyTables)
    } catch is MirrorAbandoned {
    } catch {
      mirrorLog.error("Manor could not refresh the shared tables in the local mirror: \(error.localizedDescription, privacy: .public)")
    }
    await gate.release()
  }

  /// Refuses the next store write once the mirror has stopped, which ends the pass before it touches the file.
  private func guardRunning() throws {
    if flags.stopped { throw MirrorAbandoned(accountId: accountId) }
  }

  private func run() async {
    guard !flags.stopped else { return }
    do {
      if !isReady || firstRun {
        let head = try await remote.feedCursor(.workspace)
        if MirrorTables.needsRebuild(ready: isReady, cursor: cursor, head: head) {
          // The feed walk below then applies whatever committed while the fill ran, including this device's
          // own commands, which skip their after-commit wait until the mirror is serving.
          try await bootstrap(head: head)
        } else {
          try await refreshTables(MirrorTables.launchRefreshTables)
        }
        firstRun = false
      }
      try await applyFeed()
      flags.setAccountServing(isReady)
    } catch is MirrorAbandoned {
      return
    } catch {
      // Offline is what a local copy is for, so it keeps serving. Any other failure means the copy may be
      // wrong, so reads return to the server until a pull succeeds and proves it current again.
      let offline = error is ManorConnectionError
      if !offline { flags.setAccountServing(false) }
      mirrorLog.error("Manor could not refresh the local mirror (cursor \(self.cursor), ready \(self.isReady), offline \(offline)): \(error.localizedDescription, privacy: .public)")
    }
  }

  /// Fills an empty or stale copy from the server, a few tables at a time. The head cursor was read first, so a
  /// change committed during the fill lands after it and the feed walk that follows applies it.
  private func bootstrap(head: Int) async throws {
    let tables = MirrorTables.accountTables
    var offset = 0
    while offset < tables.count {
      let group = Array(tables[offset..<min(offset + Self.bootstrapConcurrency, tables.count)])
      // Every table in the group finishes before a failure is raised, so none is left writing unheard.
      let failures = await withTaskGroup(of: Error?.self) { tasks in
        for table in group {
          tasks.addTask {
            do { try await self.replaceTable(table); return nil } catch { return error }
          }
        }
        var failures: [Error] = []
        for await failure in tasks { if let failure { failures.append(failure) } }
        return failures
      }
      if let failure = failures.first(where: { $0 is MirrorAbandoned }) ?? failures.first { throw failure }
      offset += Self.bootstrapConcurrency
    }
    try guardRunning()
    try await store.commit(cursor: head, ready: true)
    setCursor(head)
    isReady = true
    // Reads move to the copy before pages are told to reload, so they read what this pass filled.
    flags.setAccountServing(true)
    await publish(Set(ManorTables.all))
  }

  private func setCursor(_ value: Int) {
    cursor = value
    flags.setCursor(value)
  }

  private func replaceTable(_ table: String) async throws {
    let rows = try await remote.readTable(table, filters: MirrorTables.standingFilters(table))
    let stored = try rows.map { try MirrorRow(table: table, row: $0) }
    try guardRunning()
    try await store.replaceTable(table, rows: stored)
  }

  private func refreshTables(_ tables: [String]) async throws {
    for table in tables { try await replaceTable(table) }
    await publish(Set(tables))
  }

  private func applyFeed() async throws {
    var touched = Set<String>()
    // Tables with a feed trigger that the mirror does not hold. Pages that read them from the server still
    // need to hear that they changed.
    var ignored = Set<String>()
    var applied = false
    var page = 0
    while true {
      if page == Self.maxFeedBatches {
        isReady = false
        throw MirrorError("The change feed offered more than \(Self.maxFeedBatches * feedPageSize) changes at once; the mirror rebuilds instead of chasing it")
      }
      page += 1
      let changes = try await remote.feedChanges(.workspace, since: cursor, limit: feedPageSize)
      try guardRunning()
      if changes.isEmpty { break }
      applied = true
      let batch = try PullPlan.group(changes, since: cursor)
      for objectType in batch.ignored where ManorTables.all.contains(objectType) { ignored.insert(objectType) }
      for table in batch.tableOrder {
        guard let tableChanges = batch.tables[table] else { continue }
        try await applyTable(table, tableChanges)
        touched.insert(table)
      }
      try guardRunning()
      try await store.commit(cursor: batch.lastCursor, ready: true)
      setCursor(batch.lastCursor)
      if changes.count < feedPageSize { break }
    }
    guard applied else { return }
    if touched.contains("job_roles") {
      for table in MirrorTables.jobRoleDependents {
        try await replaceTable(table)
        touched.insert(table)
      }
    }
    let changed = touched.union(ignored)
    if !changed.isEmpty { await publish(changed) }
  }

  private func applyTable(_ table: String, _ changes: TableChanges) async throws {
    try guardRunning()
    if changes.fullRefresh {
      try await replaceTable(table)
      return
    }
    // Local revisions are worth a read only when the feed offers a revision to compare them to; tables
    // without a revision column and recreated rows are always re-read, and so is every row of a table an
    // update can touch without moving its revision.
    let comparable = !MirrorTables.touchedWithoutRevision(table)
      && changes.changes.contains { $0.action == .reread && $0.revision != nil && !$0.recreated }
    let local = comparable ? try await store.revisions(table) : [:]
    let plan = PullPlan.plan(changes, localRevisions: local)
    let fetched = plan.lookups.isEmpty ? [] : try await remote.readIdentities(table, lookups: plan.lookups)
    var found: [String: MirrorRow] = [:]
    for row in fetched {
      let stored = try MirrorRow(table: table, row: row)
      found[stored.key] = stored
    }
    // A row that does not come back is gone or hidden by row-level security, which is a local delete either way.
    let removals = plan.removals + plan.lookups.map(\.key).filter { found[$0] == nil }
    if !removals.isEmpty {
      try guardRunning()
      try await store.deleteRows(table, keys: removals)
    }
    if !found.isEmpty {
      try guardRunning()
      try await store.upsertRows(table, rows: Array(found.values))
    }
  }
}
