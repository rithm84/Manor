import Foundation
@testable import ManorKit
import Testing

private let today = "2026-11-17"

private func expectProblem(_ fragment: String, sourceLocation: SourceLocation = #_sourceLocation, _ body: () throws -> Void) {
  do {
    try body()
    Issue.record("Expected an argument error containing \"\(fragment)\"", sourceLocation: sourceLocation)
  } catch let error as ManorToolArgumentError {
    #expect(error.message.contains(fragment), "\(error.message)", sourceLocation: sourceLocation)
  } catch {
    Issue.record("Unexpected error \(error)", sourceLocation: sourceLocation)
  }
}

@Suite("Alfred tool catalog")
struct AlfredToolCatalogSchemaTests {
  @Test func everyToolIsListedOnceWithASnakeCaseName() {
    let names = ManorToolCatalog.all.map(\.name.rawValue)
    #expect(Set(names).count == names.count)
    #expect(Set(names) == Set(ManorToolName.allCases.map(\.rawValue)))
    for name in names {
      #expect(name.range(of: #"^[a-z][a-z0-9]*(_[a-z0-9]+)*$"#, options: .regularExpression) != nil, "\(name)")
      #expect(name.count <= 64)
    }
  }

  @Test func everySchemaIsAClosedObjectWhoseRequiredKeysExist() throws {
    for spec in ManorToolCatalog.all {
      let schema = spec.parameters
      #expect(schema["type"] as? String == "object", "\(spec.name)")
      #expect(schema["additionalProperties"] as? Bool == false, "\(spec.name)")
      let properties = try #require(schema["properties"] as? [String: Any], "\(spec.name)")
      let required = try #require(schema["required"] as? [String], "\(spec.name)")
      #expect(Set(required).count == required.count)
      for key in required { #expect(properties[key] != nil, "\(spec.name).\(key)") }
      #expect(!spec.description.isEmpty)
      #expect(!spec.description.contains("\u{2014}"), "\(spec.name) uses an em dash")
      for (key, value) in properties {
        let property = try #require(value as? [String: Any], "\(spec.name).\(key)")
        let type = try #require(property["type"] as? String, "\(spec.name).\(key)")
        #expect(["string", "integer", "number", "boolean", "array", "object"].contains(type))
        #expect(key.range(of: #"^[a-z][a-z0-9_]*$"#, options: .regularExpression) != nil, "\(spec.name).\(key)")
        #expect(!(property["description"] as? String ?? "").isEmpty, "\(spec.name).\(key)")
        if type == "array" { #expect((property["items"] as? [String: Any])?["type"] as? String == "string") }
      }
      // The schema survives JSON encoding, as it must to reach the model.
      #expect(JSONSerialization.isValidJSONObject(schema), "\(spec.name)")
    }
  }

  @Test func catalogEnumsMatchTheDomain() {
    #expect(ManorToolCatalog.stages.contains("interview_2"))
    #expect(ManorToolCatalog.moods == ["Great", "Good", "Neutral", "Bad", "Awful"])
    #expect(ManorToolCatalog.focuses.contains("Locked In"))
    #expect(ManorToolCatalog.pomodoroKinds == ["focus", "short_break", "long_break"])
    #expect(ManorToolCatalog.priorities == ["Low", "Medium", "High", "None"])
  }
}

@Suite("Alfred tool arguments")
struct AlfredToolArgumentTests {
  @Test func datesResolveInTheAccountDay() throws {
    #expect(try ManorToolDates.resolve("today", today: today) == "2026-11-17")
    #expect(try ManorToolDates.resolve("Tomorrow", today: today) == "2026-11-18")
    #expect(try ManorToolDates.resolve("yesterday", today: "2026-03-01") == "2026-02-28")
    #expect(try ManorToolDates.resolve("2026-12-31", today: today) == "2026-12-31")
    expectProblem("YYYY-MM-DD") { _ = try ManorToolDates.resolve("2026-02-30", today: today) }
    expectProblem("YYYY-MM-DD") { _ = try ManorToolDates.resolve("next week", today: today) }
  }

  @Test func setTasksDoneAcceptsListsAndDefaultsToDone() throws {
    let parsed = try ManorSetTasksDoneArgs.parse(["tasks": ["a", " b ", "A", ""], "done": false])
    #expect(parsed.targets == ["a", "b"])
    #expect(parsed.done == false)
    #expect(try ManorSetTasksDoneArgs.parse(["tasks": ["a"]]).done)
    // JSON numbers arrive as NSNumber; a boolean is still told apart from 1.
    #expect(try ManorSetTasksDoneArgs.parse(["tasks": ["a"], "done": NSNumber(value: true)]).done)
  }

  @Test func setTasksDoneRejectsBadInput() {
    expectProblem("tasks is required") { _ = try ManorSetTasksDoneArgs.parse([:]) }
    expectProblem("at least one") { _ = try ManorSetTasksDoneArgs.parse(["tasks": [" "]]) }
    expectProblem("list of IDs") { _ = try ManorSetTasksDoneArgs.parse(["tasks": [3]]) }
    expectProblem("true or false") { _ = try ManorSetTasksDoneArgs.parse(["tasks": ["a"], "done": "yes"]) }
    expectProblem("true or false") { _ = try ManorSetTasksDoneArgs.parse(["tasks": ["a"], "done": NSNumber(value: 1)]) }
    expectProblem("at most 50") { _ = try ManorSetTasksDoneArgs.parse(["tasks": (0..<51).map { "t\($0)" }]) }
  }

  @Test func findTasksParsesFilters() throws {
    let query = try ManorTaskQuery.parse(["query": "essay", "due_on": "tomorrow", "status": "ALL", "limit": 5], today: today)
    #expect(query == ManorTaskQuery(text: "essay", dueFrom: "2026-11-18", dueTo: "2026-11-18", status: .all, limit: 5))
    let defaults = try ManorTaskQuery.parse([:], today: today)
    #expect(defaults.status == .open && defaults.limit == 20 && defaults.dueFrom == nil)
    expectProblem("due_from must be on or before") { _ = try ManorTaskQuery.parse(["due_from": "2026-11-20", "due_to": "2026-11-18"], today: today) }
    expectProblem("between 1 and 50") { _ = try ManorTaskQuery.parse(["limit": 500], today: today) }
    expectProblem("whole number") { _ = try ManorTaskQuery.parse(["limit": 2.5], today: today) }
    expectProblem("open, done, all") { _ = try ManorTaskQuery.parse(["status": "pending"], today: today) }
  }

  @Test func findTasksFiltersAndOrders() throws {
    let tasks = [
      TaskItem(id: "1", title: "Essay draft", context: "School", due: "2026-11-18", dueTime: "09:00"),
      TaskItem(id: "2", title: "Read essay notes", context: "School", status: .done, due: "2026-11-18"),
      TaskItem(id: "3", title: "Gym", context: "Personal", due: "2026-11-16"),
      TaskItem(id: "4", title: "Essay outline", context: "School", due: "2026-11-17")
    ]
    let open = try ManorTaskQuery.parse(["query": "essay"], today: today).run(tasks)
    #expect(open.tasks.map(\.id) == ["4", "1"])
    let overdue = try ManorTaskQuery.parse(["due_to": "yesterday"], today: today).run(tasks)
    #expect(overdue.tasks.map(\.id) == ["3"])
    let limited = try ManorTaskQuery.parse(["status": "all", "limit": 1], today: today).run(tasks)
    #expect(limited.tasks.count == 1 && limited.total == 4)
  }

  @Test func createTaskParsesAndValidates() throws {
    let task = try ManorCreateTaskArgs.parse(["title": " Buy milk ", "due": "tomorrow", "due_time": "9:30", "priority": "high", "estimate_minutes": 30, "context": "Personal"], today: today)
    #expect(task == ManorCreateTaskArgs(title: "Buy milk", due: "2026-11-18", dueTime: "09:30", context: "Personal", priority: .high, estimate: .halfHour))
    #expect(try ManorCreateTaskArgs.parse(["title": "Call home"], today: today).due == today)
    expectProblem("title is required") { _ = try ManorCreateTaskArgs.parse(["title": "  "], today: today) }
    expectProblem("HH:MM") { _ = try ManorCreateTaskArgs.parse(["title": "x", "due_time": "25:00"], today: today) }
    expectProblem("15, 30, 60") { _ = try ManorCreateTaskArgs.parse(["title": "x", "estimate_minutes": 45], today: today) }
    expectProblem("at most 300") { _ = try ManorCreateTaskArgs.parse(["title": String(repeating: "x", count: 301)], today: today) }
  }

  @Test func rescheduleAndPriority() throws {
    let moved = try ManorRescheduleArgs.parse(["tasks": ["a"], "due": "2026-11-20", "due_time": "none"], today: today)
    #expect(moved.due == "2026-11-20" && moved.time == .clear)
    #expect(try ManorRescheduleArgs.parse(["tasks": ["a"], "due": "today"], today: today).time == .keep)
    #expect(try ManorRescheduleArgs.parse(["tasks": ["a"], "due": "today", "due_time": "18:45"], today: today).time == .set("18:45"))
    expectProblem("due is required") { _ = try ManorRescheduleArgs.parse(["tasks": ["a"]], today: today) }
    #expect(try ManorPriorityArgs.parse(["tasks": ["a"], "priority": "None"]).priority == nil)
    #expect(try ManorPriorityArgs.parse(["tasks": ["a"], "priority": "medium"]).priority == .medium)
    expectProblem("priority must be one of") { _ = try ManorPriorityArgs.parse(["tasks": ["a"], "priority": "Urgent"]) }
  }

  @Test func habitCheckOffsFollowTheHabitKind() throws {
    let binary = try ManorLogHabitArgs.parse(["habit": "Read"], today: today)
    #expect(binary.date == today && binary.amount == .done(true))
    #expect(try ManorLogHabitArgs.value(for: binary.amount, kind: .binary, targetLabel: nil) == 100)
    #expect(try ManorLogHabitArgs.value(for: .done(false), kind: .binary, targetLabel: nil) == 0)

    let tablets = try ManorLogHabitArgs.parse(["habit": "Vitamins", "date": "yesterday", "amount": 2], today: today)
    #expect(tablets.date == "2026-11-16")
    #expect(try ManorLogHabitArgs.value(for: tablets.amount, kind: .quantized, targetLabel: "3 tablets") == 66)
    #expect(try ManorLogHabitArgs.value(for: .units(3), kind: .quantized, targetLabel: "3 tablets") == 100)
    #expect(try ManorLogHabitArgs.value(for: .percent(60), kind: .quantized, targetLabel: "Read for an hour") == 50)
    #expect(try ManorLogHabitArgs.value(for: .percent(60), kind: .quantized, targetLabel: "Run 5km") == 60)
    #expect(try ManorLogHabitArgs.value(for: .done(true), kind: .quantized, targetLabel: "3 tablets") == 100)

    expectProblem("today or yesterday") { _ = try ManorLogHabitArgs.parse(["habit": "Read", "date": "2026-11-10"], today: today) }
    expectProblem("only one of") { _ = try ManorLogHabitArgs.parse(["habit": "Read", "done": true, "percent": 50], today: today) }
    expectProblem("habit is required") { _ = try ManorLogHabitArgs.parse([:], today: today) }
    expectProblem("must be 3 or less") { _ = try ManorLogHabitArgs.value(for: .units(4), kind: .quantized, targetLabel: "3 tablets") }
    expectProblem("use percent") { _ = try ManorLogHabitArgs.value(for: .units(1), kind: .quantized, targetLabel: "Run 1.5 miles") }
    expectProblem("one-tap") { _ = try ManorLogHabitArgs.value(for: .percent(50), kind: .binary, targetLabel: nil) }
  }

  @Test func dailyRatingsSendOnlyStatedSignals() throws {
    let ratings = try ManorDailyRatingsArgs.parse(["mood": "good"], today: today)
    #expect(ratings.mood == .good && ratings.focus == nil && ratings.date == today)
    let input = ratings.commandInput(revision: 4)
    #expect(input == ["date": "2026-11-17", "expected_revision": 4, "mood": "Good"])
    #expect(input["focus"] == nil)
    let both = try ManorDailyRatingsArgs.parse(["date": "yesterday", "mood": "Bad", "focus": "Resting"], today: today)
    #expect(both.commandInput(revision: 0) == ["date": "2026-11-16", "expected_revision": 0, "mood": "Bad", "focus": "Resting"])
    expectProblem("mood, a focus rating, or both") { _ = try ManorDailyRatingsArgs.parse([:], today: today) }
    expectProblem("mood must be one of") { _ = try ManorDailyRatingsArgs.parse(["mood": "Fine"], today: today) }
    expectProblem("today or yesterday") { _ = try ManorDailyRatingsArgs.parse(["mood": "Good", "date": "tomorrow"], today: today) }
  }

  @Test func pomodoroStart() throws {
    #expect(try ManorPomodoroStartArgs.parse([:]) == ManorPomodoroStartArgs(kind: .focus, label: nil, minutes: nil))
    #expect(try ManorPomodoroStartArgs.parse(["kind": "short_break", "minutes": 10]).minutes == 10)
    expectProblem("between 1 and 180") { _ = try ManorPomodoroStartArgs.parse(["minutes": 0]) }
    expectProblem("kind must be one of") { _ = try ManorPomodoroStartArgs.parse(["kind": "nap"]) }
  }

  @Test func roleMovesSetTheStageDateOnlyWhenGiven() throws {
    let fields = JobRoleFields(company: "Stripe", role: "SWE Intern", stage: .applied, appliedDate: "2026-10-01")
    let undated = try ManorMoveRoleArgs.parse(["role": "Stripe", "stage": "oa"], today: today)
    let moved = undated.applied(to: fields)
    #expect(moved.stage == .oa && moved.oaDueDate == nil && moved.appliedDate == "2026-10-01")
    let dated = try ManorMoveRoleArgs.parse(["role": "Stripe", "stage": "interview_1", "date": "2026-11-20"], today: today)
    #expect(dated.applied(to: fields).interview1Date == "2026-11-20")
    expectProblem("stage must be one of") { _ = try ManorMoveRoleArgs.parse(["role": "Stripe", "stage": "phone_screen"], today: today) }
    expectProblem("role is required") { _ = try ManorMoveRoleArgs.parse(["stage": "oa"], today: today) }
    #expect(try ManorMarkOADoneArgs.parse(["role": "x"], today: today).date == today)
    expectProblem("future") { _ = try ManorMarkOADoneArgs.parse(["role": "x", "date": "tomorrow"], today: today) }
  }

  @Test func notesAndNavigation() throws {
    let note = try ManorCreateNoteArgs.parse(["title": "  Plan ", "markdown": "# Goals\n\n- One"])
    #expect(note.title == "Plan" && note.markdown.hasPrefix("# Goals"))
    expectProblem("title is required") { _ = try ManorCreateNoteArgs.parse(["markdown": "x"]) }
    expectProblem("300 characters") { _ = try ManorCreateNoteArgs.parse(["title": String(repeating: "x", count: 301)]) }
    expectProblem("markdown is required") { _ = try ManorAppendNoteArgs.parse(["markdown": "  \n"]) }
    #expect(try ManorOpenPageArgs.parse(["page": "Jobs"]).page == "jobs")
    expectProblem("page must be one of") { _ = try ManorOpenPageArgs.parse(["page": "calendar"]) }
  }

  @Test func markdownBecomesBlocksWithIdsAndHeadings() {
    let blocks = ManorNoteContent.blocks(fromMarkdown: "# Plan\n\nIntro\n\n## Week one\n\n- item")
    let ids = ManorNoteContent.ids(blocks)
    #expect(ids.count == blocks.count && Set(ids).count == ids.count && !ids.contains(""))
    let headings = ManorNoteContent.headings(in: blocks)
    #expect(headings.map(\.title) == ["Plan", "Week one"])
    #expect(headings.map(\.level) == [1, 2])
  }
}

@Suite("Alfred target matching")
struct AlfredTargetMatchingTests {
  private let tasks = [
    ManorTargetCandidate(id: "t1", title: "Gym", detail: "due Nov 16"),
    ManorTargetCandidate(id: "t2", title: "Gym", detail: "due Nov 17"),
    ManorTargetCandidate(id: "t3", title: "Essay draft"),
    ManorTargetCandidate(id: "t4", title: "Essay outline"),
    ManorTargetCandidate(id: "t5", title: "Call Mom")
  ]

  @Test func idsAndUniqueTitlesResolve() {
    #expect(ManorTargetMatcher.match("T3", in: tasks) == .one(tasks[2]))
    #expect(ManorTargetMatcher.match("call mom", in: tasks) == .one(tasks[4]))
    #expect(ManorTargetMatcher.match("outline", in: tasks) == .one(tasks[3]))
    #expect(ManorTargetMatcher.match("ess out", in: tasks) == .one(tasks[3]))
  }

  @Test func ambiguousTitlesReturnEveryCandidate() {
    guard case .ambiguous(let essays) = ManorTargetMatcher.match("essay", in: tasks) else {
      Issue.record("Expected several essays")
      return
    }
    #expect(essays.map(\.id) == ["t3", "t4"])
    guard case .ambiguous(let gyms) = ManorTargetMatcher.match("gym", in: tasks) else {
      Issue.record("Expected several gym tasks")
      return
    }
    #expect(gyms.count == 2)
    let message = ManorTargetMatcher.problem("gym", kind: "task", match: .ambiguous(gyms))
    #expect(message?.contains("[t1]") == true && message?.contains("[t2]") == true && message?.contains("Ask which one") == true)
  }

  @Test func aPreferenceBreaksATieOnlyWhenItPicksOne() {
    #expect(ManorTargetMatcher.match("gym", in: tasks, preferred: { $0.detail == "due Nov 17" }) == .one(tasks[1]))
    guard case .ambiguous = ManorTargetMatcher.match("gym", in: tasks, preferred: { _ in true }) else {
      Issue.record("Expected the tie to stand")
      return
    }
  }

  @Test func exactTitlesBeatPartialOnes() {
    let roles = [ManorTargetCandidate(id: "r1", title: "Stripe SWE Intern"), ManorTargetCandidate(id: "r2", title: "Stripe")]
    #expect(ManorTargetMatcher.match("stripe", in: roles) == .one(roles[1]))
  }

  @Test func missesSuggestTheClosestRecords() {
    let match = ManorTargetMatcher.match("essays due", in: tasks)
    guard case .none(let suggestions) = match else {
      Issue.record("Expected no match")
      return
    }
    #expect(suggestions.map(\.id).contains("t3"))
    #expect(ManorTargetMatcher.problem("essays due", kind: "task", match: match)?.hasPrefix("No task matches") == true)
    #expect(ManorTargetMatcher.match("zzz", in: tasks) == .none(suggestions: []))
  }

  @Test func normalizingFoldsCaseAccentsAndPunctuation() {
    #expect(ManorTargetMatcher.normalize("  Café — Résumé!! ") == "cafe resume")
    #expect(ManorTargetMatcher.contains("Interview prep: Google", "inter goog"))
    #expect(!ManorTargetMatcher.contains("Interview prep", "prep zebra"))
  }
}
