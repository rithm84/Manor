export const LEETCODE_DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const
export type LeetCodeDifficulty = (typeof LEETCODE_DIFFICULTIES)[number]

export interface LeetCodeProblem {
  id: string
  topic: string
  name: string
  difficulty: LeetCodeDifficulty
  curriculumOrder: number
}

export interface LeetCodeAttempt {
  id: string
  problemId: string
  date: string
  /** Exact user-authored source. Whitespace and comments are significant. */
  solution: string
  createdAt: string
  updatedAt: string
}

/** A quick jot about a mistake or pattern, kept beside the curriculum. */
export interface LeetCodeNote {
  id: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface LeetCodeLegacyProgress {
  topic: string
  solvedCount: number
  attemptCount: number
}

export interface LeetCodeSummary {
  totalProblems: number
  streak: number
  freezesLeft: number
  freezesPerMonth: number
  legacyProgress: readonly LeetCodeLegacyProgress[]
}

export interface LeetCodeSeed {
  problems: readonly LeetCodeProblem[]
  attempts: readonly LeetCodeAttempt[]
  notes: readonly LeetCodeNote[]
  summary: LeetCodeSummary
}

export type LeetCodeState = LeetCodeSeed

export interface AddLeetCodeAttemptMutation {
  problemId: string
  date: string
  solution: string
}

export interface UpdateLeetCodeAttemptMutation {
  attemptId: string
  date: string
  solution: string
}

export interface UpdateLeetCodeNoteMutation {
  noteId: string
  text: string
}

export interface LeetCodeApi {
  load: () => Promise<LeetCodeState>
  addAttempt: (mutation: AddLeetCodeAttemptMutation) => Promise<LeetCodeState>
  updateAttempt: (mutation: UpdateLeetCodeAttemptMutation) => Promise<LeetCodeState>
  deleteAttempt: (attemptId: string) => Promise<LeetCodeState>
  addNote: (text: string) => Promise<LeetCodeState>
  updateNote: (mutation: UpdateLeetCodeNoteMutation) => Promise<LeetCodeState>
  deleteNote: (noteId: string) => Promise<LeetCodeState>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function sourceValue(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`)
  }
  if (!allowEmpty && value.trim() === '') {
    throw new TypeError(`${label} must contain pasted solution source`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`)
  }
  return value
}

