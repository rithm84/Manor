import AppKit
import Foundation
import Network
import Supabase
import Synchronization

/// The account's local mirror: answers reads from the SQLite copy while it is current, and keeps it current
/// with pokes followed by pulls.
///
/// Pokes come from the launch, this device's own commands (`afterCommand`), a one-minute timer, the app
/// becoming active, the network coming back, and Realtime inserts on `action_events` for the account (except
/// the echoes of commands this device issued). Reads never wait for a pull: they check lock-protected flags
/// and read the last committed state of the WAL file while a pull writes.
public final class MirrorSync: LocalMirror, @unchecked Sendable {
  /// How often the mirror catches up on its own, so a missed poke costs a minute rather than a session.
  static let pokeInterval: Duration = .seconds(60)
  /// Feed-less tables change on the server's schedule, so they are replaced on launch and on this cadence.
  static let feedlessInterval: Duration = .seconds(3_600)

  public let accountId: String
  let store: MirrorStore
  let flags: MirrorFlags
  let account: AccountSync
  let catalog: CatalogSync
  private let client: SupabaseClient?
  private let isIssued: @Sendable (UUID) async -> Bool
  private let running = Mutex<[Task<Void, Never>]>([])
  private let monitor = Mutex<NWPathMonitor?>(nil)
  private let channel = Mutex<RealtimeChannelV2?>(nil)

  init(accountId: String, store: MirrorStore, status: MirrorStatus, remote: MirrorRemote, client: SupabaseClient?,
       publish: @escaping MirrorPublish, isIssued: @escaping @Sendable (UUID) async -> Bool) {
    self.accountId = accountId
    self.store = store
    self.client = client
    self.isIssued = isIssued
    let flags = MirrorFlags()
    self.flags = flags
    account = AccountSync(accountId: accountId, store: store, remote: remote, flags: flags, status: status, publish: publish)
    catalog = CatalogSync(accountId: accountId, store: store, remote: remote, flags: flags, status: status, publish: publish)
  }

  // MARK: Opening

  /// Opens this account's file and starts the mirror behind the gateway. Returns nil when the file cannot be
  /// opened: the mirror is a copy, not the record, so Manor then reads the server one round trip at a time.
  @MainActor
  public static func open(gateway: Gateway) async -> MirrorSync? {
    let accountId = gateway.accountId
    let environment = gateway.config.environment
    let opened = await Task.detached(priority: .userInitiated) { () -> Result<(MirrorStore, MirrorStatus), Error> in
      Result {
        let directory = try MirrorFiles.directory(bundleIdentifier: Bundle.main.bundleIdentifier, environment: environment)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = try MirrorFiles.file(in: directory, accountId: accountId)
        MirrorRegistry.close(accountId)
        MirrorFiles.sweep(directory, keeping: accountId)
        return try MirrorStore.open(at: file, accountId: accountId)
      }
    }.value
    switch opened {
    case .failure(let error):
      mirrorLog.error("Manor could not open the local mirror, so reads stay on the server: \(error.localizedDescription, privacy: .public)")
      return nil
    case .success(let (store, status)):
      mirrorLog.info("Mirror opened (ready \(status.ready), cursor \(status.cursor), catalog ready \(status.catalogReady), catalog cursor \(status.catalogCursor), \(status.totalRows) rows)")
      let link = GatewayLink(gateway)
      let remote = SupabaseRemote(client: gateway.client, accountId: accountId) { connected in await link.markConnected(connected) }
      let mirror = MirrorSync(
        accountId: accountId, store: store, status: status, remote: remote, client: gateway.client,
        publish: { tables in await link.publish(tables) }, isIssued: { id in await link.issued(id) }
      )
      MirrorRegistry.register(store)
      mirror.start()
      return mirror
    }
  }

  /// Installs the pokes and runs the launch pass. The catalog's first fill downloads a snapshot of tens of
  /// megabytes, so nothing waits for it.
  func start() {
    track(Task { await self.catalog.pull() })
    track(Task { await self.account.pull() })
    installPokes()
  }

  private func track(_ task: Task<Void, Never>) {
    running.withLock { $0.append(task) }
  }

  /// Pulls both copies without waiting for either.
  func poke() {
    guard !flags.stopped else { return }
    Task { await self.account.pull() }
    Task { await self.catalog.pull() }
  }

