import Foundation
import Testing
@testable import ManorKit

private let twoSum = ProblemInterface(kind: .function, parameters: ["nums", "target"])
private let words = ProblemInterface(kind: .function, parameters: ["s", "grid", "k"])
private let lru = ProblemInterface(kind: .class)

@Suite("Problem console test cases")
struct ProblemTestcaseTests {
  @Test func readsNamedValuesInParameterOrder() {
    #expect(ProblemTestcases.parseExampleInput(twoSum, "nums = [2,7,11,15], target = 9") == ["[2,7,11,15]", "9"])
    #expect(ProblemTestcases.parseExampleInput(words, "s = \"a, k = b\", grid = [[\"x\", \"y\"],\n [\"z\"]], k = 9007199254740993") == ["\"a, k = b\"", "[[\"x\",\"y\"],[\"z\"]]", "9007199254740993"])
    #expect(ProblemTestcases.parseExampleInput(twoSum, "nums = [1]\ntarget = -3") == ["[1]", "-3"])
  }

  @Test func acceptsRawLinesAndRejectsMismatches() {
    #expect(ProblemTestcases.parseExampleInput(twoSum, "[3,3]\n6") == ["[3,3]", "6"])
    #expect(ProblemTestcases.parseExampleInput(lru, "[\"LRUCache\", \"get\"]\n[[2], [1]]") == ["[\"LRUCache\",\"get\"]", "[[2],[1]]"])
    #expect(ProblemTestcases.parseExampleInput(twoSum, "target = 9, nums = [1]") == nil)
    #expect(ProblemTestcases.parseExampleInput(twoSum, "nums = [1, target = 9") == nil)
    #expect(ProblemTestcases.parseExampleInput(lru, "LRUCache get") == nil)
  }

  @Test func prefillsOneCasePerExample() {
    let cases = ProblemTestcases.exampleCases(twoSum, [ProblemExample(input: "nums = [2,7], target = 9", output: "[0,1]", explanation: nil), ProblemExample(input: "see picture", output: "[]", explanation: nil)])
    #expect(cases.map(\.values) == [["[2,7]", "9"], ["", ""]])
    #expect(ProblemTestcases.exampleCases(lru, []).map(\.values) == [["", ""]])
  }

  @Test func runsEditedCasesBackToBack() {
    let fields = ProblemTestcases.fields(twoSum)
    #expect(fields.map(\.label) == ["nums =", "target ="])
    let cases = [Testcase(id: "a", values: ["[2, 7]", "9"]), Testcase(id: "b", values: ["[\n 1,\n 2\n]", "3"])]
    #expect(ProblemTestcases.input(cases) == "[2,7]\n9\n[1,2]\n3")
    #expect(ProblemTestcases.firstInvalid(fields, cases) == nil)
    #expect(ProblemTestcases.firstInvalid(fields, cases + [Testcase(id: "c", values: ["[1]", "nine"])]) == InvalidTestcase(caseIndex: 2, fieldIndex: 1, message: "Case 3: target needs a JSON value, such as [1,2] or \"text\"."))
    #expect(ProblemTestcases.same(cases, [Testcase(id: "x", values: ["[2,7]", "9"]), Testcase(id: "y", values: ["[1,2]", "3"])]))
    #expect(!ProblemTestcases.same(cases, Array(cases.dropFirst())))
  }

  @Test func labelsAResultInputOnlyForOneCase() {
    let fields = ProblemTestcases.fields(twoSum)
    #expect(ProblemTestcases.labeledInput(fields, "[2,7]\n9\n")?.map { "\($0.field.label) \($0.value)" } == ["nums = [2,7]", "target = 9"])
    #expect(ProblemTestcases.labeledInput(fields, "[2,7]\n9\n[1]\n2") == nil)
  }

  @Test func placesExamplesBeforeConstraints() {
    let split = ProblemTestcases.splitStatement("Find two numbers.\n\n**Constraints:**\n\n- `2 <= n`\n\n**Follow-up:** Faster?")
    #expect(split.description == "Find two numbers.")
    #expect(split.rest == "**Constraints:**\n\n- `2 <= n`\n\n**Follow-up:** Faster?")
    #expect(!split.hasInlineExamples)
    #expect(ProblemTestcases.splitStatement("Text\n\n**Example 1:**\n\nInput\n\n## Constraints").rest == "")
    #expect(ProblemTestcases.splitStatement("No sections here").description == "No sections here")
  }

