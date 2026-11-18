import Foundation
import ManorKit
import Observation

enum WorkspaceReaderTab: Hashable { case description, submissions, solution }
enum WorkspaceConsoleTab: Hashable { case testcase, result }

/// Where the caret and scroll were in one language's editor, restored when the editor returns.
struct WorkspaceEditorViewState: Equatable {
  var selection: NSRange
  var scroll: CGPoint
}

/// One problem's workspace state: the statement, the editor's language and code with its draft session, the console's
/// cases and results, and the submission history. Models outlive their views (see `ProblemWorkspaceStates`), so
/// leaving a problem and coming back finds the same language, caret, scroll, cases, and results.
@MainActor
@Observable
final class ProblemWorkspaceModel {
  let problemId: String
  let services: ProblemWorkspaceServices
  var accountId: String { services.accountId }

  // Statement
  private(set) var detail: ProblemDetail?
  private(set) var loadError: String?
  private(set) var isLoading = false

  // Editor
  private(set) var language: ProblemLanguage?
  /// The editor's current source. Not observed, so typing never re-renders the workspace; `hasCode` is.
  @ObservationIgnored private(set) var code: String? { didSet { if hasCode != (code != nil) { hasCode = code != nil } } }
  private(set) var hasCode = false
  private(set) var codeLanguage: ProblemLanguage?
  /// Bumps whenever the code is replaced from outside the editor (cloud draft, reset, a submission's code).
  private(set) var editorRevision = 0
  private(set) var draftStatus: CodeDraftStatus = .loading
  var editorViewStates: [ProblemLanguage: WorkspaceEditorViewState] = [:]
  var fontSize = ProblemWorkspacePreferences.fontSize { didSet { ProblemWorkspacePreferences.fontSize = fontSize } }
  var tabSize = ProblemWorkspacePreferences.tabSize { didSet { ProblemWorkspacePreferences.tabSize = tabSize } }
  var fullscreen = false
  /// The account's time zone, for submission times.
  var timeZone: TimeZone = .current
  var error: String?

  // Console
  var cases: [Testcase] = []
  private(set) var exampleCases: [Testcase] = []
  var selectedCase = 0
  var invalidCase: InvalidTestcase?
  var stdinInput = ""
  var consoleTab: WorkspaceConsoleTab = .testcase
  var consoleOpen = ProblemWorkspacePreferences.consoleOpen { didSet { ProblemWorkspacePreferences.consoleOpen = consoleOpen } }
  /// The mode of the execution in flight; Run, Submit, language changes, and case edits wait for it.
  private(set) var running: ProblemExecutionMode?
  private(set) var submission: ProblemSubmission?
  private(set) var pendingExecution: ExecuteProblemInput?
  private(set) var resultError: String?

  // Reader
  var readerTab: WorkspaceReaderTab = .description
  private(set) var history: [ProblemSubmission] = []
  private(set) var historyError: String?
  private(set) var openingSubmission: String?
  var openedSubmission: ProblemSubmission?

  // Dialogs
  var showConflict = false
  var confirmReset = false
  var replacement: ProblemSubmission?
  private(set) var resolvingConflict = false

  @ObservationIgnored private var draftSession: ProblemDraftSession?
  @ObservationIgnored private var draftLoad: Task<Void, Never>?
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored private var adoptedSource: (language: ProblemLanguage, code: String)?
  @ObservationIgnored private var changes: Task<Void, Never>?
  @ObservationIgnored private var started = false

  init(problemId: String, services: ProblemWorkspaceServices) {
    self.problemId = problemId
    self.services = services
  }

