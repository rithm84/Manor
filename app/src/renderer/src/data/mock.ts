/**
 * Manor mock data — the canonical story from docs/design/canvas/SPEC.md §B.
 * Today is Wednesday, August 20, 2026. User: user.
 *
 * This is the single data source for every page. Page agents import from
 * here; nobody invents parallel data. All dates are ISO strings in local
 * time. Times are 24h "HH:MM".
 */

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
export type TaskContext = 'Uni' | 'Personal' | 'Leetcode' | 'Apps' | 'Hackathons'
export type TaskDifficulty = '<30min' | '<2hrs' | '<3hrs' | '>4hrs'
export type TaskPriority = 'High' | 'Medium' | 'Low'
export type TaskStatus = 'Not started' | 'In Progress' | 'Done'

export interface TaskTimeBlock {
  /** ISO date of the block. */
  date: string
  start: string
  end: string
  /** Which part of the task this block covers, e.g. "first half". */
  portion: string
}

export interface Task {
  id: string
  title: string
  bucket: TaskBucket
  context: TaskContext
  difficulty: TaskDifficulty | null
  priority: TaskPriority | null
  status: TaskStatus
  /** ISO due date; null for bucket-only placement. */
  due: string | null
  /** e.g. "Exam". */
  tags: readonly string[]
  /** Days past due (overdue bucket only). */
  daysLate: number
  /** e.g. "Every Sunday"; null when not recurring. */
  recurrence: string | null
  timeBlocks: readonly TaskTimeBlock[]
}

export const tasks: readonly Task[] = [
  {
    id: 'task-hackathon-form',
    title: 'Hackathon team form',
    bucket: 'overdue',
    context: 'Hackathons',
    difficulty: '<30min',
    priority: null,
    status: 'Not started',
    due: '2026-08-19',
    tags: [],
    daysLate: 1,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-mymathlab',
    title: 'MyMathLab 14.2',
    bucket: 'today',
    context: 'Uni',
    difficulty: '<2hrs',
    priority: 'High',
    status: 'Not started',
    due: '2026-08-20',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-transcript',
    title: 'Send CS 225 transcript to UCLA',
    bucket: 'today',
    context: 'Personal',
    difficulty: '<30min',
    priority: null,
    status: 'Not started',
    due: '2026-08-20',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-practice-exam',
    title: 'Chapter 14 Practice Exam',
    bucket: 'tomorrow',
    context: 'Uni',
    difficulty: '>4hrs',
    priority: null,
    status: 'Not started',
    due: '2026-08-21',
    tags: ['Exam'],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-skin-doc',
    title: 'Book skin doc appt',
    bucket: 'tomorrow',
    context: 'Personal',
    difficulty: null,
    priority: null,
    status: 'Not started',
    due: '2026-08-21',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-neetcode-two-pointers',
    title: 'Neetcode: Two Pointers',
    bucket: 'week',
    context: 'Leetcode',
    difficulty: '<3hrs',
    priority: null,
    status: 'In Progress',
    due: '2026-08-22',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: [
      { date: '2026-08-20', start: '14:00', end: '15:00', portion: 'first half' },
      { date: '2026-08-22', start: '14:00', end: '15:30', portion: 'rest' }
    ]
  },
  {
    id: 'task-weekly-review',
    title: 'Weekly review + plan',
    bucket: 'week',
    context: 'Personal',
    difficulty: null,
    priority: null,
    status: 'Not started',
    due: '2026-08-24',
    tags: [],
    daysLate: 0,
    recurrence: 'Every Sunday',
    timeBlocks: []
  },
  {
    id: 'task-resume',
    title: 'Update resume for fall apps',
    bucket: 'week',
    context: 'Apps',
    difficulty: '<3hrs',
    priority: null,
    status: 'Not started',
    due: '2026-08-23',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
  },
  {
    id: 'task-airtel',
    title: 'Load Airtel account',
    bucket: 'week',
    context: 'Personal',
    difficulty: '<30min',
    priority: null,
    status: 'Not started',
    due: '2026-08-23',
    tags: [],
    daysLate: 0,
    recurrence: null,
    timeBlocks: []
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

export type CalendarId = 'google-personal' | 'ucla' | 'manor-scratch'

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
  { id: 'google-personal', name: 'Personal', color: '#5db872', scratch: false, enabled: true },
  { id: 'ucla', name: 'UCLA', color: '#6f9fd8', scratch: false, enabled: true },
  { id: 'manor-scratch', name: 'Scratch blocks', color: '#cc785c', scratch: true, enabled: true }
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
    note: 'Blocks tidy themselves up two days after they end. The task stays.'
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

export const MOOD_SCALE = ['Great', 'Good', 'Neutral', 'Bad', 'Awful'] as const
export type Mood = (typeof MOOD_SCALE)[number]

export const FOCUS_SCALE = ['Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting'] as const
export type Focus = (typeof FOCUS_SCALE)[number]

export interface MoodFocusEntry {
  date: string
  mood: Mood
  focus: Focus
}

/** One entry per day; today (Aug 20) is intentionally absent: not logged yet. */
export const moodFocusHistory: readonly MoodFocusEntry[] = [
  { date: '2026-08-06', mood: 'Good', focus: 'Medium' },
  { date: '2026-08-07', mood: 'Great', focus: 'High' },
  { date: '2026-08-08', mood: 'Good', focus: 'Resting' },
  { date: '2026-08-09', mood: 'Neutral', focus: 'Low' },
  { date: '2026-08-10', mood: 'Good', focus: 'High' },
  { date: '2026-08-11', mood: 'Great', focus: 'Locked In' },
  { date: '2026-08-12', mood: 'Good', focus: 'High' },
  { date: '2026-08-13', mood: 'Bad', focus: 'Locked Out' },
  { date: '2026-08-14', mood: 'Neutral', focus: 'Medium' },
  { date: '2026-08-15', mood: 'Good', focus: 'Resting' },
  { date: '2026-08-16', mood: 'Good', focus: 'High' },
  { date: '2026-08-17', mood: 'Great', focus: 'Locked In' },
  { date: '2026-08-18', mood: 'Good', focus: 'High' },
  { date: '2026-08-19', mood: 'Neutral', focus: 'Medium' }
]

export interface DebriefSummary {
  date: string
  summary: string
}

export const latestDebrief: DebriefSummary = {
  date: '2026-08-19',
  summary:
    'Steady day. Deep work landed before noon, energy dipped after the practice set. Slept later than planned and felt it by evening.'
}

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
  current: boolean
}

export const leetcodeTopics: readonly LeetCodeTopic[] = [
  { name: 'Arrays & Hashing', done: 9, total: 9, current: false },
  { name: 'Two Pointers', done: 3, total: 5, current: true },
  { name: 'Sliding Window', done: 4, total: 6, current: false },
  { name: 'Stack', done: 5, total: 7, current: false },
  { name: 'Binary Search', done: 4, total: 7, current: false },
  { name: 'Linked List', done: 6, total: 11, current: false },
  { name: 'Trees', done: 8, total: 15, current: false },
  { name: 'Everything after', done: 3, total: 90, current: false }
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
  }
]

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobPosting {
  id: string
  company: string
  role: string
  location: string
  /** Days since it appeared in to-apply; 0 = new today. */
  ageDays: number
}