  @Test func splitsExampleAssignments() {
    #expect(ProblemTestcases.exampleAssignments("weights = [1,3,4], values = [15, 20, 30], capacity = 4") == ["weights = [1,3,4],", "values = [15, 20, 30],", "capacity = 4"])
    #expect(ProblemTestcases.exampleAssignments("s = \"a, b = c\", k = 2") == ["s = \"a, b = c\",", "k = 2"])
    #expect(ProblemTestcases.exampleAssignments("[1,2,3]") == ["[1,2,3]"])
  }
}

private func result(_ id: String, passed: Bool = true, hidden: Bool = false, input: String? = "1", expected: String? = "1", output: String? = "1", duration: Double = 1, memory: Double? = nil, verdict: ProblemVerdict = .accepted) -> ProblemCaseResult {
  ProblemCaseResult(id: id, passed: passed, hidden: hidden, input: input, expectedOutput: expected, output: output, stderr: nil, durationMs: duration, memoryKb: memory, verdict: verdict)
}

private func submission(status: ProblemSubmissionStatus = .completed, verdict: ProblemVerdict? = .accepted, mode: ProblemExecutionMode = .submit, testset: Int? = 1, results: [ProblemCaseResult] = []) -> ProblemSubmission {
  ProblemSubmission(id: "00000000-0000-4000-8000-000000000002", problemId: "p", contentVersion: 1, testsetVersion: testset, language: .python, mode: mode, status: status, verdict: verdict, passedCases: 3, totalCases: 3, results: results, error: nil, createdAt: "2026-10-12T12:00:00Z", finishedAt: "2026-10-12T12:00:02Z")
}

@Suite("Problem submission stats")
struct ProblemSubmissionStatsTests {
  @Test func sumsDurationsAndTakesPeakMemory() throws {
    let value = submission(results: [result("a", duration: 2.4, memory: 16_000), result("b", duration: 3.3, memory: 18_022), result("c", duration: 0.8, memory: nil)])
    #expect(abs(try #require(value.runtimeMs) - 6.5) < 0.0001)
    #expect(value.memoryKb == 18_022)
    #expect(ProblemSubmissionStats.formatRuntime(6.5) == "7 ms")
    #expect(ProblemSubmissionStats.formatRuntime(12_345) == "12,345 ms")
    #expect(ProblemSubmissionStats.formatMemory(18_022) == "17.6 MB")
  }

  @Test func reportsNoNumbersWhilePendingOrUncompiled() {
    #expect(submission(results: [result("a"), result("b")]).memoryKb == nil)
    #expect(submission(status: .running, verdict: nil, results: [result("a")]).runtimeMs == nil)
    #expect(submission(verdict: .compileError, results: [result("a", passed: false, duration: 0, verdict: .compileError)]).runtimeMs == nil)
    #expect(submission(results: []).runtimeMs == nil)
  }

  @Test func selectsTheFirstVisibleFailure() {
    let results = [result("a"), result("b", passed: false, hidden: true, input: nil, verdict: .wrongAnswer), result("c", passed: false, verdict: .runtimeError), result("d", passed: false, verdict: .wrongAnswer)]
    #expect(ProblemSubmissionStats.firstFailingVisibleCase(results)?.index == 2)
    #expect(ProblemSubmissionStats.firstFailingVisibleCase([result("a"), result("b", passed: false, hidden: true, input: nil, expected: nil, output: nil, verdict: .timeLimit)]) == nil)
    #expect(ProblemSubmissionStats.firstFailingVisibleCase([result("a")]) == nil)
  }

  @Test func ungradedRunsFinishWithoutAnAcceptedVerdict() {
    let run = submission(mode: .run, testset: nil, results: [result("a")])
    #expect(run.label == "Finished")
    #expect(run.tone == .neutral)
    #expect(submission().label == "Accepted")
    #expect(submission().tone == .accepted)
    #expect(submission(verdict: .wrongAnswer).tone == .failed)
    #expect(submission(status: .queued, verdict: nil).label == "Queued")
  }

