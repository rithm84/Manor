import { statusOn } from '../../../shared/habits'
import type { HabitsState } from '../../../shared/habits'
import type { HomeState } from '../../../shared/home'
import type { LeetCodeState } from '../../../shared/leetcode'
import type { MoodFocusState } from '../../../shared/moodFocus'
import type { AlfredRoute } from '../../../shared/alfred'

export type AlfredCompletionKey = 'tasks' | 'habits' | 'mood-focus' | 'leetcode'

export interface AlfredCompletionItem {
  key: AlfredCompletionKey
  label: string
  route: AlfredRoute
  done: number
  total: number
}

export interface AlfredCompletionGlance {
  date: string
  items: readonly AlfredCompletionItem[]
  done: number
  total: number
}

export interface AlfredCompletionSource {
  home: HomeState
  habits: HabitsState
  moodFocus: MoodFocusState
  leetcode: LeetCodeState
}

export function buildAlfredCompletionGlance(source: AlfredCompletionSource): AlfredCompletionGlance {
  const date = source.habits.today
  const dueTasks = source.home.tasks.filter((task) => task.due === date)
  const activeHabits = source.habits.habits.filter(
    (habit) => statusOn(habit.id, date, source.habits.lifecycle) === 'active'
  )
  const completeHabitIds = new Set(
    source.habits.entries
      .filter((entry) => entry.date === date && entry.value === 100)
      .map((entry) => entry.habitId)
  )
  const moodEntry = source.moodFocus.entries.find((entry) => entry.date === date)
  const moodSignals = Number(moodEntry?.mood !== null && moodEntry?.mood !== undefined) +
    Number(moodEntry?.focus !== null && moodEntry?.focus !== undefined)
  const leetCodeDone = source.leetcode.attempts.some((attempt) => attempt.date === date) ? 1 : 0
  const items: readonly AlfredCompletionItem[] = [
    {
      key: 'tasks',
      label: 'Tasks',
      route: '/home',
      done: dueTasks.filter((task) => task.status === 'Done').length,
      total: dueTasks.length
    },
    {
      key: 'habits',
      label: 'Habits',
      route: '/habits',
      done: activeHabits.filter((habit) => completeHabitIds.has(habit.id)).length,
      total: activeHabits.length
    },
    {
      key: 'mood-focus',
      label: 'Mood & Focus',
      route: '/mood-focus',
      done: moodSignals,
      total: 2
    },
    {
      key: 'leetcode',
      label: 'LeetCode',
      route: '/leetcode',
      done: leetCodeDone,
      total: 1
    }
  ]
  return {
    date,
    items,
    done: items.reduce((sum, item) => sum + item.done, 0),
    total: items.reduce((sum, item) => sum + item.total, 0)
  }
}
