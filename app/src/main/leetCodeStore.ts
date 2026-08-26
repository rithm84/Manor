import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  parseAddLeetCodeAttemptMutation,
  parseLeetCodeAttempt,
  parseLeetCodeDate,
  parseLeetCodeId,
  parseLeetCodeProblem,
  parseLeetCodeSeed,
  parseLeetCodeSummary,
  parseUpdateLeetCodeAttemptMutation
} from '../shared/leetcode'
import type {
  AddLeetCodeAttemptMutation,
  LeetCodeAttempt,
  LeetCodeProblem,
  LeetCodeSeed,
  LeetCodeState,
  UpdateLeetCodeAttemptMutation
} from '../shared/leetcode'

/** Everything the cloud mirrors for LeetCode: problems and attempts. The
    summary metadata is legacy display data and never syncs. */
export interface LeetCodeSyncState {
  problems: readonly LeetCodeProblem[]
  attempts: readonly LeetCodeAttempt[]
}

interface ProblemRow {
  id: string
  topic: string
  name: string
  difficulty: string
  curriculum_order: number
}

interface AttemptRow {
  id: string
  problem_id: string
  date: string
  solution: string
  created_at: string
  updated_at: string
}

interface MetadataRow {
  value: string
}

interface AttemptDateRow {
  date: string
}

