/**
 * Manor mock data — the canonical story from docs/design/canvas/SPEC.md §B.
 * Today is Thursday, August 20, 2026. User: user.
 *
 * This is the single data source for every page. Page agents import from
 * here; nobody invents parallel data. All dates are ISO strings in local
 * time. Times are 24h "HH:MM".
 */

import type { ContextDefinition, Task } from '../../shared/home'
import type { JobRole, JobStage, JobStageTransition } from '../../shared/jobs'
import type { MoodFocusEntry } from '../../shared/moodFocus'
export type {
  ContextColor,
  ContextDefinition,
  ContextDraft,
  ContextIcon,
  ScratchBlock,
  Task,
  TaskEstimateMinutes,
  TaskPriority,
  TaskStatus
} from '../../shared/home'
export {
  FOCUS_SCALE,
  MOOD_SCALE
} from '../../shared/moodFocus'
export type { Focus, Mood, MoodFocusEntry } from '../../shared/moodFocus'

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export const TODAY_ISO = '2026-08-20'
export const TODAY_LABEL = 'Wednesday, August 20'
export const NOW_TIME = '13:00'

export interface User {
  name: string
  email: string
  initials: string
}

export const user: User = {
  name: 'user',
  email: 'user@example.com',
  initials: 'R'
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

/** One cell of a habit's 7-day week strip (Mon..Sun; today = Wednesday). */
export type HabitDayMark = 'done' | 'missed' | 'frozen' | 'pending' | 'future'

export interface QuantizedControl {
  /** Allowed stops, in percent of target. */
  steps: readonly number[]
  /** Current value in percent (must be one of steps). */
  value: number
  /** Human target, e.g. "48 oz". */
  targetLabel: string
}

export interface Habit {
  id: string
  name: string
  doneToday: boolean
  streak: number
  bestStreak: number
  /** Gold badge = 7+ freeze-free days. */
  gold: boolean
  /** Streak breaks tonight if not logged. */
  atRiskTonight: boolean
  /** Mon..Sun for the current week (Aug 18–24). */
  week: readonly [
    HabitDayMark,
    HabitDayMark,
    HabitDayMark,
    HabitDayMark,
    HabitDayMark,
    HabitDayMark,
    HabitDayMark
  ]
  /** Non-null for quantized habits (e.g. Water at 0/25/50/75/100). */
  quantized: QuantizedControl | null
}

const doneWeek = (todayDone: boolean): Habit['week'] => [
  'done',
  'done',
  todayDone ? 'done' : 'pending',
  'future',
  'future',
  'future',
  'future'
]

export const habits: readonly Habit[] = [
  {
    id: 'habit-morning',
    name: 'Morning Routine',
    doneToday: true,
    streak: 45,
    bestStreak: 45,
    gold: true,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: null
  },
  {
    id: 'habit-night',
    name: 'Night Routine',
    doneToday: true,
    streak: 32,
    bestStreak: 41,
    gold: true,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: null
  },
  {
    id: 'habit-winddown',
    name: 'Wind-Down & Prep',
    doneToday: false,
    streak: 21,
    bestStreak: 28,
    gold: false,
    atRiskTonight: false,
    week: ['done', 'frozen', 'pending', 'future', 'future', 'future', 'future'],
    quantized: null
  },
  {
    id: 'habit-deepwork',
    name: 'Deep Work 90m',
    doneToday: true,
    streak: 17,
    bestStreak: 24,
    gold: false,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: null
  },
  {
    id: 'habit-read',
    name: 'Read 25 pages',
    doneToday: true,
    streak: 21,
    bestStreak: 21,
    gold: true,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: null
  },
  {
    id: 'habit-water',
    name: 'Water 48 oz',
    doneToday: true,
    streak: 26,
    bestStreak: 30,
    gold: false,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: { steps: [0, 25, 50, 75, 100], value: 100, targetLabel: '48 oz' }
  },
  {
    id: 'habit-protein',
    name: 'Protein 105 g',
    doneToday: false,
    streak: 14,
    bestStreak: 19,
    gold: false,
    atRiskTonight: false,
    week: ['done', 'done', 'pending', 'future', 'future', 'future', 'future'],
    quantized: { steps: [0, 25, 50, 75, 100], value: 50, targetLabel: '105 g' }
  },
  {
    id: 'habit-family',
    name: 'Family QT 15m',
    doneToday: false,
    streak: 169,
    bestStreak: 169,
    gold: true,
    atRiskTonight: true,
    week: ['done', 'done', 'pending', 'future', 'future', 'future', 'future'],
    quantized: null
  },
  {
    id: 'habit-sleep',
    name: 'Sleep by 11:30',
    doneToday: false,
    streak: 10,
    bestStreak: 34,
    gold: false,
    atRiskTonight: false,
    week: ['missed', 'done', 'pending', 'future', 'future', 'future', 'future'],
    quantized: null
  },
  {
    id: 'habit-logging',
    name: 'Manor Logging',
    doneToday: true,
    streak: 62,
    bestStreak: 62,
    gold: true,
    atRiskTonight: false,
    week: doneWeek(true),
    quantized: null
  }
]

export interface HabitsSummary {
  doneToday: number
  total: number
  freezesLeft: number
  freezesPerMonth: number
  freezeMonthLabel: string
  /** Gold badge rule, product voice (for the Settings/info popover). */
  goldRule: string
  /** Earn-Back rule, product voice (for the Settings/info popover). */
  earnBackRule: string
}

export const habitsSummary: HabitsSummary = {
  doneToday: 6,
  total: 10,
  freezesLeft: 7,
  freezesPerMonth: 10,
  freezeMonthLabel: 'August',
  goldRule: 'A habit turns gold after seven days without spending a freeze.',
  earnBackRule:
    'Miss a day and two clean days within 48 hours win the streak back. Once per habit each month.'
}

/** August 2026 heatmap for the habit opened on the Habits page (Family QT). */
export interface HabitHeatmap {
  habitId: string
  monthLabel: string
  /** Day-of-month -> mark, for Aug 1..20 (future days omitted). */
  days: readonly { day: number; mark: HabitDayMark }[]
  framing: string
}

export const familyQtHeatmap: HabitHeatmap = {
  habitId: 'habit-family',
  monthLabel: 'August 2026',
  days: [
    { day: 1, mark: 'done' },
    { day: 2, mark: 'done' },
    { day: 3, mark: 'done' },
    { day: 4, mark: 'done' },
    { day: 5, mark: 'done' },
    { day: 6, mark: 'frozen' },
    { day: 7, mark: 'done' },
    { day: 8, mark: 'done' },
    { day: 9, mark: 'done' },
    { day: 10, mark: 'done' },
    { day: 11, mark: 'done' },
    { day: 12, mark: 'done' },
    { day: 13, mark: 'done' },
    { day: 14, mark: 'done' },
    { day: 15, mark: 'done' },
    { day: 16, mark: 'done' },
    { day: 17, mark: 'done' },
    { day: 18, mark: 'done' },
    { day: 19, mark: 'done' },
    { day: 20, mark: 'pending' }
  ],
  framing: '169 days. The longest run yet.'
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskBucket = 'overdue' | 'today' | 'tomorrow' | 'week'

export const taskContexts: readonly ContextDefinition[] = [
  { name: 'Uni', color: 'info', icon: 'book-open' },
  { name: 'Personal', color: 'success', icon: 'house' },
  { name: 'Leetcode', color: 'gold', icon: 'code' },
  { name: 'Apps', color: 'forest', icon: 'briefcase' },
  { name: 'Hackathons', color: 'plum', icon: 'sparkles' }
]

export const tasks: readonly Task[] = [
  {
    id: 'task-hackathon-form',
    title: 'Hackathon team form',
    context: 'Hackathons',
    estimateMinutes: 30,
    priority: null,
    status: 'Not started',
    due: '2026-08-19',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-mymathlab',
    title: 'MyMathLab 14.2',
    context: 'Uni',
    estimateMinutes: 120,
    priority: 'High',
    status: 'Not started',
    due: '2026-08-20',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-transcript',
    title: 'Send CS 225 transcript to UCLA',
    context: 'Personal',
    estimateMinutes: 30,
    priority: null,
    status: 'Not started',
    due: '2026-08-20',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-practice-exam',
    title: 'Chapter 14 Practice Exam',
    context: 'Uni',
    estimateMinutes: 240,
    priority: null,
    status: 'Not started',
    due: '2026-08-21',
    tags: ['Exam'],
    recurrence: null
  },
  {
    id: 'task-skin-doc',
    title: 'Book skin doc appt',
    context: 'Personal',
    estimateMinutes: null,
    priority: null,
    status: 'Not started',
    due: '2026-08-21',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-neetcode-two-pointers',
    title: 'Neetcode: Two Pointers',
    context: 'Leetcode',
    estimateMinutes: 180,
    priority: null,
    status: 'In Progress',
    due: '2026-08-22',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-weekly-review',
    title: 'Weekly review + plan',
    context: 'Personal',
    estimateMinutes: 60,
    priority: null,
    status: 'Not started',
    due: '2026-08-24',
    tags: [],
    recurrence: 'Every Sunday'
  },
  {
    id: 'task-resume',
    title: 'Update resume for fall apps',
    context: 'Apps',
    estimateMinutes: 180,
    priority: null,
    status: 'Not started',
    due: '2026-08-23',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-airtel',
    title: 'Load Airtel account',
    context: 'Personal',
    estimateMinutes: 15,
    priority: null,
    status: 'Not started',
    due: '2026-08-23',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-portfolio-case-study',
    title: 'Polish portfolio case study',
    context: 'Apps',
    estimateMinutes: 120,
    priority: 'Medium',
    status: 'Not started',
    due: '2026-09-02',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-dentist-cleaning',
    title: 'Schedule fall dental cleaning',
    context: 'Personal',
    estimateMinutes: 15,
    priority: 'Low',
    status: 'Not started',
    due: '2026-09-18',
    tags: [],
    recurrence: null
  }
]

export interface TaskBucketMeta {
  bucket: TaskBucket
  label: string
  colorway: 'overdue' | 'today' | 'tomorrow' | 'week'
}

export const taskBuckets: readonly TaskBucketMeta[] = [
  { bucket: 'overdue', label: 'Overdue', colorway: 'overdue' },
  { bucket: 'today', label: 'Today', colorway: 'today' },
  { bucket: 'tomorrow', label: 'Tomorrow', colorway: 'tomorrow' },
  { bucket: 'week', label: 'This Week', colorway: 'week' }
]

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type CalendarId =
  | 'google-personal'
  | 'google-family'
  | 'ucla'
  | 'ucla-clubs'
  | 'manor-scratch'

export interface CalendarSource {
  id: CalendarId
  name: string
  /** Swatch color for the calendar list. */
  color: string
  /** Scratch calendar renders dashed and lives on this Mac only. */
  scratch: boolean
  enabled: boolean
}

export const calendars: readonly CalendarSource[] = [
  { id: 'google-personal', name: 'Personal', color: '#4576b5', scratch: false, enabled: true },
  { id: 'google-family', name: 'Family', color: '#5f7d54', scratch: false, enabled: true },
  { id: 'ucla', name: 'UCLA', color: '#a8761c', scratch: false, enabled: true },
  { id: 'ucla-clubs', name: 'Clubs', color: '#8a5a83', scratch: false, enabled: false },
  { id: 'manor-scratch', name: 'Scratch blocks', color: '#48708e', scratch: true, enabled: true }
]

export type CalendarAccountId = 'google-users84' | 'google-ucla'

/** A connected Google account; read-only source of Today timeline events. */
export interface CalendarAccount {
  id: CalendarAccountId
  email: string
  /** Calendars this account contributes (never the Manor-only scratch calendar). */
  calendarIds: readonly CalendarId[]
}

export const calendarAccounts: readonly CalendarAccount[] = [
  {
    id: 'google-users84',
    email: 'user@example.com',
    calendarIds: ['google-personal', 'google-family']
  },
  {
    id: 'google-ucla',
    email: 'user@example.com',
    calendarIds: ['ucla', 'ucla-clubs']
  }
]

export interface CalendarEvent {
  id: string
  title: string
  calendarId: CalendarId
  /** ISO date. Week grid covers Mon Aug 18 .. Sun Aug 24. */
  date: string
  start: string
  end: string
  /** Scratch blocks are dashed, disposable Manor-only time blocks. */
  scratch: boolean
  /** A scratch block past its 48h fade window renders faded. */
  faded: boolean
  /** Linked task id, e.g. a time-blocked task. */
  taskId: string | null
  note: string | null
}

export const events: readonly CalendarEvent[] = [
  // Monday Aug 18
  {
    id: 'evt-calc-mon',
    title: 'Calc III lecture',
    calendarId: 'ucla',
    date: '2026-08-18',
    start: '10:00',
    end: '11:15',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  {
    id: 'evt-scratch-mon',
    title: 'Resume pass',
    calendarId: 'manor-scratch',
    date: '2026-08-18',
    start: '15:00',
    end: '16:00',
    scratch: true,
    faded: true,
    taskId: 'task-resume',
    note: null
  },
  {
    id: 'evt-gym-mon',
    title: 'Gym',
    calendarId: 'google-personal',
    date: '2026-08-18',
    start: '16:30',
    end: '17:30',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  // Tuesday Aug 19
  {
    id: 'evt-office-hours-tue',
    title: 'CS 225 office hours',
    calendarId: 'ucla',
    date: '2026-08-19',
    start: '13:00',
    end: '14:00',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  {
    id: 'evt-dinner-tue',
    title: 'Dinner with Arjun',
    calendarId: 'google-personal',
    date: '2026-08-19',
    start: '19:00',
    end: '20:30',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  // Wednesday Aug 20 (today)
  {
    id: 'evt-calc-wed',
    title: 'Calc III lecture',
    calendarId: 'google-personal',
    date: '2026-08-20',
    start: '10:00',
    end: '11:15',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  {
    id: 'evt-neetcode-block',
    title: 'Neetcode: Two Pointers',
    calendarId: 'manor-scratch',
    date: '2026-08-20',
    start: '14:00',
    end: '15:00',
    scratch: true,
    faded: false,
    taskId: 'task-neetcode-two-pointers',
    note: 'This block is removed two days after it ends. The task is unchanged.'
  },
  {
    id: 'evt-gym-wed',
    title: 'Gym',
    calendarId: 'google-personal',
    date: '2026-08-20',
    start: '16:30',
    end: '17:30',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  // Thursday Aug 21 — overlapping pair
  {
    id: 'evt-linear-interview',
    title: 'Linear interview, round 1',
    calendarId: 'google-personal',
    date: '2026-08-21',
    start: '15:00',
    end: '16:00',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  {
    id: 'evt-study-group',
    title: 'Ch 14 study group',
    calendarId: 'ucla',
    date: '2026-08-21',
    start: '15:30',
    end: '17:00',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  // Friday Aug 22
  {
    id: 'evt-calc-fri',
    title: 'Calc III lecture',
    calendarId: 'ucla',
    date: '2026-08-22',
    start: '10:00',
    end: '11:15',
    scratch: false,
    faded: false,
    taskId: null,
    note: null
  },
  {
    id: 'evt-neetcode-fri',
    title: 'Neetcode: the rest',
    calendarId: 'manor-scratch',
    date: '2026-08-22',
    start: '14:00',
    end: '15:30',
    scratch: true,
    faded: false,
    taskId: 'task-neetcode-two-pointers',
    note: null
  },
  // Sunday Aug 24
  {
    id: 'evt-weekly-review',
    title: 'Weekly review',
    calendarId: 'manor-scratch',
    date: '2026-08-24',
    start: '18:00',
    end: '19:00',
    scratch: true,
    faded: false,
    taskId: 'task-weekly-review',
    note: null
  }
]

// ---------------------------------------------------------------------------
// Mood & Focus
// ---------------------------------------------------------------------------

type MoodFocusStoryEntry = Pick<
  MoodFocusEntry,
  'date' | 'mood' | 'focus' | 'note' | 'noteSource'
>

const moodFocusStory: readonly MoodFocusStoryEntry[] = [
  { date: '2026-05-26', mood: 'Good', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-05-28', mood: 'Neutral', focus: 'Low', note: null, noteSource: null },
  { date: '2026-05-30', mood: 'Great', focus: 'High', note: null, noteSource: null },
  { date: '2026-05-31', mood: 'Good', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-06-02', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-06-04', mood: 'Neutral', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-06-06', mood: 'Good', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-06-08', mood: 'Bad', focus: 'Low', note: null, noteSource: null },
  { date: '2026-06-10', mood: 'Neutral', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-06-12', mood: 'Great', focus: 'Locked In', note: null, noteSource: null },
  { date: '2026-06-15', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-06-18', mood: 'Good', focus: null, note: null, noteSource: null },
  { date: '2026-06-20', mood: 'Neutral', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-06-23', mood: 'Good', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-06-26', mood: 'Great', focus: 'High', note: null, noteSource: null },
  { date: '2026-06-29', mood: 'Good', focus: 'Locked In', note: null, noteSource: null },
  { date: '2026-07-01', mood: 'Neutral', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-07-03', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-07-04', mood: 'Great', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-07-07', mood: 'Good', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-07-09', mood: 'Bad', focus: 'Locked Out', note: null, noteSource: null },
  { date: '2026-07-11', mood: 'Neutral', focus: 'Low', note: null, noteSource: null },
  { date: '2026-07-13', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-07-16', mood: 'Great', focus: 'Locked In', note: null, noteSource: null },
  { date: '2026-07-18', mood: 'Good', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-07-21', mood: 'Neutral', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-07-24', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-07-27', mood: 'Awful', focus: 'Locked Out', note: null, noteSource: null },
  { date: '2026-07-29', mood: 'Neutral', focus: 'Low', note: null, noteSource: null },
  { date: '2026-07-31', mood: 'Good', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-08-02', mood: 'Good', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-08-04', mood: null, focus: 'High', note: null, noteSource: null },
  { date: '2026-08-05', mood: 'Good', focus: null, note: null, noteSource: null },
  { date: '2026-08-06', mood: 'Good', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-08-07', mood: 'Great', focus: 'High', note: null, noteSource: null },
  { date: '2026-08-08', mood: 'Good', focus: 'Resting', note: 'Long walk after lunch.', noteSource: 'manual' },
  { date: '2026-08-09', mood: 'Neutral', focus: 'Low', note: null, noteSource: null },
  { date: '2026-08-10', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-08-11', mood: 'Great', focus: 'Locked In', note: null, noteSource: null },
  { date: '2026-08-12', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-08-13', mood: 'Bad', focus: 'Locked Out', note: 'Practice set ran long.', noteSource: 'manual' },
  { date: '2026-08-14', mood: 'Neutral', focus: 'Medium', note: null, noteSource: null },
  { date: '2026-08-15', mood: 'Good', focus: 'Resting', note: null, noteSource: null },
  { date: '2026-08-16', mood: 'Good', focus: 'High', note: null, noteSource: null },
  { date: '2026-08-17', mood: 'Great', focus: 'Locked In', note: null, noteSource: null },
  { date: '2026-08-18', mood: 'Good', focus: 'High', note: null, noteSource: null },
  {
    date: '2026-08-19',
    mood: 'Neutral',
    focus: 'Medium',
    note: 'Steady day. Deep work landed before noon, then energy dipped after the practice set.',
    noteSource: 'codex'
  }
]

/** Today (Aug 20) is intentionally absent so the first capture persists through the real store. */
export const moodFocusHistory: readonly MoodFocusEntry[] = moodFocusStory.map((entry) => ({
  ...entry,
  createdAt: `${entry.date}T21:00:00.000Z`,
  updatedAt: `${entry.date}T21:00:00.000Z`
}))

// ---------------------------------------------------------------------------
// Fitness
// ---------------------------------------------------------------------------

export interface CalorieDay {
  date: string
  weekdayShort: string
  caloriesIn: number
  caloriesOut: number
}

export interface FitnessIngestion {
  lastProcessedLabel: string
  caloriesNormalized: boolean
  workoutNormalized: boolean
}

export const fitnessIngestion: FitnessIngestion = {
  lastProcessedLabel: 'Last clip processed 11:42 PM',
  caloriesNormalized: true,
  workoutNormalized: true
}

/** Last 7 full days (Aug 13..19). Yesterday (Tue 19): 2,140 in / 310 out / −270. */
export const calorieWeek: readonly CalorieDay[] = [
  { date: '2026-08-13', weekdayShort: 'Wed', caloriesIn: 2260, caloriesOut: 0 },
  { date: '2026-08-14', weekdayShort: 'Thu', caloriesIn: 2080, caloriesOut: 280 },
  { date: '2026-08-15', weekdayShort: 'Fri', caloriesIn: 2310, caloriesOut: 420 },
  { date: '2026-08-16', weekdayShort: 'Sat', caloriesIn: 1980, caloriesOut: 0 },
  { date: '2026-08-17', weekdayShort: 'Sun', caloriesIn: 2020, caloriesOut: 350 },
  { date: '2026-08-18', weekdayShort: 'Mon', caloriesIn: 1975, caloriesOut: 300 },
  { date: '2026-08-19', weekdayShort: 'Tue', caloriesIn: 2140, caloriesOut: 310 }
]

export const calorieWeekAvgIn = 2109
export const calorieTargetDeficit = -270

export type MuscleGroup =
  | 'Chest'
  | 'Biceps'
  | 'Triceps'
  | 'Back'
  | 'Core'
  | 'Shoulders'
  | 'Traps'
  | 'Legs'
  | 'Cardio'

export interface MuscleGroupStat {
  group: MuscleGroup
  hitThisWeek: boolean
  hitPrevWeek: boolean
  hitTwoWeeksAgo: boolean
  /** Longest weekly streak for the group; 0 when unremarkable. */
  longestStreak: number
}

export const muscleGroups: readonly MuscleGroupStat[] = [
  { group: 'Chest', hitThisWeek: true, hitPrevWeek: true, hitTwoWeeksAgo: true, longestStreak: 6 },
  { group: 'Biceps', hitThisWeek: true, hitPrevWeek: false, hitTwoWeeksAgo: true, longestStreak: 0 },
  { group: 'Triceps', hitThisWeek: false, hitPrevWeek: true, hitTwoWeeksAgo: false, longestStreak: 0 },
  { group: 'Back', hitThisWeek: false, hitPrevWeek: true, hitTwoWeeksAgo: true, longestStreak: 0 },
  { group: 'Core', hitThisWeek: false, hitPrevWeek: false, hitTwoWeeksAgo: true, longestStreak: 0 },
  { group: 'Shoulders', hitThisWeek: false, hitPrevWeek: true, hitTwoWeeksAgo: false, longestStreak: 0 },
  { group: 'Traps', hitThisWeek: false, hitPrevWeek: false, hitTwoWeeksAgo: false, longestStreak: 0 },
  { group: 'Legs', hitThisWeek: true, hitPrevWeek: true, hitTwoWeeksAgo: true, longestStreak: 11 },
  { group: 'Cardio', hitThisWeek: true, hitPrevWeek: true, hitTwoWeeksAgo: true, longestStreak: 22 }
]

// ---------------------------------------------------------------------------
// LeetCode
// ---------------------------------------------------------------------------

export interface LeetCodeTopic {
  name: string
  done: number
  total: number
}

export const leetcodeTopics: readonly LeetCodeTopic[] = [
  { name: 'Arrays & Hashing', done: 9, total: 9 },
  { name: 'Two Pointers', done: 3, total: 5 },
  { name: 'Sliding Window', done: 4, total: 6 },
  { name: 'Stack', done: 5, total: 7 },
  { name: 'Binary Search', done: 4, total: 7 },
  { name: 'Linked List', done: 6, total: 11 },
  { name: 'Trees', done: 8, total: 15 },
  { name: 'Heap / Priority Queue', done: 0, total: 7 },
  { name: 'Backtracking', done: 0, total: 9 },
  { name: 'Tries', done: 0, total: 3 },
  { name: 'Graphs', done: 0, total: 13 },
  { name: 'Advanced Graphs', done: 0, total: 6 },
  { name: '1-D Dynamic Programming', done: 0, total: 12 },
  { name: '2-D Dynamic Programming', done: 0, total: 11 },
  { name: 'Greedy', done: 0, total: 8 },
  { name: 'Intervals', done: 0, total: 6 },
  { name: 'Math & Geometry', done: 0, total: 8 },
  { name: 'Bit Manipulation', done: 0, total: 7 }
]

export interface LeetCodeStats {
  solved: number
  total: number
  streak: number
  freezesLeft: number
  freezesPerMonth: number
  earnBack: boolean
  solvedToday: number
  /** Scratch block covering today's practice, if any. */
  todayBlockEventId: string | null
  /** Solves per day, oldest first, for the last-14-days intensity columns. */
  last14Days: readonly number[]
}

export const leetcodeStats: LeetCodeStats = {
  solved: 42,
  total: 150,
  streak: 5,
  freezesLeft: 3,
  freezesPerMonth: 5,
  earnBack: false,
  solvedToday: 0,
  todayBlockEventId: 'evt-neetcode-block',
  last14Days: [2, 1, 0, 3, 1, 2, 0, 1, 2, 4, 1, 1, 2, 0]
}

export interface LeetCodeMistakeNote {
  id: string
  text: string
  createdAt: string
}

/** Showroom jots for the Mistakes panel on the LeetCode page. */
export const leetcodeMistakeNotes: readonly LeetCodeMistakeNote[] = [
  {
    id: 'lc-note-demo-1',
    text: 'Off by one on sliding window right edge, expand first, then shrink while invalid.',
    createdAt: '2026-08-19T21:40:00.000Z'
  },
  {
    id: 'lc-note-demo-2',
    text: 'Forgot to clear visited set between BFS layers. Graph problems: state lives outside the loop.',
    createdAt: '2026-08-17T20:05:00.000Z'
  }
]

export type ProblemDifficulty = 'Easy' | 'Medium' | 'Hard'

export interface NeetcodeProblem {
  name: string
  difficulty: ProblemDifficulty
  done: boolean
}

export interface NeetcodeTopicProblems {
  /** Matches a LeetCodeTopic.name. */
  topic: string
  problems: readonly NeetcodeProblem[]
}

/**
 * Neetcode 150 problem rows per topic. Done counts agree with leetcodeTopics
 * (9, 3, 4, 5, 4, 6, 8 across the seven listed topics; the remaining 3 solved
 * live in "Everything after", which has no per-problem rows).
 */
export const neetcodeProblems: readonly NeetcodeTopicProblems[] = [
  {
    topic: 'Arrays & Hashing',
    problems: [
      { name: 'Contains Duplicate', difficulty: 'Easy', done: true },
      { name: 'Valid Anagram', difficulty: 'Easy', done: true },
      { name: 'Two Sum', difficulty: 'Easy', done: true },
      { name: 'Group Anagrams', difficulty: 'Medium', done: true },
      { name: 'Top K Frequent Elements', difficulty: 'Medium', done: true },
      { name: 'Encode and Decode Strings', difficulty: 'Medium', done: true },
      { name: 'Product of Array Except Self', difficulty: 'Medium', done: true },
      { name: 'Valid Sudoku', difficulty: 'Medium', done: true },
      { name: 'Longest Consecutive Sequence', difficulty: 'Medium', done: true }
    ]
  },
  {
    topic: 'Two Pointers',
    problems: [
      { name: 'Valid Palindrome', difficulty: 'Easy', done: true },
      { name: 'Two Sum II', difficulty: 'Medium', done: true },
      { name: '3Sum', difficulty: 'Medium', done: true },
      { name: 'Container With Most Water', difficulty: 'Medium', done: false },
      { name: 'Trapping Rain Water', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Sliding Window',
    problems: [
      { name: 'Best Time to Buy and Sell Stock', difficulty: 'Easy', done: true },
      { name: 'Longest Substring Without Repeating Characters', difficulty: 'Medium', done: true },
      { name: 'Longest Repeating Character Replacement', difficulty: 'Medium', done: true },
      { name: 'Permutation in String', difficulty: 'Medium', done: true },
      { name: 'Minimum Window Substring', difficulty: 'Hard', done: false },
      { name: 'Sliding Window Maximum', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Stack',
    problems: [
      { name: 'Valid Parentheses', difficulty: 'Easy', done: true },
      { name: 'Min Stack', difficulty: 'Medium', done: true },
      { name: 'Evaluate Reverse Polish Notation', difficulty: 'Medium', done: true },
      { name: 'Generate Parentheses', difficulty: 'Medium', done: true },
      { name: 'Daily Temperatures', difficulty: 'Medium', done: true },
      { name: 'Car Fleet', difficulty: 'Medium', done: false },
      { name: 'Largest Rectangle in Histogram', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Binary Search',
    problems: [
      { name: 'Binary Search', difficulty: 'Easy', done: true },
      { name: 'Search a 2D Matrix', difficulty: 'Medium', done: true },
      { name: 'Koko Eating Bananas', difficulty: 'Medium', done: true },
      { name: 'Find Minimum in Rotated Sorted Array', difficulty: 'Medium', done: true },
      { name: 'Search in Rotated Sorted Array', difficulty: 'Medium', done: false },
      { name: 'Time Based Key Value Store', difficulty: 'Medium', done: false },
      { name: 'Median of Two Sorted Arrays', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Linked List',
    problems: [
      { name: 'Reverse Linked List', difficulty: 'Easy', done: true },
      { name: 'Merge Two Sorted Lists', difficulty: 'Easy', done: true },
      { name: 'Linked List Cycle', difficulty: 'Easy', done: true },
      { name: 'Reorder List', difficulty: 'Medium', done: true },
      { name: 'Remove Nth Node From End of List', difficulty: 'Medium', done: true },
      { name: 'Copy List with Random Pointer', difficulty: 'Medium', done: true },
      { name: 'Add Two Numbers', difficulty: 'Medium', done: false },
      { name: 'Find the Duplicate Number', difficulty: 'Medium', done: false },
      { name: 'LRU Cache', difficulty: 'Medium', done: false },
      { name: 'Merge K Sorted Lists', difficulty: 'Hard', done: false },
      { name: 'Reverse Nodes in K Group', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Trees',
    problems: [
      { name: 'Invert Binary Tree', difficulty: 'Easy', done: true },
      { name: 'Maximum Depth of Binary Tree', difficulty: 'Easy', done: true },
      { name: 'Diameter of Binary Tree', difficulty: 'Easy', done: true },
      { name: 'Balanced Binary Tree', difficulty: 'Easy', done: true },
      { name: 'Same Tree', difficulty: 'Easy', done: true },
      { name: 'Subtree of Another Tree', difficulty: 'Easy', done: true },
      { name: 'Lowest Common Ancestor of a BST', difficulty: 'Medium', done: true },
      { name: 'Binary Tree Level Order Traversal', difficulty: 'Medium', done: true },
      { name: 'Binary Tree Right Side View', difficulty: 'Medium', done: false },
      { name: 'Count Good Nodes in Binary Tree', difficulty: 'Medium', done: false },
      { name: 'Validate Binary Search Tree', difficulty: 'Medium', done: false },
      { name: 'Kth Smallest Element in a BST', difficulty: 'Medium', done: false },
      { name: 'Construct Binary Tree from Preorder and Inorder', difficulty: 'Medium', done: false },
      { name: 'Binary Tree Maximum Path Sum', difficulty: 'Hard', done: false },
      { name: 'Serialize and Deserialize Binary Tree', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Heap / Priority Queue',
    problems: [
      { name: 'Kth Largest Element in a Stream', difficulty: 'Easy', done: false },
      { name: 'Last Stone Weight', difficulty: 'Easy', done: false },
      { name: 'K Closest Points to Origin', difficulty: 'Medium', done: false },
      { name: 'Kth Largest Element in an Array', difficulty: 'Medium', done: false },
      { name: 'Task Scheduler', difficulty: 'Medium', done: false },
      { name: 'Design Twitter', difficulty: 'Medium', done: false },
      { name: 'Find Median from Data Stream', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Backtracking',
    problems: [
      { name: 'Subsets', difficulty: 'Medium', done: false },
      { name: 'Combination Sum', difficulty: 'Medium', done: false },
      { name: 'Permutations', difficulty: 'Medium', done: false },
      { name: 'Subsets II', difficulty: 'Medium', done: false },
      { name: 'Combination Sum II', difficulty: 'Medium', done: false },
      { name: 'Word Search', difficulty: 'Medium', done: false },
      { name: 'Palindrome Partitioning', difficulty: 'Medium', done: false },
      { name: 'Letter Combinations of a Phone Number', difficulty: 'Medium', done: false },
      { name: 'N-Queens', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Tries',
    problems: [
      { name: 'Implement Trie (Prefix Tree)', difficulty: 'Medium', done: false },
      { name: 'Design Add and Search Words Data Structure', difficulty: 'Medium', done: false },
      { name: 'Word Search II', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Graphs',
    problems: [
      { name: 'Number of Islands', difficulty: 'Medium', done: false },
      { name: 'Max Area of Island', difficulty: 'Medium', done: false },
      { name: 'Clone Graph', difficulty: 'Medium', done: false },
      { name: 'Walls and Gates', difficulty: 'Medium', done: false },
      { name: 'Rotting Oranges', difficulty: 'Medium', done: false },
      { name: 'Pacific Atlantic Water Flow', difficulty: 'Medium', done: false },
      { name: 'Surrounded Regions', difficulty: 'Medium', done: false },
      { name: 'Course Schedule', difficulty: 'Medium', done: false },
      { name: 'Course Schedule II', difficulty: 'Medium', done: false },
      { name: 'Graph Valid Tree', difficulty: 'Medium', done: false },
      { name: 'Number of Connected Components in an Undirected Graph', difficulty: 'Medium', done: false },
      { name: 'Redundant Connection', difficulty: 'Medium', done: false },
      { name: 'Word Ladder', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Advanced Graphs',
    problems: [
      { name: 'Reconstruct Itinerary', difficulty: 'Hard', done: false },
      { name: 'Min Cost to Connect All Points', difficulty: 'Medium', done: false },
      { name: 'Network Delay Time', difficulty: 'Medium', done: false },
      { name: 'Swim in Rising Water', difficulty: 'Hard', done: false },
      { name: 'Alien Dictionary', difficulty: 'Hard', done: false },
      { name: 'Cheapest Flights Within K Stops', difficulty: 'Medium', done: false }
    ]
  },
  {
    topic: '1-D Dynamic Programming',
    problems: [
      { name: 'Climbing Stairs', difficulty: 'Easy', done: false },
      { name: 'Min Cost Climbing Stairs', difficulty: 'Easy', done: false },
      { name: 'House Robber', difficulty: 'Medium', done: false },
      { name: 'House Robber II', difficulty: 'Medium', done: false },
      { name: 'Longest Palindromic Substring', difficulty: 'Medium', done: false },
      { name: 'Palindromic Substrings', difficulty: 'Medium', done: false },
      { name: 'Decode Ways', difficulty: 'Medium', done: false },
      { name: 'Coin Change', difficulty: 'Medium', done: false },
      { name: 'Maximum Product Subarray', difficulty: 'Medium', done: false },
      { name: 'Word Break', difficulty: 'Medium', done: false },
      { name: 'Longest Increasing Subsequence', difficulty: 'Medium', done: false },
      { name: 'Partition Equal Subset Sum', difficulty: 'Medium', done: false }
    ]
  },
  {
    topic: '2-D Dynamic Programming',
    problems: [
      { name: 'Unique Paths', difficulty: 'Medium', done: false },
      { name: 'Longest Common Subsequence', difficulty: 'Medium', done: false },
      { name: 'Best Time to Buy and Sell Stock with Cooldown', difficulty: 'Medium', done: false },
      { name: 'Coin Change II', difficulty: 'Medium', done: false },
      { name: 'Target Sum', difficulty: 'Medium', done: false },
      { name: 'Interleaving String', difficulty: 'Medium', done: false },
      { name: 'Longest Increasing Path in a Matrix', difficulty: 'Hard', done: false },
      { name: 'Distinct Subsequences', difficulty: 'Hard', done: false },
      { name: 'Edit Distance', difficulty: 'Medium', done: false },
      { name: 'Burst Balloons', difficulty: 'Hard', done: false },
      { name: 'Regular Expression Matching', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Greedy',
    problems: [
      { name: 'Maximum Subarray', difficulty: 'Medium', done: false },
      { name: 'Jump Game', difficulty: 'Medium', done: false },
      { name: 'Jump Game II', difficulty: 'Medium', done: false },
      { name: 'Gas Station', difficulty: 'Medium', done: false },
      { name: 'Hand of Straights', difficulty: 'Medium', done: false },
      { name: 'Merge Triplets to Form Target Triplet', difficulty: 'Medium', done: false },
      { name: 'Partition Labels', difficulty: 'Medium', done: false },
      { name: 'Valid Parenthesis String', difficulty: 'Medium', done: false }
    ]
  },
  {
    topic: 'Intervals',
    problems: [
      { name: 'Insert Interval', difficulty: 'Medium', done: false },
      { name: 'Merge Intervals', difficulty: 'Medium', done: false },
      { name: 'Non-overlapping Intervals', difficulty: 'Medium', done: false },
      { name: 'Meeting Rooms', difficulty: 'Easy', done: false },
      { name: 'Meeting Rooms II', difficulty: 'Medium', done: false },
      { name: 'Minimum Interval to Include Each Query', difficulty: 'Hard', done: false }
    ]
  },
  {
    topic: 'Math & Geometry',
    problems: [
      { name: 'Rotate Image', difficulty: 'Medium', done: false },
      { name: 'Spiral Matrix', difficulty: 'Medium', done: false },
      { name: 'Set Matrix Zeroes', difficulty: 'Medium', done: false },
      { name: 'Happy Number', difficulty: 'Easy', done: false },
      { name: 'Plus One', difficulty: 'Easy', done: false },
      { name: 'Pow(x, n)', difficulty: 'Medium', done: false },
      { name: 'Multiply Strings', difficulty: 'Medium', done: false },
      { name: 'Detect Squares', difficulty: 'Medium', done: false }
    ]
  },
  {
    topic: 'Bit Manipulation',
    problems: [
      { name: 'Single Number', difficulty: 'Easy', done: false },
      { name: 'Number of 1 Bits', difficulty: 'Easy', done: false },
      { name: 'Counting Bits', difficulty: 'Easy', done: false },
      { name: 'Reverse Bits', difficulty: 'Easy', done: false },
      { name: 'Missing Number', difficulty: 'Easy', done: false },
      { name: 'Sum of Two Integers', difficulty: 'Medium', done: false },
      { name: 'Reverse Integer', difficulty: 'Medium', done: false }
    ]
  }
]

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function jobRole(
  id: string,
  company: string,
  role: string,
  location: string,
  postingLink: string,
  datePosted: string | null,
  stage: JobStage,
  appliedDate: string | null,
  oaDueDate: string | null,
  interview1Date: string | null,
  interview2Date: string | null,
  interview3Date: string | null,
  decisionDate: string | null
): JobRole {
  const createdDate = datePosted ?? TODAY_ISO
  const updatedDate = decisionDate ?? interview3Date ?? interview2Date ?? interview1Date ?? appliedDate ?? createdDate
  return {
    id,
    company,
    role,
    location,
    postingLink,
    datePosted,
    stage,
    appliedDate,
    oaDueDate,
    interview1Date,
    interview2Date,
    interview3Date,
    decisionDate,
    createdAt: `${createdDate}T16:00:00.000Z`,
    updatedAt: `${updatedDate}T16:00:00.000Z`
  }
}

export const jobRoles: readonly JobRole[] = [
  jobRole('job-anthropic', 'Anthropic', 'SWE Intern, Agents', 'San Francisco, CA', 'https://www.anthropic.com/careers', '2026-08-20', 'to_apply', null, null, null, null, null, null),
  jobRole('job-figma', 'Figma', 'Product Eng Intern', 'San Francisco / New York', 'https://www.figma.com/careers', '2026-08-20', 'to_apply', null, null, null, null, null, null),
  jobRole('job-scale', 'Scale AI', 'SWE Intern, ML Infra', 'San Francisco, CA', 'https://scale.com/careers', '2026-08-20', 'to_apply', null, null, null, null, null, null),
  jobRole('job-ramp', 'Ramp', 'SWE Intern', 'New York, NY', 'https://ramp.com/careers', '2026-08-20', 'to_apply', null, null, null, null, null, null),
  jobRole('job-modal', 'Modal', 'SWE Intern', 'New York, NY', 'https://modal.com/careers', '2026-08-18', 'to_apply', null, null, null, null, null, null),
  jobRole('job-perplexity', 'Perplexity', 'SWE Intern', 'San Francisco, CA', 'https://www.perplexity.ai/careers', '2026-08-17', 'to_apply', null, null, null, null, null, null),
  jobRole('pl-openai', 'OpenAI', 'SWE Intern', 'San Francisco, CA', 'https://openai.com/careers', '2026-08-12', 'applied', '2026-08-19', null, null, null, null, null),
  jobRole('pl-palantir', 'Palantir', 'Forward Deployed SWE Intern', 'New York, NY', '', '2026-08-10', 'applied', '2026-08-18', null, null, null, null, null),
  jobRole('pl-cohere', 'Cohere', 'ML Intern', 'San Francisco, CA', '', '2026-08-09', 'applied', '2026-08-17', null, null, null, null, null),
  jobRole('pl-airbnb', 'Airbnb', 'SWE Intern', 'San Francisco, CA', '', '2026-08-07', 'applied', '2026-08-15', null, null, null, null, null),
  jobRole('pl-datadog', 'Datadog', 'SWE Intern', 'New York, NY', '', '2026-08-06', 'applied', '2026-08-14', null, null, null, null, null),
  jobRole('pl-plaid', 'Plaid', 'SWE Intern', 'San Francisco, CA', '', '2026-08-04', 'applied', '2026-08-12', null, null, null, null, null),
  jobRole('pl-retool', 'Retool', 'SWE Intern', 'San Francisco, CA', '', '2026-08-03', 'applied', '2026-08-11', null, null, null, null, null),
  jobRole('pl-databricks', 'Databricks', 'SWE Intern', 'San Francisco, CA', 'https://www.databricks.com/company/careers', '2026-08-04', 'oa', '2026-08-13', '2026-08-22', null, null, null, null),
  jobRole('pl-stripe', 'Stripe', 'SWE Intern', 'Seattle, WA', '', '2026-08-05', 'oa', '2026-08-14', '2026-08-24', null, null, null, null),
  jobRole('pl-vercel', 'Vercel', 'SWE Intern', 'Remote', 'https://vercel.com/careers', '2026-07-30', 'interview_2', '2026-08-05', '2026-08-12', '2026-08-18', '2026-08-24', null, null),
  jobRole('pl-notion', 'Notion', 'SWE Intern', 'San Francisco, CA', '', '2026-08-01', 'interview_1', '2026-08-07', '2026-08-14', null, null, null, null),
  jobRole('pl-linear', 'Linear', 'SWE Intern', 'San Francisco, CA', '', '2026-08-01', 'interview_1', '2026-08-08', '2026-08-15', '2026-08-21', null, null, null),
  jobRole('pl-meta', 'Meta', 'SWE Intern', 'Menlo Park, CA', '', '2026-07-25', 'rejected', '2026-08-01', '2026-08-08', null, null, null, '2026-08-18')
]

function transitionPath(role: JobRole): readonly JobStage[] {
  const path: JobStage[] = ['to_apply']
  if (role.stage !== 'to_apply') path.push('applied')
  if (role.stage === 'oa' || role.oaDueDate !== null) path.push('oa')
  if (role.stage === 'interview_1' || role.interview1Date !== null) path.push('interview_1')
  if (role.stage === 'interview_2' || role.interview2Date !== null) path.push('interview_2')
  if (role.stage === 'interview_3' || role.interview3Date !== null) path.push('interview_3')
  if (role.stage === 'offer' || role.stage === 'rejected') path.push(role.stage)
  return path
}

export const jobTransitions: readonly JobStageTransition[] = jobRoles.flatMap((role) =>
  transitionPath(role).map((stage, index, path) => ({
    id: `${role.id}-transition-${stage}`,
    roleId: role.id,
    fromStage: index === 0 ? null : path[index - 1] ?? null,
    toStage: stage,
    changedAt: role.updatedAt
  }))
)

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export interface Bookmark {
  id: string
  authorHandle: string
  authorName: string
  text: string
  /** Captured title of a linked article; null when the post has none. */
  linkedArticleTitle: string | null
  postUrl: string
  savedAt: string
}

export const bookmarksIngestedOvernight = 9
export const bookmarkThemes: readonly string[] = ['CUDA kernels', 'Web performance']

export const bookmarks: readonly Bookmark[] = [
  {
    id: 'bm-karpathy',
    authorHandle: '@karpathy',
    authorName: 'Andrej Karpathy',
    text: 'Writing CUDA kernels by hand is a lost art. Thread on what the compiler will and will not do for you.',
    linkedArticleTitle: 'A gentle introduction to CUDA kernel optimization',
    postUrl: 'https://x.com/karpathy',
    savedAt: '2026-08-20T03:12:00',
  },
  {
    id: 'bm-swyx',
    authorHandle: '@swyx',
    authorName: 'swyx',
    text: 'Every web app that feels fast does the same three things at startup. None of them are documented.',
    linkedArticleTitle: null,
    postUrl: 'https://x.com/swyx',
    savedAt: '2026-08-20T02:41:00'
  },
  {
    id: 'bm-thorstenball',
    authorHandle: '@thorstenball',
    authorName: 'Thorsten Ball',
    text: 'Profiled our renderer for a week. The wins were never where we guessed. Notes written up here.',
    linkedArticleTitle: 'Performance archaeology in a production web app',
    postUrl: 'https://x.com/thorstenball',
    savedAt: '2026-08-20T02:05:00'
  },
  {
    id: 'bm-simonw',
    authorHandle: '@simonw',
    authorName: 'Simon Willison',
    text: 'The trick to fast local search is embarrassing: precompute everything and stop being clever.',
    linkedArticleTitle: null,
    postUrl: 'https://x.com/simonw',
    savedAt: '2026-08-20T01:30:00'
  },
  {
    id: 'bm-tsoding',
    authorHandle: '@tsoding',
    authorName: 'Tsoding',
    text: 'Shared memory bank conflicts explained with a whiteboard and zero mercy.',
    linkedArticleTitle: null,
    postUrl: 'https://x.com/tsoding',
    savedAt: '2026-08-20T00:58:00'
  },
  {
    id: 'bm-jarredsumner',
    authorHandle: '@jarredsumner',
    authorName: 'Jarred Sumner',
    text: 'Network traffic is where web apps go to feel slow. Batch, debounce, and stop serializing the world.',
    linkedArticleTitle: null,
    postUrl: 'https://x.com/jarredsumner',
    savedAt: '2026-08-20T00:12:00'
  }
]

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface NoteDoc {
  id: string
  title: string
  updatedLabel: string
}

export interface NoteFolder {
  id: string
  name: string
  expanded: boolean
  docs: readonly NoteDoc[]
}

export const noteFolders: readonly NoteFolder[] = [
  {
    id: 'folder-calc3',
    name: 'Calc III',
    expanded: true,
    docs: [
      { id: 'doc-ch14-review', title: 'Calc III: Ch 14 review', updatedLabel: 'Edited 2h ago' },
      { id: 'doc-ch13-notes', title: 'Ch 13: partial derivatives', updatedLabel: 'Aug 14' },
      { id: 'doc-midterm-plan', title: 'Midterm study plan', updatedLabel: 'Aug 10' }
    ]
  },
  {
    id: 'folder-cs225',
    name: 'CS 225',
    expanded: false,
    docs: [
      { id: 'doc-avl', title: 'AVL rotations', updatedLabel: 'Aug 12' },
      { id: 'doc-mp3', title: 'MP3 scratchpad', updatedLabel: 'Aug 8' }
    ]
  },
  {
    id: 'folder-manor',
    name: 'Manor',
    expanded: false,
    docs: [{ id: 'doc-manor-ideas', title: 'Module ideas', updatedLabel: 'Aug 16' }]
  },
  {
    id: 'folder-misc',
    name: 'Misc',
    expanded: false,
    docs: [{ id: 'doc-books', title: 'Books to read', updatedLabel: 'Jul 30' }]
  }
]

export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'image'; caption: string }

export interface OpenNoteDoc {
  id: string
  title: string
  blocks: readonly NoteBlock[]
}

export const openDoc: OpenNoteDoc = {
  id: 'doc-ch14-review',
  title: 'Calc III: Ch 14 review',
  blocks: [
    { kind: 'heading', text: 'Lagrange multipliers' },
    {
      kind: 'paragraph',
      text: 'Constrained optimization: extrema of f subject to g = c occur where the gradients are parallel. Set up the system, solve for the multiplier, then compare candidate points. The exam loves boundary cases, so check the endpoints of the constraint set every time.'
    },
    {
      kind: 'code',
      language: 'python',
      code: 'import sympy as sp\n\nx, y, l = sp.symbols("x y lam")\nf = x**2 + y**2\ng = x * y - 4\nsols = sp.solve([\n    sp.diff(f, x) - l * sp.diff(g, x),\n    sp.diff(f, y) - l * sp.diff(g, y),\n    g,\n], [x, y, l])\nprint(sols)'
    },
    { kind: 'image', caption: 'Level curves sketch from lecture 22' }
  ]
}