export const toApply: readonly JobPosting[] = [
  { id: 'job-anthropic', company: 'Anthropic', role: 'SWE Intern, Agents', location: 'SF', ageDays: 0 },
  { id: 'job-figma', company: 'Figma', role: 'Product Eng Intern', location: 'SF / NYC', ageDays: 0 },
  { id: 'job-scale', company: 'Scale AI', role: 'SWE Intern, ML Infra', location: 'SF', ageDays: 0 },
  { id: 'job-ramp', company: 'Ramp', role: 'SWE Intern', location: 'NYC', ageDays: 0 },
  { id: 'job-modal', company: 'Modal', role: 'SWE Intern', location: 'NYC', ageDays: 2 },
  { id: 'job-perplexity', company: 'Perplexity', role: 'SWE Intern', location: 'SF', ageDays: 3 }
]

export type PipelineStage = 'applied' | 'oa' | 'interview' | 'rejected'

export interface PipelineEntry {
  id: string
  company: string
  role: string
  stage: PipelineStage
  /** Stage detail in product voice, e.g. "Applied Aug 19" or "Round 2, Mon 11:00". */
  detail: string
  /** ISO deadline for OAs; null otherwise. */
  dueDate: string | null
}

export const pipeline: readonly PipelineEntry[] = [
  { id: 'pl-openai', company: 'OpenAI', role: 'SWE Intern', stage: 'applied', detail: 'Applied Aug 19', dueDate: null },
  { id: 'pl-palantir', company: 'Palantir', role: 'Forward Deployed SWE Intern', stage: 'applied', detail: 'Applied Aug 18', dueDate: null },
  { id: 'pl-cohere', company: 'Cohere', role: 'ML Intern', stage: 'applied', detail: 'Applied Aug 17', dueDate: null },
  { id: 'pl-airbnb', company: 'Airbnb', role: 'SWE Intern', stage: 'applied', detail: 'Applied Aug 15', dueDate: null },
  { id: 'pl-datadog', company: 'Datadog', role: 'SWE Intern', stage: 'applied', detail: 'Applied Aug 14', dueDate: null },
  { id: 'pl-plaid', company: 'Plaid', role: 'SWE Intern', stage: 'applied', detail: 'Applied Aug 12', dueDate: null },
  { id: 'pl-retool', company: 'Retool', role: 'SWE Intern', stage: 'applied', detail: 'Applied Aug 11', dueDate: null },
  { id: 'pl-databricks', company: 'Databricks', role: 'SWE Intern', stage: 'oa', detail: 'OA due Friday', dueDate: '2026-08-22' },
  { id: 'pl-stripe', company: 'Stripe', role: 'SWE Intern', stage: 'oa', detail: 'OA due Sunday', dueDate: '2026-08-24' },
  { id: 'pl-vercel', company: 'Vercel', role: 'SWE Intern', stage: 'interview', detail: 'Round 2, Mon 11:00', dueDate: null },
  { id: 'pl-notion', company: 'Notion', role: 'SWE Intern', stage: 'interview', detail: 'Round 1, scheduling', dueDate: null },
  { id: 'pl-linear', company: 'Linear', role: 'SWE Intern', stage: 'interview', detail: 'Round 1, Thu 15:00', dueDate: null },
  { id: 'pl-meta', company: 'Meta', role: 'SWE Intern', stage: 'rejected', detail: 'After the OA', dueDate: null }
]