  var busy: Bool { running != nil }
  var coding: Bool { detail?.canExecute ?? false }
  var fields: [TestcaseField]? { detail?.content?.interface.map(ProblemTestcases.fields) }
  var languages: [ProblemLanguage] { detail?.content?.languages ?? ProblemLanguage.allCases }
  var draftConflict: CloudCodeDraft? { draftSession?.conflict }
  var solved: Bool {
    detail?.problem.status == .solved || history.contains { $0.mode == .submit && $0.verdict == .accepted }
  }
  var canRun: Bool {
    guard hasCode, let detail else { return false }
    return detail.gradingAvailable || fields != nil || !stdinInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
  var canSubmit: Bool { hasCode && (detail?.gradingAvailable ?? false) }
  /// A judged submission shown in the reader follows the console's polling while it is still in flight.
  var shownSubmission: ProblemSubmission? {
    guard let openedSubmission else { return nil }
    if let submission, submission.id == openedSubmission.id { return submission }
    return openedSubmission
  }

  // MARK: Loading

  /// Loads the problem once; later appearances keep the state as it was.
  func start() {
    guard !started else { return }
    started = true
    Task { await load() }
    changes = Task { [weak self, gateway = services.gateway] in
      for await _ in gateway.changes(of: ["leetcode_attempts", "problem_practice", "problem_catalog", "problem_catalog_content", "leetcode_problems", "problem_content_versions"]) {
        guard let self else { return }
        await self.refreshDetail()
      }
    }
  }

  func load() async {
    isLoading = true
    loadError = nil
    defer { isLoading = false }
    do {
      let loaded = try await services.details.load(problemId)
      apply(loaded)
    } catch {
      loadError = error.localizedDescription
    }
  }

  private func refreshDetail() async {
    guard let current = detail, let loaded = try? await services.details.load(problemId) else { return }
    // A new statement version restarts the editor on that version; otherwise only status and labels change.
    if loaded.problem.contentVersion != current.problem.contentVersion || loaded.canExecute != current.canExecute { apply(loaded) } else { detail = loaded }
  }

  private func apply(_ loaded: ProblemDetail) {
    let first = detail == nil
    detail = loaded
    if let spec = loaded.content?.interface {
      let examples = ProblemTestcases.exampleCases(spec, loaded.content?.examples ?? [])
      if first || ProblemTestcases.same(cases, exampleCases) { cases = examples; selectedCase = 0 }
      exampleCases = examples
    }
    guard loaded.canExecute else { return }
    let preferred = ProblemWorkspacePreferences.language
    let resolved = languages.contains(preferred) ? preferred : languages.first
    openLanguage(resolved)
    loadHistory()
  }

  // MARK: Drafts

  /// Opens the language's draft session: the editor mounts with this device's draft at once; the cloud draft
  /// replaces it only while it is unedited.
  private func openLanguage(_ next: ProblemLanguage?) {
    draftLoad?.cancel()
    if let session = draftSession { session.stop(); services.unregister(session) }
    draftSession = nil
    language = next
    guard let next, let detail else { return }
    if codeLanguage != next { code = nil }
    draftStatus = .loading
    error = nil
    let store: CodeDraftStore
    do { store = try services.draftStore() } catch {
      self.error = "Your code can't be protected on this Mac: \(error.localizedDescription)"
      draftStatus = .failed
      return
    }
    let session = ProblemDraftSession(
      accountId: accountId, problemId: detail.problem.id, language: next, contentVersion: detail.problem.contentVersion,
      store: store, boundary: ProblemWorkspaceServices.boundary, cloud: services.cloud
    ) { [weak self] status, message in
      guard let self, self.language == next else { return }
      // Each keystroke reports protecting and protected; unchanged values never re-render the toolbar.
      if self.draftStatus != status { self.draftStatus = status }
      if let message { self.error = message }
    }
    draftSession = session
    services.register(session)
    let starter = detail.content?.starterCode[next] ?? ""
    draftLoad = Task { [weak self] in
      do {
        let initial = try await session.open(starterCode: starter)
        guard let self, !Task.isCancelled, self.draftSession === session else { return }
        if let adopted = self.adoptedSource, adopted.language == next {
          self.adoptedSource = nil
          // Adopted code is an edit, so it starts from the cloud revision rather than conflicting with it.
          _ = await session.reconciled()
          guard self.draftSession === session else { return }
          self.setCode(adopted.code, language: next, replace: true)
          session.protect(adopted.code)
          return
        }
        self.setCode(initial, language: next, replace: false)
        if let replacement = await session.reconciled(), self.draftSession === session { self.setCode(replacement, language: next, replace: true) }
      } catch {
        guard let self, self.draftSession === session else { return }
        self.error = error.localizedDescription
        self.draftStatus = .failed
      }
    }
  }

  private func setCode(_ value: String, language: ProblemLanguage, replace: Bool) {
    code = value
    codeLanguage = language
    if replace { editorRevision += 1 }
  }

  /// The editor reports every edit; it is protected on this Mac before anything else happens.
  func edited(_ value: String) {
    guard value != code, let session = draftSession else { return }
    code = value
    session.protect(value)
  }

  /// Runs `action` once every edit so far is durable on this Mac.
  func afterProtected(_ action: @escaping () -> Void) {
    Task {
      do { try await draftSession?.protected(); action() } catch { self.error = error.localizedDescription }
    }
  }

  func chooseLanguage(_ next: ProblemLanguage) {
    guard next != language, !busy else { return }
    afterProtected { [weak self] in
      ProblemWorkspacePreferences.language = next
      self?.openLanguage(next)
    }
  }

  func keepLocal() async {
    resolvingConflict = true
    defer { resolvingConflict = false }
    do { try await draftSession?.keepLocal(); showConflict = false; error = nil } catch { self.error = error.localizedDescription }
  }

  func useCloud() async {
    resolvingConflict = true
    defer { resolvingConflict = false }
    do {
      guard let session = draftSession, let language else { return }
      let source = try await session.useCloud()
      setCode(source, language: language, replace: true)
      showConflict = false
      error = nil
    } catch { self.error = error.localizedDescription }
  }

  func retryDraft() async {
    error = nil
    do {
      guard let session = draftSession, let language else { return }
      let source = try await session.retry()
      if source != code { setCode(source, language: language, replace: true) }
    } catch { self.error = error.localizedDescription }
  }

  func resolveDraft() {
    if draftConflict != nil { showConflict = true } else { Task { await retryDraft() } }
  }

  func resetCode() {
    guard let language, let session = draftSession else { return }
    let starter = detail?.content?.starterCode[language] ?? ""
    setCode(starter, language: language, replace: true)
    session.protect(starter)
    confirmReset = false
  }

  /// Loads submitted code through the draft session, so it is protected exactly like typing.
  func useSubmissionCode(_ saved: ProblemSubmission) {
    replacement = nil
    guard let source = saved.sourceCode else { error = "This submission has no saved code to load."; return }
    if saved.language == language, let session = draftSession {
      setCode(source, language: saved.language, replace: true)
      session.protect(source)
      return
    }
    adoptedSource = (saved.language, source)
    afterProtected { [weak self] in
      ProblemWorkspacePreferences.language = saved.language
      self?.openLanguage(saved.language)
    }
  }

  func requestSubmissionCode(_ saved: ProblemSubmission) {
    if saved.language == language, saved.sourceCode == code { return }
    replacement = saved
  }

  func canUseCode(_ value: ProblemLanguage) -> Bool { !busy && hasCode && languages.contains(value) }

  // MARK: Run and Submit

  /// Unchanged examples run as the testset's public cases so results carry expected answers; edited cases run as
  /// custom input.
  private func runInput() -> Result<String?, WorkspaceMessage> {
    guard let detail else { return .failure(WorkspaceMessage("This problem has not loaded.")) }
    guard let fields else {
      if !stdinInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .success(stdinInput) }
      return detail.gradingAvailable ? .success(nil) : .failure(WorkspaceMessage("Add input to run your code."))
    }
    if let invalid = ProblemTestcases.firstInvalid(fields, cases) {
      invalidCase = invalid
      selectedCase = invalid.caseIndex
      consoleTab = .testcase
      consoleOpen = true
      return .failure(WorkspaceMessage(invalid.message))
    }
    return .success(detail.gradingAvailable && ProblemTestcases.same(cases, exampleCases) ? nil : ProblemTestcases.input(cases))
  }

