import ManorKit
import Observation
import SwiftUI

/// The Jobs page's top-level views: the pipeline (board, then flow) and the listings catalog.
enum JobsView: String, Hashable {
  case pipeline, browse
}

/// The Jobs module's state for the signed-in session: the pipeline, the catalog, resume versions, and the
/// view state that survives switching modules (the chosen view, Browse search, and Browse filters).
@MainActor
@Observable
final class JobsStore {
  private(set) var state: JobsState? {
    didSet { derivePipeline() }
  }
  /// Board cards and the flow, derived once per data change rather than on every render.
  private(set) var cards: [JobBoardCard] = []
  /// Cards per column, most recently changed first.
  private(set) var columns: [JobColumn: [JobBoardCard]] = [:]
  /// Roles waiting on an application, newest posting first.
  private(set) var flowData = JobFlowData.empty
  private(set) var loading = true
  private(set) var loadError: String?
  /// The last failed save, shown above the current view until the next success.
  var persistError: String?

  private(set) var feed: JobFeedPage? {
    didSet { refilter() }
  }
  /// The listings the search and filters accept, recomputed when either changes, never during rendering.
  private(set) var visibleListings: [JobListing] = []
  private(set) var feedLoading = false
  private(set) var feedError: String?
  private(set) var addingListingId: String?
  private(set) var addedListingIds: Set<String> = []
  var addError: String?

  private(set) var resumes: [ResumeVersion] = []
  private(set) var resumesLoaded = false
  private(set) var resumesError: String?

  var view: JobsView = .pipeline
  var browseQuery = "" {
    didSet { if browseQuery != oldValue { refilter() } }
  }
  var browseRules: [BrowseFilterRule] = [] {
    didSet { if browseRules != oldValue { refilter() } }
  }
  /// Cards that just changed column, briefly highlighted where they landed.
  private(set) var arrivedIds: Set<String> = []

  @ObservationIgnored let gateway: Gateway
  @ObservationIgnored private let today: () -> String
  @ObservationIgnored private var watcher: Task<Void, Never>?
  @ObservationIgnored private var reloadGeneration = 0
  @ObservationIgnored private var filterGeneration = 0
  /// Above this many listings, filtering runs off the main actor so typing never stalls.
  private static let backgroundFilterThreshold = 1500

  init(gateway: Gateway, today: @escaping () -> String) {
    self.gateway = gateway
    self.today = today
  }

  var service: JobsService { JobsService(gateway: gateway) }
  var resumesService: ResumesService { ResumesService(gateway: gateway) }

  /// Loads everything once and reloads whenever a Jobs table changes, from here, an agent, or another device.
  func start() {
    guard watcher == nil else { return }
    watcher = Task { [weak self] in
      guard let self else { return }
      await self.reload()
      await self.reloadResumes()
      FileService.shared(for: self.gateway).resumePending(purposes: [.resume])
      for await tables in self.gateway.changes(of: JobsService.tables) {
        if tables.contains("job_roles") || tables.contains("job_stage_transitions") { await self.reload() }
        if self.feed != nil && (tables.contains("job_listings") || tables.contains("job_roles")) { await self.reloadFeed() }
        if tables.contains("resumes") { await self.reloadResumes() }
      }
    }
  }

  func stop() {
    watcher?.cancel()
    watcher = nil
  }

  // MARK: Loading

  func reload() async {
    reloadGeneration += 1
    let generation = reloadGeneration
    do {
      let next = try await service.load(today: today())
      guard generation == reloadGeneration else { return }
      state = next
      loadError = nil
    } catch {
      guard generation == reloadGeneration else { return }
      if state == nil { loadError = error.localizedDescription }
    }
    loading = false
  }

  func reloadFeed() async {
    if feed == nil { feedLoading = true }
    do {
      feed = try await service.feed()
      feedError = nil
    } catch {
      if feed == nil { feedError = error.localizedDescription }
    }
    feedLoading = false
  }

  func loadFeedIfNeeded() {
    guard feed == nil, !feedLoading else { return }
    Task { await reloadFeed() }
  }

  func reloadResumes() async {
    do {
      resumes = try await resumesService.list()
      resumesError = nil
    } catch {
      resumesError = "Could not load resume versions. \(error.localizedDescription)"
    }
    resumesLoaded = true
  }

  // MARK: Derived

  private func derivePipeline() {
    guard let state else {
      cards = []
      columns = [:]
      flowData = JobFlowData.empty
      return
    }
    cards = state.roles.map { JobBoardCard(role: $0, today: state.today) }
    columns = Dictionary(grouping: cards, by: \.column).mapValues { cards in
      cards.sorted { $0.role.updatedAt == $1.role.updatedAt ? $0.role.company < $1.role.company : $0.role.updatedAt > $1.role.updatedAt }
    }
    flowData = JobFlow.data(roles: state.roles, transitions: state.transitions)
  }