export interface JobsFunnel {
  applied: number
  oa: number
  interview: number
  offer: number
}

export const jobsFunnel: JobsFunnel = { applied: 34, oa: 10, interview: 5, offer: 1 }

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
export const bookmarkThemes: readonly string[] = ['CUDA kernels', 'Electron perf']

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
    text: 'Every Electron app that feels fast does the same three things at startup. None of them are documented.',
    linkedArticleTitle: null,
    postUrl: 'https://x.com/swyx',
    savedAt: '2026-08-20T02:41:00'
  },
  {
    id: 'bm-thorstenball',
    authorHandle: '@thorstenball',
    authorName: 'Thorsten Ball',
    text: 'Profiled our renderer for a week. The wins were never where we guessed. Notes written up here.',
    linkedArticleTitle: 'Performance archaeology in a production Electron app',
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
    text: 'IPC is where Electron apps go to feel slow. Batch, debounce, and stop serializing the world.',
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

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export interface JournalMeta {
  locked: boolean
  entryCount: number
  unlockLabel: string
  encryptionLine: string
  recoveryLine: string
}

export const journal: JournalMeta = {
  locked: true,
  entryCount: 61,
  unlockLabel: 'Unlock with Touch ID',
  encryptionLine: 'End-to-end encrypted. The key never leaves this Mac. Alfred can never read this.',
  recoveryLine: 'Recovery key saved to your Keychain in April.'
}

// ---------------------------------------------------------------------------
// Alfred
// ---------------------------------------------------------------------------

export interface AlfredBriefing {
  preparedLabel: string
  headlines: readonly string[]
}

export const alfredBriefing: AlfredBriefing = {
  preparedLabel: 'Briefing ready since 7:00 AM',
  headlines: [
    'All ten streaks are alive. Family QT needs fifteen minutes tonight.',
    'Four new roles worth a look, Anthropic on top.',
    'Chapter 14 practice exam is tomorrow. The afternoon is blocked for it.'
  ]
}

export interface AlfredAuditEntry {
  id: string
  action: string
  whenLabel: string
}

export const alfredAudit: readonly AlfredAuditEntry[] = [
  { id: 'audit-water', action: 'Logged Water', whenLabel: '9:42 PM Tue' },
  { id: 'audit-task', action: "Created task 'two-pointers set'", whenLabel: 'Aug 18' }
]

export interface AlfredExchange {
  userSaid: string
  alfredSaid: string
  /** Habit completion shown in the glance row after this exchange. */
  glanceDone: number
  glanceTotal: number
}

export const alfredSampleExchange: AlfredExchange = {
  userSaid: 'Log protein and family time, and mark the neetcode problem done.',
  alfredSaid: 'Done. Protein, Family QT, and one LeetCode problem logged. Eight of ten today; two left.',
  glanceDone: 8,
  glanceTotal: 10
}