export class LeetCodeStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS leetcode_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leetcode_problems (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        name TEXT NOT NULL,
        difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
        curriculum_order INTEGER NOT NULL CHECK (curriculum_order >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leetcode_attempts (
        id TEXT PRIMARY KEY,
        problem_id TEXT NOT NULL REFERENCES leetcode_problems(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        solution TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS leetcode_attempts_problem_date
        ON leetcode_attempts(problem_id, date DESC, created_at DESC);
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: LeetCodeSeed, todayValue: string): LeetCodeState {
    const seed = parseLeetCodeSeed(seedValue)
    const today = parseLeetCodeDate(todayValue, 'today')
    const initialized = this.database
      .prepare("SELECT value FROM leetcode_metadata WHERE key = 'initialized'")
      .get()
    if (initialized === undefined) {
      this.seed(seed, today)
    } else {
      this.database
        .prepare("UPDATE leetcode_metadata SET value = ? WHERE key = 'today'")
        .run(today)
    }
    return this.readState()
  }

  addAttempt(mutationValue: AddLeetCodeAttemptMutation, nowIso: string): LeetCodeState {
    const mutation = parseAddLeetCodeAttemptMutation(mutationValue)
    this.assertProblemExists(mutation.problemId)
    this.assertNewAttemptDate(mutation.date)
    this.database
      .prepare(`
        INSERT INTO leetcode_attempts
          (id, problem_id, date, solution, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), mutation.problemId, mutation.date, mutation.solution, nowIso, nowIso)
    return this.readState()
  }

  updateAttempt(mutationValue: UpdateLeetCodeAttemptMutation, nowIso: string): LeetCodeState {
    const mutation = parseUpdateLeetCodeAttemptMutation(mutationValue)
    const existing = this.database
      .prepare('SELECT date FROM leetcode_attempts WHERE id = ?')
      .get(mutation.attemptId) as AttemptDateRow | undefined
    if (existing === undefined) {
      throw new Error(`Cannot update LeetCode attempt ${mutation.attemptId}: no record has that id`)
    }
    if (mutation.date !== existing.date) {
      this.assertNewAttemptDate(mutation.date)
    }
    const result = this.database
      .prepare(`
        UPDATE leetcode_attempts
        SET date = ?, solution = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(mutation.date, mutation.solution, nowIso, mutation.attemptId)
    if (result.changes !== 1) {
      throw new Error(`Cannot update LeetCode attempt ${mutation.attemptId}: no record has that id`)
    }
    return this.readState()
  }

  deleteAttempt(attemptIdValue: string): LeetCodeState {
    const attemptId = parseLeetCodeId(attemptIdValue, 'attempt id')
    const result = this.database.prepare('DELETE FROM leetcode_attempts WHERE id = ?').run(attemptId)
    if (result.changes !== 1) {
      throw new Error(`Cannot delete LeetCode attempt ${attemptId}: no record has that id`)
    }
    return this.readState()
  }

  /** Whether the store has ever been seeded or hydrated. */
  initialized(): boolean {
    return (
      this.database
        .prepare("SELECT value FROM leetcode_metadata WHERE key = 'initialized'")
        .get() !== undefined
    )
  }

  /** Current persisted problems and attempts, for the sync engine's push. */
  snapshot(): LeetCodeSyncState {
    const state = this.readState()
    return { problems: state.problems, attempts: state.attempts }
  }

  /** Replace every persisted row with cloud state (sync pull). A store that
      was never seeded gets a zeroed legacy summary: cloud state carries no
      legacy Notion progress. */
  replaceAll(stateValue: LeetCodeSyncState, fallbackToday: string): LeetCodeState {
    if (!Array.isArray(stateValue.problems) || !Array.isArray(stateValue.attempts)) {
      throw new TypeError('leetcode sync state problems and attempts must be arrays')
    }
    const problems = stateValue.problems.map(parseLeetCodeProblem)
    const attempts = stateValue.attempts.map(parseLeetCodeAttempt)
    const today = parseLeetCodeDate(fallbackToday, 'fallback today')
    this.transaction(() => {
      this.database.exec('DELETE FROM leetcode_problems; DELETE FROM leetcode_attempts;')
      const nowIso = new Date().toISOString()
      const insertProblem = this.database.prepare(`
        INSERT INTO leetcode_problems
          (id, topic, name, difficulty, curriculum_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertAttempt = this.database.prepare(`
        INSERT INTO leetcode_attempts
          (id, problem_id, date, solution, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      problems.forEach((problem) =>
        insertProblem.run(
          problem.id,
          problem.topic,
          problem.name,
          problem.difficulty,
          problem.curriculumOrder,
          nowIso,
          nowIso
        )
      )
      attempts.forEach((attempt) =>
        insertAttempt.run(
          attempt.id,
          attempt.problemId,
          attempt.date,
          attempt.solution,
          attempt.createdAt,
          attempt.updatedAt
        )
      )
      this.database
        .prepare("INSERT OR REPLACE INTO leetcode_metadata (key, value) VALUES ('initialized', ?)")
        .run(nowIso)
      this.database
        .prepare("INSERT OR IGNORE INTO leetcode_metadata (key, value) VALUES ('today', ?)")
        .run(today)
      const emptySummary = JSON.stringify({
        totalProblems: problems.length,
        streak: 0,
        freezesLeft: 0,
        freezesPerMonth: 0,
        legacyProgress: []
      })
      this.database
        .prepare("INSERT OR IGNORE INTO leetcode_metadata (key, value) VALUES ('summary', ?)")
        .run(emptySummary)
    })
    return this.readState()
  }

  private seed(seed: LeetCodeSeed, today: string): void {
    this.transaction(() => {
      const insertProblem = this.database.prepare(`
        INSERT INTO leetcode_problems
          (id, topic, name, difficulty, curriculum_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertAttempt = this.database.prepare(`
        INSERT INTO leetcode_attempts
          (id, problem_id, date, solution, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const initializedAt = new Date().toISOString()
      seed.problems.forEach((problem) =>
        insertProblem.run(
          problem.id,
          problem.topic,
          problem.name,
          problem.difficulty,
          problem.curriculumOrder,
          initializedAt,
          initializedAt
        )
      )
      seed.attempts.forEach((attempt) =>
        insertAttempt.run(
          attempt.id,
          attempt.problemId,
          attempt.date,
          attempt.solution,
          attempt.createdAt,
          attempt.updatedAt
        )
      )
      this.database
        .prepare("INSERT INTO leetcode_metadata (key, value) VALUES ('summary', ?)")
        .run(JSON.stringify(seed.summary))
      this.database
        .prepare("INSERT INTO leetcode_metadata (key, value) VALUES ('initialized', ?)")
        .run(initializedAt)
      this.database
        .prepare("INSERT INTO leetcode_metadata (key, value) VALUES ('today', ?)")
        .run(today)
    })
  }

  private assertProblemExists(problemId: string): void {
    const problem = this.database.prepare('SELECT id FROM leetcode_problems WHERE id = ?').get(problemId)
    if (problem === undefined) {
      throw new Error(`Cannot add LeetCode attempt: problem ${problemId} does not exist`)
    }
  }

  private assertNewAttemptDate(date: string): void {
    const todayRow = this.database
      .prepare("SELECT value FROM leetcode_metadata WHERE key = 'today'")
      .get() as MetadataRow | undefined
    if (todayRow === undefined) {
      throw new Error('LeetCode store is missing its today metadata')
    }
    const today = parseLeetCodeDate(todayRow.value, 'stored today')
    const parsed = new Date(`${today}T00:00:00.000Z`)
    parsed.setUTCDate(parsed.getUTCDate() - 1)
    const yesterday = parsed.toISOString().slice(0, 10)
    if (date !== today && date !== yesterday) {
      throw new RangeError(`LeetCode attempts can only be logged for ${today} or ${yesterday}`)
    }
  }

  private readState(): LeetCodeState {
    const problemRows = this.database
      .prepare(`
        SELECT id, topic, name, difficulty, curriculum_order
        FROM leetcode_problems
        ORDER BY curriculum_order
      `)
      .all() as unknown as ProblemRow[]
    const attemptRows = this.database
      .prepare(`
        SELECT id, problem_id, date, solution, created_at, updated_at
        FROM leetcode_attempts
        ORDER BY date DESC, created_at DESC
      `)
      .all() as unknown as AttemptRow[]
    const problems = problemRows.map(
      (row): LeetCodeProblem =>
        parseLeetCodeProblem({
          id: row.id,
          topic: row.topic,
          name: row.name,
          difficulty: row.difficulty,
          curriculumOrder: row.curriculum_order
        })
    )
    const attempts = attemptRows.map(
      (row): LeetCodeAttempt =>
        parseLeetCodeAttempt({
          id: row.id,
          problemId: row.problem_id,
          date: row.date,
          solution: row.solution,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
    )
    const summaryRow = this.database
      .prepare("SELECT value FROM leetcode_metadata WHERE key = 'summary'")
      .get() as MetadataRow | undefined
    if (summaryRow === undefined) {
      throw new Error('LeetCode store is missing its summary metadata')
    }
    let summaryValue: unknown
    try {
      summaryValue = JSON.parse(summaryRow.value)
    } catch (error) {
      throw new Error('LeetCode summary metadata is not valid JSON', { cause: error })
    }
    return { problems, attempts, summary: parseLeetCodeSummary(summaryValue) }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      operation()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
