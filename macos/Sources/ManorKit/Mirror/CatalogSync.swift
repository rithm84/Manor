import Foundation

/// Keeps the shared problem catalog in the local mirror current and says when it can answer reads.
///
/// The catalog is the same for every account, so it does not ride the account's change feed: a first sync
/// downloads the published snapshot (`CatalogSnapshot`), and from then on the copy walks `manor_catalog_changes`
/// past its own cursor, re-reading changed rows without an owner filter and deleting the ones the feed reports
/// deleted or that no longer come back. Until the copy is complete, catalog reads go to the server.
///
/// It runs on a gate of its own: its tables and meta keys are disjoint from the account copy's, and a snapshot
/// download must never hold up the pull that follows a save.
actor CatalogSync {
  static let maxFeedBatches = 100
  /// Rows per store write while a snapshot loads, so no single transaction carries megabytes of statements.
  static let snapshotWriteRows = 500

  let accountId: String
  private let store: MirrorStore
  private let remote: MirrorRemote
  private let flags: MirrorFlags
  private let publish: MirrorPublish
  private let gate = SerialGate()
  private var queued: Task<Void, Never>?
  private var ready: Bool
  private var cursor: Int

  // A snapshot load in progress: which stored tables it has started, and rows waiting for a write.
  private var started = Set<String>()
  private var pendingProblems: [Row] = []
  private var pendingContents: [Row] = []

  init(accountId: String, store: MirrorStore, remote: MirrorRemote, flags: MirrorFlags, status: MirrorStatus, publish: @escaping MirrorPublish) {
    self.accountId = accountId
    self.store = store
    self.remote = remote
    self.flags = flags
    self.publish = publish
    ready = status.catalogReady
    cursor = status.catalogCursor
    flags.setCatalogServing(status.catalogReady)
  }

  /// Catches the catalog up. Pokes that arrive while one pull runs collapse into a single follow-up.
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

  private func guardRunning() throws {
    if flags.stopped { throw MirrorAbandoned(accountId: accountId) }
  }

  private func run() async {
    guard !flags.stopped else { return }
    do {
      let head = try await remote.feedCursor(.catalog)
      if CatalogSnapshot.needsManifest(ready: ready, cursor: cursor, head: head) {
        let manifest = try await readManifest()
        switch CatalogSnapshot.plan(ready: ready, cursor: cursor, head: head, manifestCursor: manifest?.cursor) {
        case .snapshot:
          guard let manifest else { throw MirrorError("The catalog plan chose a snapshot without a manifest") }
          try await loadSnapshot(manifest)
        case .tables:
          try await loadTables(head: head)
        case .feed:
          break
        }
      }
      try await applyFeed()
      flags.setCatalogServing(ready)
    } catch is MirrorAbandoned {
      return
    } catch {
      let offline = error is ManorConnectionError
      if !offline { flags.setCatalogServing(false) }
      mirrorLog.error("Manor could not refresh the problem catalog in the local mirror (cursor \(self.cursor), ready \(self.ready), offline \(offline)): \(error.localizedDescription, privacy: .public)")
    }
  }

  /// The published manifest, or nil when none is published yet; a first sync then reads the tables instead.
  private func readManifest() async throws -> CatalogSnapshot.Manifest? {
    guard let data = try await remote.download(bucket: CatalogSnapshot.bucket, path: CatalogSnapshot.manifestPath) else {
      mirrorLog.notice("No problem catalog snapshot is published, so the catalog copy reads the tables instead")
      return nil
    }
    return try CatalogSnapshot.parseManifest(try MirrorJSON.parse(data))
  }

  /// Marks the copy incomplete before rewriting it, so an interrupted fill starts over instead of serving half a catalog.
  private func startFill() async throws {
    try guardRunning()
    flags.setCatalogServing(false)
    ready = false
    try await store.commitCatalog(cursor: cursor, ready: false)
  }

  private func finishFill(cursor head: Int) async throws {
    try guardRunning()
    try await store.commitCatalog(cursor: head, ready: true)
    cursor = head
    ready = true
    flags.setCatalogServing(true)
    await publish(Set(MirrorTables.catalogTables))
  }

  private func writeStored(_ table: String, _ rows: [MirrorRow], replace: Bool) async throws {
    try guardRunning()
    if replace { try await store.replaceTable(table, rows: rows) } else { try await store.upsertRows(table, rows: rows) }
  }

  /// The stored rows of a batch of `problem_catalog` rows: index rows, the detail rows some carry, and the keys
  /// whose detail is gone.
  private static func parts(_ rows: [Row]) throws -> (index: [MirrorRow], details: [MirrorRow], bare: [String]) {
    var index: [MirrorRow] = []
    var details: [MirrorRow] = []
    var bare: [String] = []
    for row in rows {
      let parts = try CatalogRows.split(row)
      index.append(parts.index)
      if let detail = parts.detail { details.append(detail) } else { bare.append(parts.index.key) }
    }
    return (index, details, bare)
  }

  // MARK: Snapshot

  /// Downloads the snapshot, checks it against its manifest, and streams its rows into the copy.
  private func loadSnapshot(_ manifest: CatalogSnapshot.Manifest) async throws {
    guard let data = try await remote.download(bucket: CatalogSnapshot.bucket, path: manifest.path) else {
      throw MirrorError("The catalog snapshot \(manifest.path) named by the manifest is not published")
    }
    try CatalogSnapshot.verify(data, against: manifest)
    try await startFill()
    started = []
    pendingProblems = []
    pendingContents = []
    let inflater = GzipInflater(data)
    var progress = CatalogSnapshot.Progress()
    while let chunk = try inflater.next() {
      try await add(try CatalogSnapshot.readChunk(&progress, chunk, manifest))
    }
    let last = try CatalogSnapshot.finish(&progress, manifest)
    try await add(last.entries)
    try await flushProblems()
    try await flushContents()
    // A table the snapshot holds no rows for is emptied, so problems it no longer holds disappear.
    for table in [MirrorTables.catalogDetailTable, "problem_catalog", "problem_catalog_content"] where !started.contains(table) {
      try await storeSnapshot(table, [])
    }
    try await finishFill(cursor: last.header.cursor)
  }

  private func add(_ entries: [CatalogSnapshot.Entry]) async throws {
    for entry in entries {
      if entry.type == .problem { pendingProblems.append(entry.row) } else { pendingContents.append(entry.row) }
      if pendingProblems.count >= Self.snapshotWriteRows { try await flushProblems() }
      if pendingContents.count >= Self.snapshotWriteRows { try await flushContents() }
    }
  }

  /// Detail rows are written before the index rows that point at them.
  private func flushProblems() async throws {
    guard !pendingProblems.isEmpty else { return }
    let parts = try Self.parts(pendingProblems)
    pendingProblems = []
    if !parts.details.isEmpty { try await storeSnapshot(MirrorTables.catalogDetailTable, parts.details) }
    try await storeSnapshot("problem_catalog", parts.index)
  }

  private func flushContents() async throws {
    guard !pendingContents.isEmpty else { return }
    let rows = try pendingContents.map { try MirrorRow(table: "problem_catalog_content", row: $0) }
    pendingContents = []
    try await storeSnapshot("problem_catalog_content", rows)
  }

  /// The first write to each table replaces it, and later writes add to it.
  private func storeSnapshot(_ table: String, _ rows: [MirrorRow]) async throws {
    let replace = !started.contains(table)
    started.insert(table)
    try await writeStored(table, rows, replace: replace)
  }

  /// Reads both catalog tables from the server. `head` was read first, so anything committed meanwhile follows
  /// as feed changes.
  private func loadTables(head: Int) async throws {
    try await startFill()
    let problems = try await remote.readTable("problem_catalog", filters: [])
    let parts = try Self.parts(problems)
    try await writeStored(MirrorTables.catalogDetailTable, parts.details, replace: true)
    try await writeStored("problem_catalog", parts.index, replace: true)
    let contents = try await remote.readTable("problem_catalog_content", filters: [])
    try await writeStored("problem_catalog_content", try contents.map { try MirrorRow(table: "problem_catalog_content", row: $0) }, replace: true)
    try await finishFill(cursor: head)
  }

  // MARK: Feed

  private func applyFeed() async throws {
    guard ready else { throw MirrorError("The problem catalog walks its feed only once the copy is complete") }
    var touched = Set<String>()
    var page = 0
    while true {
      if page == Self.maxFeedBatches {
        ready = false
        throw MirrorError("The catalog feed offered more than \(Self.maxFeedBatches * feedPageSize) changes at once; the next pass loads a snapshot instead")
      }
      page += 1
      let changes = try await remote.feedChanges(.catalog, since: cursor, limit: feedPageSize)
      try guardRunning()
      if changes.isEmpty { break }
      let batch = try PullPlan.group(changes, since: cursor)
      if !batch.ignored.isEmpty {
        throw MirrorError("The catalog feed named object types the catalog does not hold: \(batch.ignored.joined(separator: ", "))")
      }
      for table in batch.tableOrder {
        guard let tableChanges = batch.tables[table] else { continue }
        guard MirrorTables.isCatalogTable(table) else { throw MirrorError("The catalog feed named \(table), which is not a catalog table") }
        try await applyTable(table, tableChanges)
        touched.insert(table)
      }
      try guardRunning()
      try await store.commitCatalog(cursor: batch.lastCursor, ready: true)
      cursor = batch.lastCursor
      if changes.count < feedPageSize { break }
    }
    if !touched.isEmpty { await publish(touched) }
  }

  /// Deletes what the feed removed or what no longer comes back, and stores what was re-read.
  private func applyTable(_ table: String, _ changes: TableChanges) async throws {
    try guardRunning()
    if changes.fullRefresh {
      throw MirrorError("The catalog feed named a \(table) row without its key; the catalog feed always names \(table == "problem_catalog" ? "id" : "problem_id")")
    }
    let comparable = changes.changes.contains { $0.action == .reread && $0.revision != nil && !$0.recreated }
    let local = comparable ? try await store.revisions(table) : [:]
    let plan = PullPlan.plan(changes, localRevisions: local)
    let fetched = plan.lookups.isEmpty ? [] : try await remote.readIdentities(table, lookups: plan.lookups)
    try guardRunning()
    var found: [String: Row] = [:]
    for row in fetched { found[try MirrorTables.rowKey(table, row)] = row }
    let removals = plan.removals + plan.lookups.map(\.key).filter { found[$0] == nil }
    if !removals.isEmpty {
      try await store.deleteRows(table, keys: removals)
      // A deleted problem takes its evidence and statement with it, whether or not the feed also names the statement.
      if table == "problem_catalog" {
        try await store.deleteRows(MirrorTables.catalogDetailTable, keys: removals)
        try await store.deleteRows("problem_catalog_content", keys: removals)
      }
    }
    guard !found.isEmpty else { return }
    try guardRunning()
    if table == "problem_catalog_content" {
      try await store.upsertRows(table, rows: try found.values.map { try MirrorRow(table: table, row: $0) })
      return
    }
    let parts = try Self.parts(Array(found.values))
    if !parts.details.isEmpty { try await store.upsertRows(MirrorTables.catalogDetailTable, rows: parts.details) }
    if !parts.bare.isEmpty { try await store.deleteRows(MirrorTables.catalogDetailTable, keys: parts.bare) }
    try await store.upsertRows(table, rows: parts.index)
  }
}
