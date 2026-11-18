# Tracking and Pomodoro

_Last updated: 2026-11-18_

[Back to Manor architecture](../ARCHITECTURE.md)

Tracking logs habits, mood, and focus on one page, and Pomodoro times focus sessions. The rules they implement are in the PRD's [streak system](../PRD.md#streak-system), [Tracking](../PRD.md#tracking), and [Pomodoro](../PRD.md#pomodoro) sections.

## Habits

Habit records are definitions (`habits`), lifecycle changes (`habit_lifecycle`), dated entries (`habit_entries`), freeze intents and usage, monthly grants, and month pools. Postgres derives the streak and pool state from entries and intents instead of keeping a competing mutable truth; the app reads it with `manor_habits_state`, which the [local mirror](local-mirror-and-sync.md#serving-reads) caches against its cursor and the account-local day.

`HabitsService` (`ManorKit/Domain/Habits/`) runs mutations one at a time, so each sends the revisions committed by the one before it, and answers every mutation with the reloaded state; a load that a newer one already answered is dropped. The commands are `create_habit`, `update_habit`, `set_habit_status` (pause, retire, and reactivate), `reorder_habits`, `log_habit`, `clear_habit_entry`, `apply_habit_freeze`, and `clear_habit_freeze`. There is no permanent habit deletion.

The pure rules live in `ManorKit` and are covered by unit tests: `HabitStreaks` holds the streak rules, day marks, and the quantized step ladder derived from a target label; `HabitParsing` reads `manor_habits_state` and table rows into domain values and refuses anything malformed; and `HabitDates` does calendar arithmetic on account-local dates. Completion rates count eligible days only, so periods before creation, paused or retired periods, and future dates never count as misses.

## Mood and focus

A day is one `mood_focus_entries` row keyed by account and date, with independent Mood and Focus values and at least one of them set. Quick capture saves with `log_daily_ratings`, which accepts today or yesterday at the day's revision; an omitted rating keeps its saved value and a null clears it. The History editor uses `correct_mood_focus_history`, an account-authenticated command that accepts any past date, checks the revision, and refuses agent tokens. `MoodFocus.swift` holds the scales, scale words for averages, monthly trends with rest days excluded from focus, and per-level distributions. Daily records hold ratings only.

## The Tracking page

`TrackingPage` has Daily and History tabs. Daily shows the day bar, the mood and focus check-in rows with their week strip, and the habit list with week strips, the freeze pool, and an Archived section. A missed row on the Yesterday view shows a Freeze control that spends or returns a freeze. History, under one month navigator, shows the month's numbers, then Trends: habit completion and mood and focus as two separate charts under one 3, 6, or 12-month range, each with its own readout and hover (side by side when the window is wide). Below them come the month calendar of days, and each habit's month beside the mood and focus distributions. Sort order, the archived toggle, and the last tab are remembered on the Mac.

## Pomodoro

Sessions are `pomodoro_sessions` rows; a partial unique index allows one running or paused session per account. Timer preferences are account settings saved with `save_pomodoro_settings`. The app drives sessions with `start_pomodoro_session`, `pause_pomodoro_session`, `resume_pomodoro_session`, `end_pomodoro_session`, `update_pomodoro_session`, and `delete_pomodoro_session`; agents can also log a past session with `log_pomodoro_session`.

`Pomodoro.swift` computes the remaining time from the start and pauses rather than a ticking counter, so the timer stays correct across sleep and relaunch, and computes month statistics and the informational day streak. The page publishes its countdown to the sidebar badge through `AppContext.pomodoroBadge`. Completion sounds are bundled WAV files played with `AVAudioPlayer` when sounds are on.