  private func installPokes() {
    track(Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.pokeInterval)
        guard !Task.isCancelled, let self else { return }
        self.poke()
      }
    })
    track(Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.feedlessInterval)
        guard !Task.isCancelled, let self else { return }
        await self.account.refreshFeedless()
      }
    })
    track(Task { [weak self] in
      let activations = NotificationCenter.default.notifications(named: NSApplication.didBecomeActiveNotification).map { _ in () }
      for await _ in activations {
        guard !Task.isCancelled, let self else { return }
        self.poke()
      }
    })
    let path = NWPathMonitor()
    let wasOnline = Mutex(true)
    path.pathUpdateHandler = { [weak self] update in
      let online = update.status == .satisfied
      let cameBack = wasOnline.withLock { previous in
        defer { previous = online }
        return online && !previous
      }
      if cameBack { self?.poke() }
    }
    path.start(queue: DispatchQueue(label: "app.manor.mirror.network"))
    monitor.withLock { $0 = path }
    if let client { track(Task { [weak self] in await self?.listen(client) }) }
  }

  /// Follows inserts on this account's `action_events`, which every committed command writes, from any device or agent.
  private func listen(_ client: SupabaseClient) async {
    let topic = client.channel("manor-mirror:\(accountId)")
    channel.withLock { $0 = topic }
    let inserts = topic.postgresChange(InsertAction.self, schema: "public", table: "action_events", filter: .eq("user_id", value: accountId))
    do {
      try await topic.subscribeWithError()
    } catch {
      if !Task.isCancelled {
        mirrorLog.error("Manor realtime subscription failed; the mirror catches up on its timer: \(error.localizedDescription, privacy: .public)")
      }
      return
    }
    for await insert in inserts {
      if Task.isCancelled || flags.stopped { return }
      // This device's own commands pulled before their receipt returned, so their echo carries nothing new.
      if let text = insert.record["command_id"]?.stringValue, let id = UUID(uuidString: text), await isIssued(id) { continue }
      Task { await self.account.pull() }
    }
  }

  // MARK: LocalMirror

  public func isServing(_ table: String) async -> Bool { flags.serves(table) }

  public func rows(_ table: String, filters: [RowFilter]) async throws -> [Row]? {
    guard MirrorTables.isMirrored(table), flags.serves(table) else { return nil }
    do {
      return MirrorRows.sorted(table, try await store.rows(table, filters: filters))
    } catch {
      // A copy that cannot be read is no reason to fail a page; the server still answers.
      mirrorLog.error("Manor could not read \(table, privacy: .public) from the local mirror: \(error.localizedDescription, privacy: .public)")
      return nil
    }
  }

  public func row(_ table: String, key: String) async throws -> MirrorLookup {
    guard flags.serves(table) else { return .notServing }
    do {
      let stored = try await store.row(table, key: key)
      // A pull that stopped serving while the read ran may have left the row half applied.
      guard flags.serves(table) else { return .notServing }
      return .row(stored?.data)
    } catch {
      mirrorLog.error("Manor could not read \(table, privacy: .public) from the local mirror: \(error.localizedDescription, privacy: .public)")
      return .notServing
    }
  }

  /// While the mirror is serving, a pull leads the page's refetch, so the page finds its own change on disk.
  /// Until then pages read the server anyway, and waiting here would park a save behind a bootstrap.
  public func afterCommand() async {
    if flags.accountServing {
      await account.pull()
    } else {
      Task { await self.account.pull() }
    }
  }

  /// Serves an account-derived read from the cache while both the cursor and the account-local day still match
  /// the ones it was computed under.
  public func derived(_ name: String, day: String, load: @Sendable () async throws -> JSONValue) async throws -> JSONValue {
    guard flags.accountServing else { return try await load() }
    if let cached = try? await store.derived(name), cached.cursor == flags.cursor, cached.day == day { return cached.value }
    // Reading the cursor before the RPC means a change that commits while it runs invalidates this value
    // instead of hiding underneath a cursor the value never saw.
    let cursor = flags.cursor
    let value = try await load()
    // A sign-out during the RPC leaves the answer good for this caller and the cache somebody else's.
    if flags.stopped { return value }
    do { try await store.putDerived(name, value: value, cursor: cursor, day: day) }
    catch { mirrorLog.error("Manor could not cache \(name, privacy: .public) in the local mirror: \(error.localizedDescription, privacy: .public)") }
    return value
  }

  public func stop() async {
    flags.stop()
    for task in running.withLock({ tasks -> [Task<Void, Never>] in defer { tasks = [] }; return tasks }) { task.cancel() }
    monitor.withLock { $0?.cancel(); $0 = nil }
    if let topic = channel.withLock({ current -> RealtimeChannelV2? in defer { current = nil }; return current }), let client {
      await client.removeChannel(topic)
    }
  }
}

/// The gateway as the mirror reaches it: weakly, on the main actor.
@MainActor
final class GatewayLink {
  private weak var gateway: Gateway?
  init(_ gateway: Gateway) { self.gateway = gateway }
  func publish(_ tables: Set<String>) { gateway?.publish(tables) }
  func markConnected(_ connected: Bool) { gateway?.markConnected(connected) }
  func issued(_ id: UUID) -> Bool { gateway?.issuedCommand(id) ?? false }
}

/// The open mirror files, so sign-out can close a file before deleting it.
enum MirrorRegistry {
  private static let stores = Mutex<[String: MirrorStore]>([:])

  static func register(_ store: MirrorStore) {
    stores.withLock { $0[store.accountId] = store }
  }

  /// Closes the file a previous session of this account left open.
  static func close(_ accountId: String) {
    stores.withLock { $0.removeValue(forKey: accountId) }?.close()
  }

  static func take(_ accountId: String) -> MirrorStore? {
    stores.withLock { $0.removeValue(forKey: accountId) }
  }
}
