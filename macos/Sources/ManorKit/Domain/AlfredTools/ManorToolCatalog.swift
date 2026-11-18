import Foundation

// The tools in-app Alfred can call to act in Manor: names, descriptions written for the model, and JSON Schema
// parameters. The app maps each entry to Alfred's tool type and runs it; this file only describes them.

/// Every tool Manor offers Alfred, by its function name.
public enum ManorToolName: String, CaseIterable, Sendable, Hashable {
  case findTasks = "find_tasks"
  case createTask = "create_task"
  case setTasksDone = "set_tasks_done"
  case rescheduleTasks = "reschedule_tasks"
  case setTaskPriority = "set_task_priority"
  case logHabit = "log_habit"
  case logDailyRatings = "log_daily_ratings"
  case startPomodoro = "start_pomodoro"
  case pausePomodoro = "pause_pomodoro"
  case resumePomodoro = "resume_pomodoro"
  case stopPomodoro = "stop_pomodoro"
  case findRoles = "find_roles"
  case moveRoleStage = "move_role_stage"
  case markOADone = "mark_oa_done"
  case createNote = "create_note"
  case appendToCurrentNote = "append_to_current_note"
  case openPage = "open_page"
}

/// One tool: its name, what it does for the model, and its parameter schema.
public struct ManorToolSpec: @unchecked Sendable {
  public let name: ManorToolName
  public let description: String
  /// A JSON Schema object with `properties`, `required`, and `additionalProperties: false`.
  public let parameters: [String: Any]
}

public enum ManorToolCatalog {
  /// Pages `open_page` accepts, in sidebar order (the app's route identifiers).
  public static let pages = ["home", "tracking", "pomodoro", "problems", "jobs", "notes", "bookmarks", "settings"]
  public static let taskStatuses = ["open", "done", "all"]
  public static let priorities = TaskPriority.allCases.map(\.rawValue) + ["None"]
  public static let estimates = TaskEstimate.allCases.map(\.rawValue)
  public static let moods = Mood.allCases.map(\.rawValue)
  public static let focuses = Focus.allCases.map(\.rawValue)
  public static let pomodoroKinds = PomodoroKind.allCases.map(\.rawValue)
  public static let stages = JobStage.allCases.map(\.rawValue)

  public static func spec(_ name: ManorToolName) -> ManorToolSpec {
    all.first { $0.name == name }!
  }