  func role(_ id: String) -> JobRole? { state?.role(id) }

  /// Roles that recorded a resume version, so that version cannot be removed.
  func rolesUsing(resume id: String) -> Int { state?.roles.filter { $0.fields.resumeId == id }.count ?? 0 }

  // MARK: Pipeline commands

  func create(_ fields: JobRoleFields) async throws {
    try await service.createRole(fields)
    persistError = nil
    await reload()
  }

  /// Saves the role dialog: stage and every date together.
  func save(roleId: String, fields: JobRoleFields, expectedRevision: Int) async throws {
    let before = role(roleId)
    let previous = before?.stage
    try await service.updateRole(id: roleId, fields: fields, expectedRevision: expectedRevision)
    persistError = nil
    await reload()
    if let previous, previous.column != fields.stage.column { flash(roleId) }
    if let before, before.fields != fields {
      registerRestore(roleId, to: before.fields, name: previous != fields.stage ? "Move Role" : "Edit Role")
    }
  }

  /// Edit > Undo puts a role's fields back, against whatever revision it has by then.
  private func registerRestore(_ roleId: String, to fields: JobRoleFields, name: String) {
    UndoableAction.register(name) { [weak self] in
      guard let self else { return }
      Task {
        guard let current = self.role(roleId) else { return }
        do {
          try await self.service.updateRole(id: roleId, fields: fields, expectedRevision: current.revision)
          await self.reload()
        } catch {
          self.persistError = "Could not undo that change. \(error.localizedDescription)"
        }
      }
    }
  }

  func markOaDone(_ roleId: String) async {
    guard let role = role(roleId), let today = state?.today else { return }
    var fields = role.fields
    fields.oaCompletedDate = today
    do {
      try await service.updateRole(id: roleId, fields: fields, expectedRevision: role.revision)
      persistError = nil
      await reload()
      registerRestore(roleId, to: role.fields, name: "Mark OA Done")
    } catch {
      persistError = "Could not mark the OA done. \(error.localizedDescription)"
    }
  }

  /// Moves a role to Trash and offers Undo while it can still be reversed in place.
  func trash(_ roleId: String, toasts: ToastCenter) async {
    guard let role = role(roleId) else { return }
    do {
      let revision = try await service.trashRole(id: roleId, expectedRevision: role.revision)
      persistError = nil
      await reload()
      guard let revision else {
        toasts.show("\(role.company) moved to Trash")
        return
      }
      toasts.showUndoable("\(role.company) moved to Trash", undoName: "Delete Role") { [weak self] in
        guard let self else { return }
        Task {
          do {
            try await self.service.restoreRole(id: roleId, expectedRevision: revision)
            await self.reload()
          } catch {
            self.persistError = "Could not restore \(role.company). \(error.localizedDescription)"
          }
        }
      }
    } catch {
      persistError = "Could not remove the role. \(error.localizedDescription)"
    }
  }

  private func flash(_ roleId: String) {
    arrivedIds.insert(roleId)
    Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(700))
      _ = withAnimation(Motion.base) { self?.arrivedIds.remove(roleId) }
    }
  }

  // MARK: Catalog

  func addListing(_ listing: JobListing) async {
    guard addingListingId == nil else { return }
    addingListingId = listing.id
    addError = nil
    do {
      try await service.addListing(listing.id)
      addedListingIds.insert(listing.id)
      await reload()
    } catch {
      addError = "Could not add this listing. \(error.localizedDescription)"
    }
    addingListingId = nil
  }

  func isAdded(_ listing: JobListing) -> Bool { listing.added || addedListingIds.contains(listing.id) }

  /// Recomputes `visibleListings`. Large catalogs filter on a background task; a newer keystroke wins.
  private func refilter() {
    filterGeneration += 1
    let generation = filterGeneration
    guard let listings = feed?.listings else {
      visibleListings = []
      return
    }
    let rules = browseRules, query = browseQuery
    if listings.count < Self.backgroundFilterThreshold {
      visibleListings = rules.filter(listings, search: query)
      return
    }
    Task { [weak self] in
      let result = await Task.detached(priority: .userInitiated) { rules.filter(listings, search: query) }.value
      guard let self, generation == self.filterGeneration else { return }
      self.visibleListings = result
    }
  }

  // MARK: Resumes

  func resumeUploaded(_ id: String) async -> ResumeVersion? {
    do {
      let version = try await resumesService.version(id: id)
      if !resumes.contains(where: { $0.id == version.id }) { resumes.insert(version, at: 0) }
      return version
    } catch {
      resumesError = error.localizedDescription
      return nil
    }
  }

  func removeResume(_ id: String) async throws {
    try await resumesService.remove(id)
    resumes.removeAll { $0.id == id }
  }
}
