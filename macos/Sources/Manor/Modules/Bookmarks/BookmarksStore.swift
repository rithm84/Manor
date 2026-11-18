import Foundation
import ManorKit
import Observation

/// The knowledge base as the Bookmarks page shows it: entries, the X connection, and pending work.
@MainActor
@Observable
final class BookmarksStore {
  enum Load: Equatable {
    case loading
    case failed(String)
    case ready
  }

  private(set) var load: Load = .loading
  private(set) var entries: [KnowledgeBase.Entry] = []
  /// A refresh that failed after entries were already showing.
  var notice: String?
  var query = ""
  var openEntryId: String?
  var removeTarget: KnowledgeBase.Entry?
  private(set) var removing = false
  var removeError: String?

  private(set) var xStatus: SettingsDomain.XConnectionStatus?
  private(set) var xStatusError: String?
  private(set) var syncing = false
  var syncNote: (text: String, failed: Bool)?

  @ObservationIgnored private var context: AppContext?
  @ObservationIgnored private var watcher: Task<Void, Never>?
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored private var pollsLeft = 0

  private static let pollInterval: Duration = .seconds(5)
  private static let pollBudget = 12

  func attach(_ context: AppContext) {
    guard self.context !== context else { return }
    self.context = context
    watcher?.cancel()
    watcher = Task { [weak self] in
      await self?.reload()
      await self?.loadXStatus()
      guard let stream = self?.context?.gateway.changes(of: ["kb_entries"]) else { return }
      for await _ in stream {
        guard let self else { return }
        await self.refresh()
      }
    }
  }

  deinit {
    watcher?.cancel()
    poll?.cancel()
  }

  // MARK: Reads

  var captures: [KnowledgeBase.Entry] { visible.filter { $0.source == .capture } }
  var xEntries: [KnowledgeBase.Entry] { visible.filter { $0.source == .xBookmark } }
  var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }
  var openEntry: KnowledgeBase.Entry? { openEntryId.flatMap { id in entries.first { $0.id == id } } }

  private var visible: [KnowledgeBase.Entry] {
    searching ? entries.filter { KnowledgeBase.matches($0, query: query) } : entries
  }

  /// A full reload that resets the pending poll budget.
  func reload() async {
    pollsLeft = Self.pollBudget
    await refresh()
  }

  private func refresh() async {
    guard let context else { return }
    if load != .ready { load = .loading }
    do {
      let rows = try await context.gateway.rows("kb_entries")
      entries = KnowledgeBase.ordered(KnowledgeBase.entries(from: rows))
      load = .ready
      notice = nil
      schedulePoll()
    } catch {
      if load == .ready { notice = error.localizedDescription } else { load = .failed(error.localizedDescription) }
    }
  }

  /// Entries still saving are checked a few times, so their outcome appears without a manual refresh.
  private func schedulePoll() {
    poll?.cancel()
    guard KnowledgeBase.hasPending(entries), pollsLeft > 0 else { return }
    poll = Task { [weak self] in
      try? await Task.sleep(for: Self.pollInterval)
      guard !Task.isCancelled, let self, let context = self.context else { return }
      self.pollsLeft -= 1
      await context.gateway.afterServerWrite(tables: ["kb_entries"])
    }
  }

  func loadXStatus() async {
    guard let context else { return }
    xStatusError = nil
    do {
      xStatus = try await SettingsIntegrations(gateway: context.gateway).xStatus()
    } catch {
      xStatusError = error.localizedDescription
    }
  }

  // MARK: Actions

  func syncX() async {
    guard let context, !syncing else { return }
    syncing = true
    syncNote = nil
    defer { syncing = false }
    do {
      let added = try await SettingsIntegrations(gateway: context.gateway).syncX()
      syncNote = (SettingsDomain.syncSummary(added: added), false)
      await reload()
    } catch {
      syncNote = (error.localizedDescription, true)
    }
  }

  func confirmRemove() async {
    guard let context, let target = removeTarget, !removing else { return }
    removing = true
    removeError = nil
    defer { removing = false }
    do {
      try await context.gateway.command("remove_capture", ["id": .string(target.id), "expected_revision": .number(Double(target.revision))])
      entries.removeAll { $0.id == target.id }
      if openEntryId == target.id { openEntryId = nil }
      removeTarget = nil
      context.toasts.show(target.source == .xBookmark ? "Bookmark removed" : "Capture removed")
    } catch let error as ManorRequestError where error.isConflict {
      removeError = "This entry changed while you were looking. Try again."
      await refresh()
      removeTarget = entries.first { $0.id == target.id }
    } catch {
      removeError = error.localizedDescription
    }
  }

  /// Queues a failed or stuck entry for processing again.
  func retry(_ entry: KnowledgeBase.Entry) async {
    guard let context else { return }
    do {
      try await context.gateway.command("queue_embedding", ["id": .string(entry.id), "expected_revision": .number(Double(entry.revision))])
      await reload()
    } catch {
      let message = error.localizedDescription
      notice = message
      if let index = entries.firstIndex(where: { $0.id == entry.id }) {
        entries[index].status = .failed
        entries[index].error = message
      }
    }
  }
}
