import Foundation

/// Run executes the editor's cases (examples or custom input); Submit grades against the saved testset.
public enum ProblemExecutionMode: String, Codable, Hashable, Sendable { case run, submit }

public enum ProblemSubmissionStatus: String, Codable, Hashable, Sendable { case queued, running, completed, failed }

public enum ProblemVerdict: String, Codable, Hashable, Sendable {
  case accepted
  case wrongAnswer = "wrong_answer"
  case compileError = "compile_error"
  case runtimeError = "runtime_error"
  case timeLimit = "time_limit"
  case outputLimit = "output_limit"
  case executionError = "execution_error"

  public var label: String {
    switch self {
    case .accepted: return "Accepted"
    case .wrongAnswer: return "Wrong Answer"
    case .compileError: return "Compile Error"
    case .runtimeError: return "Runtime Error"
    case .timeLimit: return "Time Limit Exceeded"
    case .outputLimit: return "Output Limit Exceeded"
    case .executionError: return "Execution Failed"
    }
  }
}

/// One case's sanitized result. Hidden cases carry no input unless they are the revealed first failure.
public struct ProblemCaseResult: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var passed: Bool
  public var hidden: Bool
  public var input: String?
  public var expectedOutput: String?
  public var output: String?
  /// What the solution printed while running this case; typed problems report it apart from the returned answer.
  public var stdout: String?
  public var stderr: String?
  public var durationMs: Double
  /// Peak memory of the batch process that ran this case, in KiB; absent for programs without a typed driver.
  public var memoryKb: Double?
  public var verdict: ProblemVerdict

  public init(id: String, passed: Bool, hidden: Bool, input: String?, expectedOutput: String?, output: String?, stdout: String? = nil, stderr: String?, durationMs: Double, memoryKb: Double? = nil, verdict: ProblemVerdict) {
    self.id = id; self.passed = passed; self.hidden = hidden; self.input = input; self.expectedOutput = expectedOutput
    self.output = output; self.stdout = stdout; self.stderr = stderr; self.durationMs = durationMs; self.memoryKb = memoryKb; self.verdict = verdict
  }
}

/// A durable Run or Submit, as `problem-runner` returns it.
public struct ProblemSubmission: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var problemId: String
  public var contentVersion: Int
  public var testsetVersion: Int?
  public var language: ProblemLanguage
  public var mode: ProblemExecutionMode
  public var status: ProblemSubmissionStatus
  public var verdict: ProblemVerdict?
  public var passedCases: Int
  public var totalCases: Int
  public var results: [ProblemCaseResult]
  public var error: String?
  /// Present when the submission is read by id; history rows omit it.
  public var sourceCode: String?
  public var createdAt: String
  public var finishedAt: String?

  public init(id: String, problemId: String, contentVersion: Int, testsetVersion: Int?, language: ProblemLanguage, mode: ProblemExecutionMode, status: ProblemSubmissionStatus, verdict: ProblemVerdict?, passedCases: Int, totalCases: Int, results: [ProblemCaseResult], error: String?, sourceCode: String? = nil, createdAt: String, finishedAt: String?) {
    self.id = id; self.problemId = problemId; self.contentVersion = contentVersion; self.testsetVersion = testsetVersion; self.language = language
    self.mode = mode; self.status = status; self.verdict = verdict; self.passedCases = passedCases; self.totalCases = totalCases
    self.results = results; self.error = error; self.sourceCode = sourceCode; self.createdAt = createdAt; self.finishedAt = finishedAt
  }
}

/// The input of one Run or Submit. `requestId` makes a retry replay the same submission.
public struct ExecuteProblemInput: Hashable, Sendable {
  public var problemId: String
  public var language: ProblemLanguage
  public var code: String
  public var mode: ProblemExecutionMode
  public var customInput: String?
  public var requestId: UUID

  public init(problemId: String, language: ProblemLanguage, code: String, mode: ProblemExecutionMode, customInput: String?, requestId: UUID = UUID()) {
    self.problemId = problemId; self.language = language; self.code = code; self.mode = mode; self.customInput = customInput; self.requestId = requestId
  }

  var body: JSONObject {
    var body: JSONObject = [
      "action": "execute", "problemId": .string(problemId), "language": .string(language.rawValue), "code": .string(code),
      "mode": .string(mode.rawValue), "requestId": .string(requestId.uuidString.lowercased())
    ]
    if let customInput { body["customInput"] = .string(customInput) }
    return body
  }
}

/// The account's editor capability: one short-lived token, with the address of every language's server under it.
public struct ProblemEditorSession: Codable, Hashable, Sendable {
  public var id: String
  public var webSocketUrls: [String: String]
  public var token: String
  public var expiresAt: String
  public var workspaceUri: String

  public init(id: String, webSocketUrls: [String: String], token: String, expiresAt: String, workspaceUri: String) {
    self.id = id; self.webSocketUrls = webSocketUrls; self.token = token; self.expiresAt = expiresAt; self.workspaceUri = workspaceUri
  }

  public func webSocketURL(for language: ProblemLanguage) -> URL? { webSocketUrls[language.rawValue].flatMap(URL.init(string:)) }
}

// MARK: Submission presentation

public extension ProblemSubmission {
  /// A submission still waiting for, or inside, the judge.
  var isPending: Bool { status == .queued || status == .running }