  /// The `submissions` list as `manor_problem_runner('list')` returns it: `problem_submission_json` rows with Postgres
  /// timestamps, hidden passing cases stripped of their data, and both Runs and Submits mixed together.
  @Test func listRowsReadAcceptedSubmitsAsAccepted() throws {
    let payload = #"""
    [
      {"id":"6f1c2f0e-6a43-4d0e-9a51-0d6f0b1f6c11","problemId":"stock-1","contentVersion":3,"testsetVersion":2,"language":"python","mode":"submit",
       "status":"completed","verdict":"accepted","passedCases":3,"totalCases":3,"error":null,
       "results":[
         {"id":"c1","passed":true,"hidden":false,"input":"[2,7,11,15]\n9","expectedOutput":"[0,1]","output":"[0,1]","stdout":"","stderr":"","durationMs":41.2,"memoryKb":17400,"verdict":"accepted"},
         {"id":"c2","passed":true,"hidden":true,"input":null,"expectedOutput":null,"output":null,"stdout":null,"stderr":null,"durationMs":38,"memoryKb":17412,"verdict":"accepted"},
         {"id":"c3","passed":true,"hidden":true,"input":null,"expectedOutput":null,"output":null,"stdout":null,"stderr":null,"durationMs":39.9,"verdict":"accepted"}
       ],
       "createdAt":"2026-11-16T21:04:11.123456+00:00","finishedAt":"2026-11-16T21:04:13.5+00:00"},
      {"id":"6f1c2f0e-6a43-4d0e-9a51-0d6f0b1f6c12","problemId":"stock-1","contentVersion":3,"testsetVersion":2,"language":"python","mode":"submit",
       "status":"completed","verdict":"wrong_answer","passedCases":1,"totalCases":3,"error":null,
       "results":[{"id":"c1","passed":false,"hidden":false,"input":"[3,3]\n6","expectedOutput":"[0,1]","output":"[1,0]","stdout":"","stderr":"","durationMs":40,"verdict":"wrong_answer"}],
       "createdAt":"2026-11-16T20:58:00.5+00:00","finishedAt":"2026-11-16T20:58:02+00:00"},
      {"id":"6f1c2f0e-6a43-4d0e-9a51-0d6f0b1f6c13","problemId":"stock-1","contentVersion":3,"testsetVersion":null,"language":"python","mode":"run",
       "status":"completed","verdict":"accepted","passedCases":1,"totalCases":1,"error":null,
       "results":[{"id":"custom","passed":true,"hidden":false,"input":"1","expectedOutput":null,"output":"1","stdout":"","stderr":"","durationMs":12,"verdict":"accepted"}],
       "createdAt":"2026-11-16T20:50:00+00:00","finishedAt":"2026-11-16T20:50:01+00:00"}
    ]
    """#
    // The same path `ProblemExecutionService` takes: the function body as `JSONValue`, then re-encoded and decoded.
    let value = try ManorJSON.plainDecoder.decode(JSONValue.self, from: Data(payload.utf8))
    let rows = try ManorJSON.plainDecoder.decode([ProblemSubmission].self, from: try ManorJSON.plainEncoder.encode(value))
    #expect(rows.count == 3)
    #expect(rows[0].isGraded)
    #expect(rows[0].label == "Accepted")
    #expect(rows[0].tone == .accepted)
    #expect(rows[0].results.allSatisfy { $0.passed })
    #expect(ProblemSubmissionStats.firstFailingVisibleCase(rows[0].results) == nil)
    #expect(rows[1].tone == .failed)
    #expect(rows[2].label == "Finished")
    #expect(rows[2].tone == .neutral)
    #expect(ProblemSubmissionStats.listed(rows).map(\.verdict) == [.accepted, .wrongAnswer])
  }

  @Test func readsRecentTimesRelatively() throws {
    let now = try #require(ProblemSubmissionStats.parseTimestamp("2026-10-13T12:00:00Z"))
    let utc = try #require(TimeZone(identifier: "UTC"))
    #expect(ProblemSubmissionStats.relativeTime("2026-10-13T11:59:30Z", now: now, timeZone: utc) == "Just now")
    #expect(ProblemSubmissionStats.relativeTime("2026-10-13T11:55:00Z", now: now, timeZone: utc) == "5 minutes ago")
    #expect(ProblemSubmissionStats.relativeTime("2026-10-13T09:00:00Z", now: now, timeZone: utc) == "3 hours ago")
    #expect(ProblemSubmissionStats.relativeTime("2026-10-12T10:00:00Z", now: now, timeZone: utc) == "Yesterday")
    #expect(ProblemSubmissionStats.relativeTime("2026-10-01T12:00:00Z", now: now, timeZone: utc) == "Oct 1")
    #expect(ProblemSubmissionStats.relativeTime("2025-10-01T12:00:00Z", now: now, timeZone: utc) == "Oct 1, 2025")
    #expect(ProblemSubmissionStats.parseTimestamp("2026-10-12 12:00:00.123456+00") != nil)
  }

  @Test func pollsSoonThenSettlesAtOnceASecond() {
    #expect(ProblemSubmissionStats.pollDelay(attempt: 0) == .milliseconds(300))
    #expect(ProblemSubmissionStats.pollDelay(attempt: 1) == .milliseconds(450))
    #expect(ProblemSubmissionStats.pollDelay(attempt: 5) == .milliseconds(1000))
  }

  @Test func decodesARunnerSubmission() throws {
    let json = #"{"id":"00000000-0000-4000-8000-000000000002","problemId":"two-sum","contentVersion":3,"testsetVersion":null,"language":"cpp","mode":"run","status":"completed","verdict":"wrong_answer","passedCases":0,"totalCases":1,"results":[{"id":"c1","passed":false,"hidden":false,"input":"[1]\n2","expectedOutput":null,"output":"[0]","stdout":"debug","stderr":null,"durationMs":1.5,"memoryKb":2048,"verdict":"wrong_answer"}],"error":null,"createdAt":"2026-10-12T12:00:00Z","finishedAt":null}"#
    let decoded = try JSONDecoder().decode(ProblemSubmission.self, from: Data(json.utf8))
    #expect(decoded.language == .cpp)
    #expect(decoded.results.first?.stdout == "debug")
    #expect(decoded.sourceCode == nil)
  }
}

@Suite("Code draft protection")
struct CodeDraftProtectionTests {
  private func draft(_ code: String, account: String = "account") -> LocalCodeDraft {
    LocalCodeDraft(id: "d", accountId: account, problemId: "problem", language: .python, contentVersion: 1, code: code, cloudRevision: 0, pending: true)
  }

  @MainActor @Test func olderReceiptsNeverReleaseNewerSource() {
    let boundary = CodeDraftProtectionBoundary()
    #expect(boundary.isEmpty)
    let older = boundary.begin(draft("older source"))
    let latest = boundary.begin(draft("latest source"))
    #expect(boundary.hasUnprotected(accountId: "account"))
    #expect(!boundary.hasUnprotected(accountId: "other-account"))
    older()
    #expect(boundary.readUnprotected(accountId: "account", problemId: "problem", language: .python)?.code == "latest source")
    let recovered = boundary.begin(draft("latest source"))
    latest()
    #expect(!boundary.isEmpty)
    recovered()
    #expect(boundary.isEmpty)
    #expect(boundary.readUnprotected(accountId: "account", problemId: "problem", language: .python) == nil)
  }

  @Test func storeKeepsRevisionsMonotonicAndClearsOnlySyncedDrafts() async throws {
    let store = try CodeDraftStore()
    var value = draft("print(1)")
    value.cloudRevision = 4
    try await store.write(value)
    value.cloudRevision = 2
    value.code = "print(2)"
    try await store.write(value)
    let stored = try #require(try await store.read(accountId: "account", problemId: "problem", language: .python))
    #expect(stored.cloudRevision == 4)
    #expect(stored.code == "print(2)")
    #expect(try await store.hasPending(accountId: "account"))
    await #expect(throws: ManorRequestError.self) { try await store.clearSynced(accountId: "account") }
    // A receipt for older source keeps the newer edit pending.
    try await store.acknowledge(accountId: "account", problemId: "problem", language: .python, source: "print(1)", revision: 5)
    #expect(try await store.hasPending(accountId: "account"))
    try await store.acknowledge(accountId: "account", problemId: "problem", language: .python, source: "print(2)", revision: 6)
    #expect(try await !store.hasPending(accountId: "account"))
    try await store.clearSynced(accountId: "account")
    #expect(try await store.read(accountId: "account", problemId: "problem", language: .python) == nil)
  }

  /// A draft edited while its save was in flight, then closed, is saved by sign-out instead of blocking it forever.
  @MainActor @Test func signOutSavesPendingDraftsNoEditorHolds() async throws {
    let store = try CodeDraftStore()
    let cloud = FakeDraftCloud()
    cloud.stored = CloudCodeDraft(id: "d", problemId: "problem", language: .python, contentVersion: 1, source: "print(1)", revision: 5, updatedAt: "")
    var value = draft("print(2)")
    value.cloudRevision = 5
    try await store.write(value)
    #expect(await ProblemWorkspaceServices.savePending(value, cloud: cloud, store: store) == .saved)
    #expect(cloud.stored?.source == "print(2)")
    #expect(try await !store.hasPending(accountId: "account"))
  }

  /// A cloud copy that moved on since the edit is a conflict for the editor to resolve, never overwritten.
  @MainActor @Test func signOutLeavesConflictingDraftsPending() async throws {
    let store = try CodeDraftStore()
    let cloud = FakeDraftCloud()
    cloud.stored = CloudCodeDraft(id: "d", problemId: "problem", language: .python, contentVersion: 1, source: "from another Mac", revision: 7, updatedAt: "")
    var value = draft("print(2)")
    value.cloudRevision = 5
    try await store.write(value)
    #expect(await ProblemWorkspaceServices.savePending(value, cloud: cloud, store: store) == .conflict)
    #expect(cloud.stored?.source == "from another Mac")
    #expect(try await store.hasPending(accountId: "account"))
  }
}

/// A cloud that records saves and can be told to hold a different draft.
@MainActor
private final class FakeDraftCloud: ProblemDraftCloud {
  var stored: CloudCodeDraft?
  var saves: [LocalCodeDraft] = []
  var failSaves = false
  /// Holds each save open until `release()`, like a slow network.
  var holdSaves = false
  private var held: CheckedContinuation<Void, Never>?
  private var heldWaiters: [CheckedContinuation<Void, Never>] = []

  func loadDraft(problemId: String, language: ProblemLanguage) async throws -> CloudCodeDraft? { stored }

  func saveDraft(_ draft: LocalCodeDraft) async throws -> CloudCodeDraft {
    saves.append(draft)
    if holdSaves {
      await withCheckedContinuation { continuation in
        held = continuation
        heldWaiters.forEach { $0.resume() }
        heldWaiters = []
      }
    }
    if failSaves { throw ManorConnectionError(operation: "save_problem_draft", detail: "offline") }
    if let stored, stored.revision != draft.cloudRevision { throw ManorRequestError(operation: "save_problem_draft", code: "PT409", detail: "conflict") }
    let saved = CloudCodeDraft(id: draft.id, problemId: draft.problemId, language: .python, contentVersion: draft.contentVersion, source: draft.code, revision: (stored?.revision ?? 0) + 1, updatedAt: "2026-10-12T12:00:00Z")
    stored = saved
    return saved
  }

  /// Returns once a save is being held.
  func waitForHeldSave() async {
    if held != nil { return }
    await withCheckedContinuation { heldWaiters.append($0) }
  }

  func release() {
    holdSaves = false
    held?.resume()
    held = nil
  }
}

@Suite("Problem draft session")
@MainActor
struct ProblemDraftSessionTests {
  private func session(_ cloud: FakeDraftCloud, store: CodeDraftStore, boundary: CodeDraftProtectionBoundary? = nil, saveDelay: Duration = .milliseconds(10)) -> ProblemDraftSession {
    ProblemDraftSession(accountId: "account", problemId: "problem", language: .python, contentVersion: 1, store: store, boundary: boundary ?? CodeDraftProtectionBoundary(), cloud: cloud, saveDelay: saveDelay) { _, _ in }
  }

  /// Typing while a save is in flight, with a second save waiting on it (the debounce timer firing): the waiter
  /// resumes before the save that started it has cleared its in-flight marker. It must save the newer code once,
  /// not call itself forever on the finished save (which froze the editor and grew memory without bound).
  @Test(.timeLimit(.minutes(1))) func typingDuringASaveWithAnotherWaitingSavesTheNewerCode() async throws {
    let cloud = FakeDraftCloud()
    let store = try CodeDraftStore()
    let draft = session(cloud, store: store, saveDelay: .seconds(60))
    _ = try await draft.open(starterCode: "starter")
    _ = await draft.reconciled()
    draft.protect("a")
    try await draft.protected()
    cloud.holdSaves = true
    let first = Task { try await draft.sync() }
    await cloud.waitForHeldSave()
    let second = Task { try await draft.sync() }
    for _ in 0..<10 { await Task.yield() }
    draft.protect("ab")
    try await draft.protected()
    cloud.release()
    try await first.value
    try await second.value
    #expect(cloud.stored?.source == "ab")
    #expect(cloud.saves.map(\.code) == ["a", "ab"])
    #expect(try await !store.hasPending(accountId: "account"))
  }

  @Test func uneditedCodeTakesTheCloudDraft() async throws {
    let cloud = FakeDraftCloud()
    cloud.stored = CloudCodeDraft(id: "cloud", problemId: "problem", language: .python, contentVersion: 1, source: "cloud code", revision: 3, updatedAt: "2026-10-12T12:00:00Z")
    let draft = session(cloud, store: try CodeDraftStore())
    #expect(try await draft.open(starterCode: "starter") == "starter")
    #expect(await draft.reconciled() == "cloud code")
    #expect(draft.conflict == nil)
  }

  @Test func editsSaveToTheCloudWithTheirRevision() async throws {
    let cloud = FakeDraftCloud()
    let store = try CodeDraftStore()
    let draft = session(cloud, store: store)
    _ = try await draft.open(starterCode: "starter")
    _ = await draft.reconciled()
    draft.protect("edited")
    try await draft.protected()
    try await draft.sync()
    #expect(cloud.stored?.source == "edited")
    #expect(cloud.saves.last?.cloudRevision == 0)
    #expect(try await !store.hasPending(accountId: "account"))
  }

  @Test func pendingLocalEditsConflictWithANewerCloudDraft() async throws {
    let cloud = FakeDraftCloud()
    let store = try CodeDraftStore()
    let local = LocalCodeDraft(id: "d", accountId: "account", problemId: "problem", language: .python, contentVersion: 1, code: "offline edit", cloudRevision: 1, pending: true)
    try await store.write(local)
    cloud.stored = CloudCodeDraft(id: "d", problemId: "problem", language: .python, contentVersion: 1, source: "other device", revision: 2, updatedAt: "2026-10-12T12:00:00Z")
    let draft = session(cloud, store: store)
    #expect(try await draft.open(starterCode: "starter") == "offline edit")
    #expect(await draft.reconciled() == nil)
    #expect(draft.conflict?.source == "other device")
    try await draft.keepLocal()
    #expect(cloud.stored?.source == "offline edit")
    #expect(cloud.stored?.revision == 3)
  }

  @Test func failedSavesStayProtectedLocally() async throws {
    let cloud = FakeDraftCloud()
    cloud.failSaves = true
    let store = try CodeDraftStore()
    let draft = session(cloud, store: store)
    _ = try await draft.open(starterCode: "starter")
    _ = await draft.reconciled()
    draft.protect("unsaved")
    try await draft.protected()
    await #expect(throws: (any Error).self) { try await draft.sync() }
    #expect(try await store.hasPending(accountId: "account"))
    #expect(try await store.read(accountId: "account", problemId: "problem", language: .python)?.code == "unsaved")
  }
}

@Suite("Editor sessions")
@MainActor
struct ProblemEditorSessionTests {
  @Test func reusesARecentSessionAndRenewsAnOldOne() async throws {
    var clock = Date(timeIntervalSince1970: 0)
    var requests: [(String?, ProblemLanguage)] = []
    let sessions = ProblemEditorSessions(now: { clock }) { problemId, language in
      requests.append((problemId, language))
      return ProblemEditorSession(id: "s\(requests.count)", webSocketUrls: ["python": "wss://example.test/lsp/python"], token: "t", expiresAt: "", workspaceUri: "file:///workspace")
    }
    _ = try await sessions.session(.python, problemId: nil)
    _ = try await sessions.session(.java, problemId: nil)
    #expect(requests.count == 1)
    // Binding a problem asks the server once; a later unbound use keeps the bound session.
    _ = try await sessions.session(.python, problemId: "p")
    _ = try await sessions.session(.python, problemId: nil)
    #expect(requests.count == 2)
    clock = clock.addingTimeInterval(6 * 60)
    _ = try await sessions.session(.python, problemId: nil)
    #expect(requests.count == 3)
  }
}

@Suite("Language server protocol")
struct LanguageServerProtocolTests {
  @Test func encodesWholeNumbersAsIntegers() throws {
    let value: JSONValue = ["line": .number(3), "character": .number(12)]
    #expect(String(decoding: try ManorJSON.plainEncoder.encode(value), as: UTF8.self).contains("\"line\":3"))
  }

  @Test func expandsSnippets() {
    #expect(LSPSnippet.expand("append(${1:value})$0") == ("append(value)", 13))
    #expect(LSPSnippet.expand("for ${1:i} in ${2:range}:\n\t$0").caret == "for i in range:\n\t".utf16.count)
    #expect(LSPSnippet.expand("print($1)").caret == 6)
    #expect(LSPSnippet.expand("${1|a,b|}").text == "a")
    #expect(LSPSnippet.expand("cost \\$5").text == "cost $5")
  }

  @Test func mapsOffsetsAndPositions() {
    let index = LSPLineIndex("ab\ncd\r\nef")
    #expect(index.position(of: 4) == LSPPosition(line: 1, character: 1))
    #expect(index.offset(of: LSPPosition(line: 2, character: 1)) == 8)
    #expect(index.offset(of: LSPPosition(line: 9, character: 0)) == 9)
    #expect(index.range(of: LSPRange(start: LSPPosition(line: 0, character: 1), end: LSPPosition(line: 1, character: 2))) == NSRange(location: 1, length: 4))
  }

  @Test func readsCompletionListsAndHovers() {
    let list: JSONValue = ["isIncomplete": true, "items": [
      ["label": "append", "kind": 2, "detail": "(object) -> None", "insertTextFormat": 2, "insertText": "append(${1:object})",
       "documentation": ["kind": "markdown", "value": "Append object."]],
      ["label": "count", "kind": 2, "textEdit": ["range": ["start": ["line": 1, "character": 7], "end": ["line": 1, "character": 8]], "newText": "count"]]
    ]]
    let parsed = LSPCompletionItem.list(from: list)
    #expect(parsed.incomplete)
    #expect(parsed.items.first?.insertText == "append(object)")
    #expect(parsed.items.first?.caretOffset == 7)
    #expect(parsed.items.first?.documentation == "Append object.")
    #expect(parsed.items.last?.edit?.start == LSPPosition(line: 1, character: 7))
    let hover: JSONValue = ["contents": ["kind": "markdown", "value": "```python\n(variable) nums: list[int]\n```"]]
    #expect(LSPHover(hover)?.contents.hasPrefix("```python") == true)
    let signature: JSONValue = ["signatures": [["label": "max(a, b)", "parameters": [["label": "a"], ["label": [7, 8]]]]], "activeSignature": 0, "activeParameter": 1]
    #expect(LSPSignatureHelp(signature)?.signatures.first?.parameters == [4..<5, 7..<8])
    #expect(LSPSignatureHelp(signature)?.activeParameter == 1)
  }
}

/// A transport that answers like the editor bridge.
private final class FakeTransport: LanguageServerTransport, @unchecked Sendable {
  let messages: AsyncThrowingStream<String, Error>
  private let continuation: AsyncThrowingStream<String, Error>.Continuation
  private let lock = NSLock()
  private var sentMessages: [JSONValue] = []

  init() {
    (messages, continuation) = AsyncThrowingStream.makeStream()
  }

  var sent: [JSONValue] { lock.withLock { sentMessages } }

  func send(_ text: String) async throws {
    let message = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    lock.withLock { sentMessages.append(message) }
    guard let id = message["id"], let method = message["method"]?.string else { return }
    let result: JSONValue
    switch method {
    case "initialize": result = ["capabilities": ["completionProvider": ["triggerCharacters": ["."]]]]
    case "textDocument/completion": result = [["label": "append", "kind": 2]]
    default: result = .null
    }
    let reply = String(decoding: try JSONEncoder().encode(JSONValue.object(["jsonrpc": "2.0", "id": id, "result": result])), as: UTF8.self)
    continuation.yield(reply)
  }

  func push(_ message: JSONValue) {
    continuation.yield(String(decoding: try! JSONEncoder().encode(message), as: UTF8.self))
  }

  func close() { continuation.finish() }
}

@Suite("Language server connection")
@MainActor
struct LanguageServerConnectionTests {
  @Test func initializesSyncsAndCompletes() async throws {
    let transport = FakeTransport()
    let connection = LanguageServerConnection(language: .python, transport: transport)
    var diagnostics: [LSPDiagnostic] = []
    connection.onDiagnostics = { items, _ in diagnostics = items }
    try await connection.start()
    #expect(connection.state == .connected)
    #expect(connection.triggerCharacters == ["."])
    try await connection.sync(text: "nums = []\nnums.")
    try await connection.sync(text: "nums = []\nnums.")
    try await connection.sync(text: "nums = [1]\nnums.")
    let methods = transport.sent.compactMap { $0["method"]?.string }
    #expect(methods == ["initialize", "initialized", "textDocument/didOpen", "textDocument/didChange"])
    #expect(transport.sent[2]["params"]?["textDocument"]?["uri"]?.string == "file:///workspace/main.py")
    let completion = try await connection.completion(at: LSPPosition(line: 1, character: 5), trigger: ".")
    #expect(completion.items.map(\.label) == ["append"])
    transport.push(["jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": [
      "uri": "file:///workspace/main.py",
      "diagnostics": [["range": ["start": ["line": 0, "character": 0], "end": ["line": 0, "character": 4]], "severity": 1, "message": "Undefined name"]]
    ]])
    // A server request is answered as a client without settings.
    transport.push(["jsonrpc": "2.0", "id": 7, "method": "workspace/configuration", "params": ["items": [["section": "python"]]]])
    try await Task.sleep(for: .milliseconds(100))
    #expect(diagnostics.first?.message == "Undefined name")
    #expect(transport.sent.contains { $0["id"]?.int == 7 && $0["result"]?.array == [.null] })
    transport.close()
    try await Task.sleep(for: .milliseconds(50))
    #expect(connection.state == .offline)
  }
}

@Suite("Problem syntax")
struct ProblemSyntaxTests {
  private func kinds(_ code: String, _ language: ProblemLanguage) -> [String: ProblemSyntax.Kind] {
    let source = code as NSString
    return Dictionary(ProblemSyntax.tokens(code, language: language).map { (source.substring(with: $0.range), $0.kind) }, uniquingKeysWith: { first, _ in first })
  }

  @Test func colorsPythonKeywordsStringsCommentsAndCalls() {
    let tokens = kinds("def twoSum(self, nums: List[int]) -> None:\n    s = \"a # b\"  # note\n    return len(nums) + 10\n", .python)
    #expect(tokens["def"] == .keyword)
    #expect(tokens["twoSum"] == .function)
    #expect(tokens["self"] == .constant)
    #expect(tokens["List"] == .type)
    #expect(tokens["\"a # b\""] == .string)
    #expect(tokens["# note"] == .comment)
    #expect(tokens["len"] == .function)
    #expect(tokens["10"] == .number)
  }

  @Test func colorsPreprocessorLinesAndBlockComments() {
    let tokens = kinds("#include <vector>\n/* two\nlines */ int main() { return 0; }", .cpp)
    #expect(tokens["#include <vector>"] == .attribute)
    #expect(tokens["/* two"] == .comment)
    #expect(tokens["lines */"] == .comment)
    #expect(tokens["int"] == .type)
    #expect(tokens["main"] == .function)
  }

  @Test func keepsGoRawStringsAndJavaAnnotations() {
    #expect(kinds("s := `a\\nb`", .go)["`a\\nb`"] == .string)
    #expect(kinds("@Override public int size() { return 0; }", .java)["@Override"] == .attribute)
  }
}

@Suite("Incremental highlighting")
struct ProblemSyntaxHighlighterTests {
  /// Applies `replacement` at `range` and checks the incremental tokens against a fresh full pass.
  private func check(_ text: String, replacing range: NSRange, with replacement: String, language: ProblemLanguage, maxRelexedLines: Int? = nil) -> NSRange {
    let highlighter = ProblemSyntaxHighlighter(language: language)
    _ = highlighter.reset(units: Array(text.utf16))
    let edited = (text as NSString).replacingCharacters(in: range, with: replacement)
    let units = Array(edited.utf16)
    let result = highlighter.edit(units: units, replaced: range, insertedLength: (replacement as NSString).length)
    let full = ProblemSyntaxHighlighter(language: language)
    let expected = full.reset(units: units)
    let outside = expected.filter { NSIntersectionRange($0.range, result.range).length == 0 && !(result.range.location <= $0.range.location && $0.range.location < NSMaxRange(result.range)) }
    // Tokens inside the re-lexed range match a full pass; the line table matches too.
    #expect(result.tokens == expected.filter { $0.range.location >= result.range.location && $0.range.location < NSMaxRange(result.range) })
    #expect(highlighter.lineStarts == full.lineStarts)
    _ = outside
    return result.range
  }

  @Test func typingInsideALineRelexesOnlyThatLine() {
    let text = "def f(x):\n    return x + 1\n\nprint(f(2))\n"
    let range = check(text, replacing: NSRange(location: 22, length: 0), with: "0", language: .python)
    #expect(range == NSRange(location: 10, length: 18))
  }

  @Test func openingABlockCommentRelexesUntilItCloses() {
    let text = "int a = 1;\nint b = 2;\nint c = 3; */\nint d = 4;\n"
    let range = check(text, replacing: NSRange(location: 0, length: 0), with: "/* ", language: .cpp)
    #expect(range.location == 0)
    #expect(NSMaxRange(range) >= ("/* int a = 1;\nint b = 2;\nint c = 3; */\n" as NSString).length)
  }

  @Test func insertingAndDeletingLinesKeepsTheLineTable() {
    let text = "a = '''x\ny'''\nb = 1\n"
    _ = check(text, replacing: NSRange(location: 4, length: 3), with: "", language: .python)
    _ = check(text, replacing: NSRange(location: 14, length: 0), with: "c = 2\nd = \"\"\"\n", language: .python)
    _ = check("x := `a\nb`\ny := 1\n", replacing: NSRange(location: 5, length: 1), with: "", language: .go)
  }

  @Test func measuresTypingAndFullPassLatency() {
    var lines: [String] = []
    for index in 0..<3000 { lines.append("    total += nums[\(index)] * 2  # step \(index)") }
    let text = "def solve(nums):\n    total = 0\n" + lines.joined(separator: "\n") + "\n    return total\n"
    let units = Array(text.utf16)
    let clock = ContinuousClock()
    let highlighter = ProblemSyntaxHighlighter(language: .python)
    let full = clock.measure { _ = highlighter.reset(units: units) }
    var edited = units
    let at = units.count / 2
    edited.insert(UInt16(UInt8(ascii: "x")), at: at)
    let keystroke = clock.measure { _ = highlighter.edit(units: edited, replaced: NSRange(location: at, length: 0), insertedLength: 1) }
    print("Highlight latency, \(units.count) UTF-16 units, \(lines.count + 3) lines: full pass \(full), one keystroke \(keystroke)")
    #expect(keystroke < .milliseconds(16))
  }
}
