import { command, date, domainQuery, edit, id, paging, revision, timestamp, type ManorTool, type ToolSchema } from './toolDefinitions.ts'
const kind: ToolSchema = { type: 'string', enum: ['focus', 'short_break', 'long_break'] }
const label: ToolSchema = { type: ['string', 'null'], maxLength: 120 }
/** Focus and break sessions. The server keeps the clock, so a session's remaining time follows from its start, plan, and paused time. */
export const pomodoroTools: readonly ManorTool[] = [
  domainQuery('query_pomodoro_sessions', 'manor_pomodoro_query', 'Read finished Pomodoro sessions newest first, filtered by local date range and kind, with a focus summary for the range (completed and abandoned counts, focused seconds, active days) and the session currently in progress, if any. Cursor is the last started_at.', { ...paging, from: date, to: date, kind }, []),
  command('start_pomodoro_session', 'Start a focus or break session with a new ID and the planned length in seconds (60 to 14400). Only one session can be in progress; end or delete it first. Zero is the expected revision of a new session.', { ...edit, kind, planned_seconds: { type: 'integer', minimum: 60, maximum: 14400 }, label }, ['id', 'expected_revision', 'kind', 'planned_seconds']),
  command('pause_pomodoro_session', 'Pause the running session at its current revision.', edit, ['id', 'expected_revision']),
  command('resume_pomodoro_session', 'Resume the paused session at its current revision; paused time does not count toward the plan.', edit, ['id', 'expected_revision']),
  command('end_pomodoro_session', 'End the session in progress. Outcome completed is accepted only once the planned time has run out and counts the session; abandoned ends it early and keeps the focused time so far without counting it.', { ...edit, outcome: { type: 'string', enum: ['completed', 'abandoned'] } }, ['id', 'expected_revision', 'outcome']),
  command('log_pomodoro_session', 'Record a completed focus session that already happened, from its start instant and focused seconds (60 to 14400). Use for sessions timed elsewhere; the end must be in the past.', { ...edit, started_at: timestamp, focused_seconds: { type: 'integer', minimum: 60, maximum: 14400 }, label }, ['id', 'expected_revision', 'started_at', 'focused_seconds']),
  command('update_pomodoro_session', 'Change what a session was for. Null clears the label.', { ...edit, label }, ['id', 'expected_revision', 'label']),
  command('delete_pomodoro_session', 'Remove a session permanently at its current revision, including one in progress.', { id, expected_revision: revision }, ['id', 'expected_revision'])
]