  /// An ungraded run (custom input, no testset) has no expected answer.
  var isGraded: Bool { mode == .submit || testsetVersion != nil }

  /// Total time across the cases that ran; a pending, empty, or uncompiled submission has no runtime.
  var runtimeMs: Double? {
    if isPending || verdict == .compileError || results.isEmpty { return nil }
    return results.reduce(0) { $0 + $1.durationMs }
  }

  /// The peak memory across the case batches, or nil when no case reported memory.
  var memoryKb: Double? {
    if isPending || verdict == .compileError { return nil }
    return results.reduce(nil as Double?) { peak, result in
      guard let memory = result.memoryKb else { return peak }
      return peak.map { max($0, memory) } ?? memory
    }
  }

  /// Finishing an ungraded run is not an Accepted verdict.
  var label: String {
    if mode == .run && testsetVersion == nil && verdict == .accepted { return "Finished" }
    if let verdict { return verdict.label }
    switch status {
    case .queued: return "Queued"
    case .running: return "Running"
    case .failed: return "Failed"
    case .completed: return "Completed"
    }
  }

  enum Tone: Sendable { case neutral, accepted, failed }
  /// Accepted reads as success only when graded against expected answers; every other verdict reads as a failure.
  var tone: Tone {
    guard let verdict else { return status == .failed ? .failed : .neutral }
    if verdict == .accepted { return isGraded ? .accepted : .neutral }
    return .failed
  }

  /// The case counts beside the verdict.
  var caseSummary: String? {
    if verdict == .compileError || results.isEmpty { return nil }
    if testsetVersion == nil { return "\(results.count) \(results.count == 1 ? "case" : "cases")" }
    return "\(passedCases) / \(totalCases) test cases passed"
  }

  var compileOutput: String? {
    guard verdict == .compileError else { return nil }
    guard let compile = results.first(where: { $0.verdict == .compileError }) else { return nil }
    return compile.stderr ?? "The compiler reported no output."
  }
}

public struct FailingCase: Hashable, Sendable {
  public let index: Int
  public let result: ProblemCaseResult
}

public enum ProblemSubmissionStats {
  /// The first failing case with available diagnostics, including a revealed judge counterexample.
  public static func firstFailingVisibleCase(_ results: [ProblemCaseResult]) -> FailingCase? {
    guard let index = results.firstIndex(where: { !$0.passed && (!$0.hidden || $0.input != nil) }) else { return nil }
    return FailingCase(index: index, result: results[index])
  }

  public static func formatRuntime(_ milliseconds: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "en_US")
    formatter.maximumFractionDigits = 0
    formatter.roundingMode = .halfUp
    return "\(formatter.string(from: NSNumber(value: milliseconds.rounded())) ?? "0") ms"
  }

  /// Memory reads in MB with one decimal, as LeetCode shows it.
  public static func formatMemory(_ kilobytes: Double) -> String {
    String(format: "%.1f MB", kilobytes / 1024)
  }

  /// Recent submissions read as relative time; anything older than a week shows its date.
  public static func relativeTime(_ iso: String, now: Date, timeZone: TimeZone = .current) -> String {
    guard let then = parseTimestamp(iso) else { return iso }
    let elapsed = now.timeIntervalSince(then)
    if elapsed < 60 { return "Just now" }
    if elapsed >= 7 * 86_400 {
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US")
      formatter.timeZone = timeZone
      var calendar = Calendar(identifier: .gregorian)
      calendar.timeZone = timeZone
      formatter.dateFormat = calendar.component(.year, from: then) == calendar.component(.year, from: now) ? "MMM d" : "MMM d, yyyy"
      return formatter.string(from: then)
    }
    if elapsed >= 86_400 {
      let days = Int(elapsed / 86_400)
      return days == 1 ? "Yesterday" : "\(days) days ago"
    }
    if elapsed >= 3_600 {
      let hours = Int(elapsed / 3_600)
      return hours == 1 ? "1 hour ago" : "\(hours) hours ago"
    }
    let minutes = Int(elapsed / 60)
    return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago"
  }

  public static func submittedAt(_ iso: String, timeZone: TimeZone = .current) -> String {
    guard let date = parseTimestamp(iso) else { return iso }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = timeZone
    formatter.dateFormat = "MMM d, yyyy, h:mm a"
    return formatter.string(from: date)
  }

  public static func parseTimestamp(_ iso: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: iso) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    if let date = plain.date(from: iso) { return date }
    // Postgres timestamps can carry microseconds and a short offset (`2026-10-12 12:00:00.123456+00`).
    let normalized = iso.replacingOccurrences(of: " ", with: "T")
    let trimmed = normalized.replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
    let offset = trimmed.replacingOccurrences(of: #"([+-]\d{2})$"#, with: "$1:00", options: .regularExpression)
    return fractional.date(from: offset) ?? plain.date(from: offset)
  }

  /// A submission still running when its request returns is polled soon, then less often, settling at once a second.
  public static func pollDelay(attempt: Int) -> Duration {
    .milliseconds(min(1000, Int((300 * pow(1.5, Double(attempt))).rounded())))
  }

  /// As on LeetCode, the history lists judged submissions; runs stay stored but are not listed.
  public static func listed(_ history: [ProblemSubmission]) -> [ProblemSubmission] { history.filter { $0.mode == .submit } }
}