  public static let all: [ManorToolSpec] = [
    // MARK: Tasks
    ManorToolSpec(
      name: .findTasks,
      description: """
        Search Manor tasks by title text, due date, and status. Returns each task's ID, title, due date and time, \
        priority, status, and context. Use it to get IDs before changing tasks the page snapshot doesn't list.
        """,
      parameters: object([
        "query": string("Words to look for in task titles."),
        "due_on": string("Only tasks due on this day. \(dateHint)"),
        "due_from": string("Only tasks due on or after this day. \(dateHint)"),
        "due_to": string("Only tasks due on or before this day. \(dateHint)"),
        "status": string("open (not done, the default), done, or all.", options: taskStatuses),
        "limit": integer("Most tasks to return (default 20).", minimum: 1, maximum: 50)
      ])
    ),
    ManorToolSpec(
      name: .createTask,
      description: """
        Create a task. Every task belongs to a context (such as School or Personal); pass the context the user names. \
        When the user didn't name one and the account has several, the call fails with the list so you can ask.
        """,
      parameters: object([
        "title": string("The task title, up to 300 characters."),
        "due": string("Due day; defaults to today. \(dateHint)"),
        "due_time": string("Optional due time, 24-hour HH:MM in the account time zone."),
        "context": string("The context name."),
        "priority": string("Optional priority.", options: TaskPriority.allCases.map(\.rawValue)),
        "estimate_minutes": integer("Optional time estimate in minutes: 15, 30, 60, 120, 180, or 240.", options: estimates)
      ], required: ["title"])
    ),
    ManorToolSpec(
      name: .setTasksDone,
      description: "Complete tasks, or reopen completed ones with done set to false. Accepts several tasks at once.",
      parameters: object([
        "tasks": targets("Task IDs from the snapshot or find_tasks; a title works when it names one task."),
        "done": boolean("true completes (the default), false reopens.")
      ], required: ["tasks"])
    ),
    ManorToolSpec(
      name: .rescheduleTasks,
      description: "Move tasks to a new due day, optionally setting or clearing the due time.",
      parameters: object([
        "tasks": targets("Task IDs from the snapshot or find_tasks; a title works when it names one task."),
        "due": string("The new due day. \(dateHint)"),
        "due_time": string("Optional new due time as 24-hour HH:MM, or none to clear it. Leave it out to keep each task's time.")
      ], required: ["tasks", "due"])
    ),
    ManorToolSpec(
      name: .setTaskPriority,
      description: "Set or clear the priority of tasks.",
      parameters: object([
        "tasks": targets("Task IDs from the snapshot or find_tasks; a title works when it names one task."),
        "priority": string("High, Medium, Low, or None to clear it.", options: priorities)
      ], required: ["tasks", "priority"])
    ),

    // MARK: Tracking
    ManorToolSpec(
      name: .logHabit,
      description: """
        Check off a habit for today or yesterday. One-tap habits take done. Habits with a daily target (such as \
        3 tablets) take amount in the target's units, or percent; done alone logs the full target. done set to \
        false clears the day.
        """,
      parameters: object([
        "habit": string("The habit's ID from the snapshot, or its name."),
        "date": string("today (the default) or yesterday.", options: ["today", "yesterday"]),
        "done": boolean("true logs the full target, false clears the day."),
        "amount": integer("Units done toward a counted target, such as 2 of 3 tablets.", minimum: 0, maximum: 1000),
        "percent": integer("Share of the target done, 0 to 100; it rounds to the habit's nearest step.", minimum: 0, maximum: 100)
      ], required: ["habit"])
    ),
    ManorToolSpec(
      name: .logDailyRatings,
      description: """
        Save the day's mood and focus check-in for today or yesterday. Send only the ratings the user stated; an \
        omitted rating keeps its saved value. Save ratings the user says outright; ask before saving one you inferred.
        """,
      parameters: object([
        "date": string("today (the default) or yesterday.", options: ["today", "yesterday"]),
        "mood": string("Mood rating.", options: moods),
        "focus": string("Focus rating. Resting is a deliberate day off.", options: focuses)
      ])
    ),

    // MARK: Pomodoro
    ManorToolSpec(
      name: .startPomodoro,
      description: "Start a Pomodoro session. Only one session runs or is paused at a time. Lengths come from the user's Pomodoro preferences unless minutes is given.",
      parameters: object([
        "kind": string("focus (the default), short_break, or long_break.", options: pomodoroKinds),
        "label": string("Optional label for a focus session, up to 120 characters."),
        "minutes": integer("Optional planned length in minutes.", minimum: 1, maximum: PomodoroLimits.minutes)
      ])
    ),
    ManorToolSpec(name: .pausePomodoro, description: "Pause the running Pomodoro session.", parameters: object([:])),
    ManorToolSpec(name: .resumePomodoro, description: "Resume the paused Pomodoro session.", parameters: object([:])),
    ManorToolSpec(
      name: .stopPomodoro,
      description: "Stop the current Pomodoro session early. Its focused time is kept and it reads as stopped.",
      parameters: object([:])
    ),

    // MARK: Jobs
    ManorToolSpec(
      name: .findRoles,
      description: "Search tracked job applications by company or role text and stage. Returns IDs, company, role, stage, and key dates.",
      parameters: object([
        "query": string("Words to look for in the company or role."),
        "stage": string("Only roles at this stage.", options: stages),
        "limit": integer("Most roles to return (default 20).", minimum: 1, maximum: 50)
      ])
    ),
    ManorToolSpec(
      name: .moveRoleStage,
      description: """
        Move an application to another stage: to_apply, applied, oa, interview_1, interview_2, interview_3, offer, \
        or rejected. Pass date only when the user gave one; it sets the stage's date (applied date, OA due date, \
        interview date, or decision date). Never assume rejection or a date.
        """,
      parameters: object([
        "role": string("The role's ID, or its company and role text."),
        "stage": string("The destination stage.", options: stages),
        "date": string("The stage's date, only when the user gave it. \(dateHint)")
      ], required: ["role", "stage"])
    ),
    ManorToolSpec(
      name: .markOADone,
      description: "Record that a role's online assessment is done.",
      parameters: object([
        "role": string("The role's ID, or its company and role text."),
        "date": string("The day the OA was completed; defaults to today. \(dateHint)")
      ], required: ["role"])
    ),

    // MARK: Notes
    ManorToolSpec(
      name: .createNote,
      description: "Create a note with a title and Markdown content.",
      parameters: object([
        "title": string("The note title, up to 300 characters."),
        "markdown": string("The note's content as Markdown.")
      ], required: ["title"])
    ),
    ManorToolSpec(
      name: .appendToCurrentNote,
      description: "Add Markdown to the end of the note open on the Notes page. Fails when no note is open.",
      parameters: object(["markdown": string("The content to add, as Markdown.")], required: ["markdown"])
    ),

    // MARK: Navigation
    ManorToolSpec(
      name: .openPage,
      description: "Show a Manor page.",
      parameters: object(["page": string("The page to show.", options: pages)], required: ["page"])
    )
  ]

  // MARK: Schema helpers

  static let dateHint = "Use today, tomorrow, yesterday, or YYYY-MM-DD in the account time zone."

  static func object(_ properties: [String: [String: Any]], required: [String] = []) -> [String: Any] {
    ["type": "object", "properties": properties, "required": required, "additionalProperties": false]
  }

  static func string(_ description: String, options: [String]? = nil) -> [String: Any] {
    var schema: [String: Any] = ["type": "string", "description": description]
    if let options { schema["enum"] = options }
    return schema
  }

  static func integer(_ description: String, minimum: Int? = nil, maximum: Int? = nil, options: [Int]? = nil) -> [String: Any] {
    var schema: [String: Any] = ["type": "integer", "description": description]
    if let minimum { schema["minimum"] = minimum }
    if let maximum { schema["maximum"] = maximum }
    if let options { schema["enum"] = options }
    return schema
  }

  static func boolean(_ description: String) -> [String: Any] {
    ["type": "boolean", "description": description]
  }

  static func targets(_ description: String) -> [String: Any] {
    ["type": "array", "description": description, "items": ["type": "string"], "minItems": 1, "maxItems": ManorToolArguments.maxTargets]
  }
}
