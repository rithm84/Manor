import type { HabitEntry, HabitsState } from '../../../shared/habits'

/** One click's intent, held from the optimistic update until that same click
    settles. `sequence` rises with every click, so a slower earlier click can
    tell that a later one has taken over the box. */
export interface PendingEntry {
  sequence: number
  habitId: string
  date: string
  /** Percent complete the click asked for; 0 clears the entry. */
  value: number
  /** Timestamp the optimistic entry carries, so the overlay stays pure. */
  stamp: string
}

export function pendingEntryKey(habitId: string, date: string): string {
  return `${habitId}|${date}`
}

/** Replays the clicks still in flight over a state that came from elsewhere,
    so a returning server result or a reload cannot re-check a box the user
    has already cleared, whichever day each click belonged to. */
export function overlayPendingEntries(state: HabitsState, pending: ReadonlyMap<string, PendingEntry>): HabitsState {
  if (pending.size === 0) return state
  const kept = state.entries.filter((entry) => !pending.has(pendingEntryKey(entry.habitId, entry.date)))
  const applied = [...pending.values()].flatMap((intent): HabitEntry[] =>
    intent.value === 0
      ? []
      : [{ habitId: intent.habitId, date: intent.date, value: intent.value, createdAt: intent.stamp, updatedAt: intent.stamp }]
  )
  return { ...state, entries: [...kept, ...applied] }
}