  func run() {
    guard !busy, hasCode, canRun else { return }
    switch runInput() {
    case .failure(let message): error = message.text; consoleOpen = true
    case .success(let input): execute(.run, customInput: input)
    }
  }

  func submit() {
    guard !busy, hasCode, detail?.gradingAvailable == true else { return }
    execute(.submit, customInput: nil)
  }

  private func execute(_ mode: ProblemExecutionMode, customInput: String?) {
    guard let language, let detail else { return }
    running = mode
    error = nil
    invalidCase = nil
    Task {
      do {
        try await draftSession?.protected()
        await deliver(ExecuteProblemInput(problemId: detail.problem.id, language: language, code: code ?? "", mode: mode, customInput: customInput))
      } catch {
        self.error = error.localizedDescription
        running = nil
      }
    }
  }

  /// Sends one execution; a retry reuses its request id so the runner replays the same submission.
  func deliver(_ request: ExecuteProblemInput) async {
    running = request.mode
    error = nil
    resultError = nil
    consoleTab = .result
    consoleOpen = true
    pendingExecution = request
    do {
      let next = try await services.execution.execute(request)
      pendingExecution = nil
      show(next)
    } catch {
      self.error = error.localizedDescription
      running = nil
    }
  }

  func retryExecution() {
    guard let pendingExecution, !busy else { return }
    Task { await deliver(pendingExecution) }
  }

  private func show(_ next: ProblemSubmission) {
    submission = next
    if next.isPending { startPolling(next) } else { finish(next) }
  }

