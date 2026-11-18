import Foundation

/// The tables the app reads, their primary-key ordering, and which tables each command touches.
public enum ManorTables {
  public static let all: [String] = [
    "profiles", "tasks", "contexts", "scratch_blocks", "saved_task_views",
    "habits", "habit_lifecycle", "habit_entries", "habit_freeze_intents", "habit_freeze_usage", "habit_freeze_grants", "habit_month_pools",
    "mood_focus_entries", "pomodoro_sessions", "note_folders", "note_pages", "note_attachments", "note_versions", "note_suggestions",
    "job_roles", "job_stage_transitions", "job_listings", "leetcode_problems", "leetcode_attempts", "leetcode_notes", "saved_problem_views",
    "problem_practice", "problem_content_versions", "problem_catalog", "problem_catalog_content",
    "kb_entries", "resumes", "weekly_reviews", "action_events", "calendar_accounts", "calendars", "calendar_events"
  ]

  /// Primary keys after owner filtering; reads order by them so pages are deterministic.
  public static let order: [String: [String]] = [
    "profiles": ["user_id"], "tasks": ["id"], "contexts": ["name"], "scratch_blocks": ["id"], "saved_task_views": ["id"],
    "habits": ["id"], "habit_lifecycle": ["habit_id", "date"], "habit_entries": ["habit_id", "date"],
    "habit_freeze_intents": ["habit_id", "date"], "habit_freeze_usage": ["habit_id", "date"], "habit_freeze_grants": ["date"],
    "habit_month_pools": ["month"], "mood_focus_entries": ["date"], "pomodoro_sessions": ["id"], "note_folders": ["id"],
    "note_pages": ["id"], "note_attachments": ["id"], "note_versions": ["note_id", "revision"], "note_suggestions": ["id"],
    "job_roles": ["id"], "job_stage_transitions": ["id"], "job_listings": ["id"], "leetcode_problems": ["id"],
    "leetcode_attempts": ["id"], "leetcode_notes": ["id"], "saved_problem_views": ["id"], "problem_practice": ["problem_id"],
    "problem_content_versions": ["problem_id", "version"], "problem_catalog": ["id"], "problem_catalog_content": ["problem_id"],
    "kb_entries": ["id"], "resumes": ["id"], "weekly_reviews": ["id"], "action_events": ["id"], "calendar_accounts": ["id"],
    "calendars": ["account_id", "id"], "calendar_events": ["account_id", "calendar_id", "id"]
  ]

  /// Tables every account reads whole, with no owner column.
  public static func isShared(_ table: String) -> Bool {
    table == "job_listings" || table == "problem_catalog" || table == "problem_catalog_content"
  }

  /// Every kb_entries column except `embedding`, which only server-side search reads.
  public static func readColumns(_ table: String) -> String {
    table == "kb_entries"
      ? "id,user_id,source,source_ref,url,title,author,summary,content_md,raw,screenshot_path,status,error,captured_at,normalized_at,deleted_at,revision"
      : "*"
  }

  private static let groups: [(operations: [String], tables: [String])] = [
    (["save_profile"], ["profiles"]),
    (["create_context", "update_context", "remove_context"], ["contexts", "tasks"]),
    (["create_task", "update_task", "trash_task", "restore_task", "create_recurring_task", "convert_task_to_series", "skip_task_occurrence", "update_future_task_occurrences"], ["tasks"]),
    (["save_scratch_block", "delete_scratch_block"], ["scratch_blocks"]),
    (["save_task_view", "delete_task_view"], ["saved_task_views"]),
    (["create_note_folder", "update_note_folder"], ["note_folders"]),
    (["create_note", "update_note", "move_note", "archive_note", "trash_note", "restore_note", "restore_note_version", "edit_note_blocks", "move_note_block", "move_note_blocks"], ["note_pages", "note_versions", "note_suggestions"]),
    (["remove_note_folder"], ["note_folders", "note_pages", "note_versions"]),
    (["purge_note"], ["note_pages", "note_versions", "note_suggestions", "note_attachments"]),
    (["touch_note"], ["note_pages"]),
    (["propose_note_edits"], ["note_suggestions"]),
    (["resolve_note_suggestions"], ["note_pages", "note_versions", "note_suggestions"]),
    (["create_application", "update_application", "change_application_stage", "trash_application", "restore_application", "add_job_listing"], ["job_roles", "job_stage_transitions"]),
    (["create_habit", "update_habit", "set_habit_status", "log_habit", "clear_habit_entry", "apply_habit_freeze", "clear_habit_freeze", "reorder_habits"], ["habits", "habit_lifecycle", "habit_entries", "habit_freeze_intents", "habit_freeze_usage", "habit_freeze_grants", "habit_month_pools"]),
    (["log_daily_ratings", "correct_mood_focus_history"], ["mood_focus_entries"]),
    (["start_pomodoro_session", "pause_pomodoro_session", "resume_pomodoro_session", "end_pomodoro_session", "update_pomodoro_session", "delete_pomodoro_session", "log_pomodoro_session"], ["pomodoro_sessions"]),
    (["save_pomodoro_settings"], ["profiles"]),
    (["create_attempt", "update_attempt", "delete_attempt"], ["leetcode_attempts"]),
    (["save_mistake", "delete_mistake"], ["leetcode_notes"]),
    (["save_problem_view", "delete_problem_view"], ["saved_problem_views"]),
    (["save_problem_draft"], []),
    (["save_capture", "remove_capture", "queue_embedding"], ["kb_entries"]),
    (["save_weekly_review"], ["weekly_reviews"]),
    (["allocate_file"], []),
    (["remove_resume"], ["resumes", "job_roles"])
  ]

  /// The tables a command can change, or nil when it is unknown and everything should refresh.
  public static func affected(by operation: String) -> Set<String>? {
    guard let group = groups.first(where: { $0.operations.contains(operation) }) else { return nil }
    return Set(group.tables + ["action_events"])
  }
}

/// One equality filter of a read.
public struct RowFilter: Sendable, Hashable {
  public let column: String
  public let value: JSONValue
  public init(_ column: String, _ value: JSONValue) {
    self.column = column
    self.value = value
  }
}