export function parseLeetCodeDate(value: unknown, label: string): string {
  const date = stringValue(value, label)
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`)
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`${label} must be a real calendar date`)
  }
  return date
}

export function leetCodeLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return parseLeetCodeDate(`${year}-${month}-${day}`, 'local date')
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function difficultyValue(value: unknown): LeetCodeDifficulty {
  if (typeof value !== 'string' || !LEETCODE_DIFFICULTIES.includes(value as LeetCodeDifficulty)) {
    throw new TypeError(`problem.difficulty must be one of ${LEETCODE_DIFFICULTIES.join(', ')}`)
  }
  return value as LeetCodeDifficulty
}

export function parseLeetCodeProblem(value: unknown): LeetCodeProblem {
  const problem = recordValue(value, 'LeetCode problem')
  return {
    id: stringValue(problem.id, 'problem.id'),
    topic: stringValue(problem.topic, 'problem.topic'),
    name: stringValue(problem.name, 'problem.name'),
    difficulty: difficultyValue(problem.difficulty),
    curriculumOrder: nonNegativeInteger(problem.curriculumOrder, 'problem.curriculumOrder')
  }
}

export function parseLeetCodeAttempt(value: unknown): LeetCodeAttempt {
  const attempt = recordValue(value, 'LeetCode attempt')
  return {
    id: stringValue(attempt.id, 'attempt.id'),
    problemId: stringValue(attempt.problemId, 'attempt.problemId'),
    date: parseLeetCodeDate(attempt.date, 'attempt.date'),
    solution: sourceValue(attempt.solution, 'attempt.solution', true),
    createdAt: timestampValue(attempt.createdAt, 'attempt.createdAt'),
    updatedAt: timestampValue(attempt.updatedAt, 'attempt.updatedAt')
  }
}

const NOTE_MAX_LENGTH = 2000

export function parseLeetCodeNoteText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('A LeetCode note needs some text')
  }
  const text = value.trim()
  if (text.length > NOTE_MAX_LENGTH) {
    throw new RangeError(`A LeetCode note must stay under ${NOTE_MAX_LENGTH} characters`)
  }
  return text
}

export function parseLeetCodeNote(value: unknown): LeetCodeNote {
  const note = recordValue(value, 'LeetCode note')
  return {
    id: stringValue(note.id, 'note.id'),
    text: parseLeetCodeNoteText(note.text),
    createdAt: timestampValue(note.createdAt, 'note.createdAt'),
    updatedAt: timestampValue(note.updatedAt, 'note.updatedAt')
  }
}

export function parseUpdateLeetCodeNoteMutation(value: unknown): UpdateLeetCodeNoteMutation {
  const mutation = recordValue(value, 'update LeetCode note mutation')
  return {
    noteId: stringValue(mutation.noteId, 'mutation.noteId'),
    text: parseLeetCodeNoteText(mutation.text)
  }
}

function parseLegacyProgress(value: unknown): LeetCodeLegacyProgress {
  const progress = recordValue(value, 'legacy LeetCode progress')
  return {
    topic: stringValue(progress.topic, 'legacyProgress.topic'),
    solvedCount: nonNegativeInteger(progress.solvedCount, 'legacyProgress.solvedCount'),
    attemptCount: nonNegativeInteger(progress.attemptCount, 'legacyProgress.attemptCount')
  }
}

export function parseLeetCodeSummary(value: unknown): LeetCodeSummary {
  const summary = recordValue(value, 'LeetCode summary')
  if (!Array.isArray(summary.legacyProgress)) {
    throw new TypeError('summary.legacyProgress must be an array')
  }
  const legacyProgress = summary.legacyProgress.map(parseLegacyProgress)
  const topics = new Set(legacyProgress.map((entry) => entry.topic))
  if (topics.size !== legacyProgress.length) {
    throw new TypeError('summary.legacyProgress topics must be unique')
  }
  const freezesLeft = nonNegativeInteger(summary.freezesLeft, 'summary.freezesLeft')
  const freezesPerMonth = nonNegativeInteger(summary.freezesPerMonth, 'summary.freezesPerMonth')
  if (freezesLeft > freezesPerMonth) {
    throw new RangeError('summary.freezesLeft cannot exceed summary.freezesPerMonth')
  }
  return {
    totalProblems: nonNegativeInteger(summary.totalProblems, 'summary.totalProblems'),
    streak: nonNegativeInteger(summary.streak, 'summary.streak'),
    freezesLeft,
    freezesPerMonth,
    legacyProgress
  }
}

export function parseLeetCodeSeed(value: unknown): LeetCodeSeed {
  const seed = recordValue(value, 'LeetCode seed')
  if (!Array.isArray(seed.problems) || !Array.isArray(seed.attempts) || !Array.isArray(seed.notes)) {
    throw new TypeError('LeetCode seed problems, attempts, and notes must be arrays')
  }
  const problems = seed.problems.map(parseLeetCodeProblem)
  const attempts = seed.attempts.map(parseLeetCodeAttempt)
  const notes = seed.notes.map(parseLeetCodeNote)
  const problemIds = new Set(problems.map((problem) => problem.id))
  const attemptIds = new Set(attempts.map((attempt) => attempt.id))
  const noteIds = new Set(notes.map((note) => note.id))
  if (problemIds.size !== problems.length) {
    throw new TypeError('LeetCode seed problem ids must be unique')
  }
  if (attemptIds.size !== attempts.length) {
    throw new TypeError('LeetCode seed attempt ids must be unique')
  }
  if (noteIds.size !== notes.length) {
    throw new TypeError('LeetCode seed note ids must be unique')
  }
  attempts.forEach((attempt) => {
    if (!problemIds.has(attempt.problemId)) {
      throw new TypeError(`LeetCode attempt ${attempt.id} references an unknown problem`)
    }
  })
  return { problems, attempts, notes, summary: parseLeetCodeSummary(seed.summary) }
}

export function parseAddLeetCodeAttemptMutation(value: unknown): AddLeetCodeAttemptMutation {
  const mutation = recordValue(value, 'add LeetCode attempt mutation')
  return {
    problemId: stringValue(mutation.problemId, 'mutation.problemId'),
    date: parseLeetCodeDate(mutation.date, 'mutation.date'),
    solution: sourceValue(mutation.solution, 'mutation.solution', false)
  }
}

export function parseUpdateLeetCodeAttemptMutation(value: unknown): UpdateLeetCodeAttemptMutation {
  const mutation = recordValue(value, 'update LeetCode attempt mutation')
  return {
    attemptId: stringValue(mutation.attemptId, 'mutation.attemptId'),
    date: parseLeetCodeDate(mutation.date, 'mutation.date'),
    solution: sourceValue(mutation.solution, 'mutation.solution', false)
  }
}

export function parseLeetCodeId(value: unknown, label: string): string {
  return stringValue(value, label)
}