  /// A submission still running when its request returns is polled 300 ms later, then less often, settling at
  /// once a second.
  private func startPolling(_ pending: ProblemSubmission) {
    poll?.cancel()
    poll = Task { [weak self] in
      var attempt = 0
      while !Task.isCancelled {
        try? await Task.sleep(for: ProblemSubmissionStats.pollDelay(attempt: attempt))
        guard let self, !Task.isCancelled else { return }
        attempt += 1
        do {
          let next = try await self.services.execution.submission(pending.id)
          self.submission = next
          self.resultError = nil
          if self.openedSubmission?.id == next.id { self.openedSubmission = next }
          if !next.isPending { self.finish(next); return }
        } catch {
          self.resultError = error.localizedDescription
          return
        }
      }
    }
  }

  func retryResults() {
    resultError = nil
    if let submission, submission.isPending { startPolling(submission) }
  }

  /// A finished submission refreshes history; a judged Submit opens in the reader, as LeetCode does.
  private func finish(_ next: ProblemSubmission) {
    running = nil
    loadHistory()
    // An accepted submission records an attempt on the server; the mirror pulls it so the library shows it.
    if next.mode == .submit {
      let gateway = services.gateway
      Task { await gateway.afterServerWrite(tables: ["leetcode_attempts", "problem_practice"]) }
    }
    guard next.mode == .submit else { return }
    readerTab = .submissions
    openedSubmission = next
    if next.sourceCode == nil { openSubmission(next.id) }
  }

  // MARK: History

  func loadHistory() {
    guard coding else { return }
    Task {
      do {
        history = try await services.execution.submissions(problemId: detail?.problem.id ?? problemId)
        historyError = nil
      } catch { historyError = error.localizedDescription }
    }
  }

  /// Opens a saved submission in the reader with its code; one still being judged also takes over the console so it
  /// keeps polling.
  func openSubmission(_ id: String) {
    openingSubmission = id
    historyError = nil
    Task {
      defer { openingSubmission = nil }
      do {
        let saved = try await services.execution.submission(id)
        openedSubmission = saved
        if saved.isPending, !busy {
          submission = saved
          resultError = nil
          consoleTab = .result
          running = saved.mode
          startPolling(saved)
        }
      } catch { historyError = error.localizedDescription }
    }
  }

  // MARK: Console cases

  func editCase(field: Int, value: String) {
    guard cases.indices.contains(selectedCase), cases[selectedCase].values.indices.contains(field) else { return }
    cases[selectedCase].values[field] = value
    invalidCase = nil
  }

  func addCase() {
    let current = cases.indices.contains(selectedCase) ? cases[selectedCase].values : (fields ?? []).map { _ in "" }
    cases.append(Testcase(values: current))
    selectedCase = cases.count - 1
    invalidCase = nil
  }

  func removeCase(_ index: Int) {
    guard cases.count > 1, cases.indices.contains(index) else { return }
    cases.remove(at: index)
    selectedCase = max(0, index <= selectedCase ? selectedCase - 1 : selectedCase)
    invalidCase = nil
  }

  // MARK: Lifetime

  /// Saves pending code and stops background work when the model is discarded.
  func close() {
    poll?.cancel()
    changes?.cancel()
    draftLoad?.cancel()
    if let session = draftSession { session.stop(); services.unregister(session) }
    draftSession = nil
  }
}

struct WorkspaceMessage: Error { let text: String; init(_ text: String) { self.text = text } }

/// Keeps recently opened problems' workspaces alive across navigation, per account.
@MainActor
final class ProblemWorkspaceStates {
  static let shared = ProblemWorkspaceStates()
  /// Enough for a study session's worth of problems; older workspaces save their code and close.
  private let limit = 12
  private var models: [(key: String, model: ProblemWorkspaceModel)] = []

  func model(problemId: String, services: ProblemWorkspaceServices) -> ProblemWorkspaceModel {
    let key = "\(services.accountId)/\(problemId)"
    if let index = models.firstIndex(where: { $0.key == key }), models[index].model.services === services {
      let entry = models.remove(at: index)
      models.append(entry)
      return entry.model
    }
    models.removeAll { entry in
      guard entry.key == key else { return false }
      entry.model.close()
      return true
    }
    let model = ProblemWorkspaceModel(problemId: problemId, services: services)
    models.append((key, model))
    while models.count > limit { models.removeFirst().model.close() }
    return model
  }

  func forget(accountId: String) {
    models.removeAll { entry in
      guard entry.key.hasPrefix(accountId + "/") else { return false }
      entry.model.close()
      return true
    }
  }
}
