import { z } from 'zod'

import type { LeetCodeAttempt } from '../../shared/leetcode'
import { problemContentSchema, problemRecordSchema, type ProblemContent, type ProblemDetail, type ProblemRecord, type ProblemStatus } from '../../shared/problemLibrary'
import type { JsonObject } from '../ManorGateway'
import { camelRow } from './rows'

/**
 * Folds mirrored rows into the problem library the app shows: the shared catalog, the account's custom
 * problems, and the account's practice state. `ProblemLibraryService` reads the rows; everything here is pure.
 */

/** What the account has done: problems with an attempt, and the practice status recorded for others. */
export interface PracticeState {
  readonly solved: ReadonlySet<string>
  readonly recorded: ReadonlyMap<string, ProblemStatus>
}

const practiceRowSchema = z.object({ problem_id: z.string().min(1), status: z.enum(['attempted', 'solved']) })
/** Built once: a library load checks the id of every catalog row, and building a schema per row costs more than the check. */
const idSchema = z.string().min(1)
const canonicalSchema = idSchema.nullable().optional()
const gradingVersionSchema = z.number().int().positive().nullable().optional()

export function practiceState(attempts: readonly Pick<LeetCodeAttempt, 'problemId'>[], practiceRows: readonly JsonObject[]): PracticeState {
  return {
    solved: new Set(attempts.map((attempt) => attempt.problemId)),
    recorded: new Map(practiceRows.map((row) => { const parsed = practiceRowSchema.parse(row); return [parsed.problem_id, parsed.status] as const }))
  }
}

/**
 * A problem's status is the account's own history on that exact problem: solved once it has an attempt,
 * otherwise its recorded practice status, otherwise unattempted. A duplicate group shows its canonical
 * problem's status; history on a retained source is not carried over to the group.
 */
export function problemStatus(problemId: string, state: PracticeState): ProblemStatus {
  if (state.solved.has(problemId)) return 'solved'
  return state.recorded.get(problemId) ?? 'unattempted'
}

export function problemRecord(row: JsonObject, state: PracticeState): ProblemRecord {
  return problemRecordSchema.parse({ ...camelRow(row), status: problemStatus(idSchema.parse(row.id), state) })
}

/** Every problem the account sees: the catalog and its own custom problems, which never share an id. */
export function libraryRecords(catalog: readonly JsonObject[], custom: readonly JsonObject[], state: PracticeState): ProblemRecord[] {
  const records = [...catalog, ...custom].map((row) => problemRecord(row, state))
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`Problem ${record.id} is both a catalog problem and a custom problem; refresh the library`)
    seen.add(record.id)
  }
  return records
}

/** The rows one open problem is composed from. Catalog rows here are whole, with their source evidence. */
export interface ProblemDetailRows {
  readonly requested: JsonObject
  /** Every member of the requested problem's group, the canonical problem included. */
  readonly members: readonly JsonObject[]
  /** The canonical problem's current statement, or null when it has none. */
  readonly content: JsonObject | null
  /** The requested problem's current statement, or null when it has none. */
  readonly requestedContent: JsonObject | null
}

/** The id of the problem whose statement and grader a group uses. */
export function canonicalIdOf(row: JsonObject): string {
  return canonicalSchema.parse(row.canonical_problem_id) ?? idSchema.parse(row.id)
}

function contentOf(row: JsonObject | null): ProblemContent | null {
  return row === null ? null : problemContentSchema.parse(camelRow(row))
}

const byLabel = (left: string, right: string): number => left.localeCompare(right)

/**
 * The open problem, as `manor_problem_query('read_problem')` returns it: the canonical problem with the topic,
 * company, tag, and collection labels of its whole group, its statement and grading availability, the requested
 * source and its own statement, and every source of the group in id order.
 *
 * A grader is available when the canonical problem is a coding problem whose current statement has a testset
 * (`grading_version`). A custom coding problem with a statement can also run code before it has a grader.
 */
export function problemDetail(rows: ProblemDetailRows, state: PracticeState): ProblemDetail {
  const requestedId = idSchema.parse(rows.requested.id)
  const canonicalId = canonicalIdOf(rows.requested)
  const members = [...rows.members].sort((left, right) => (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0))
  const canonicalRow = members.find((row) => row.id === canonicalId)
  if (canonicalRow === undefined) throw new Error(`The canonical problem ${canonicalId} of ${requestedId} is not in the library; refresh it before opening this problem`)
  if (!members.some((row) => row.id === requestedId)) throw new Error(`Problem ${requestedId} is not a source of ${canonicalId}`)
  const sourceRecords = members.map((row) => problemRecord(row, state))
  const canonical = problemRecord(canonicalRow, state)
  const labels = (property: 'topics' | 'companies' | 'tags' | 'collections'): string[] => [...new Set(sourceRecords.flatMap((record) => record[property]))].sort(byLabel)
  const problem = members.length === 1 ? canonical : { ...canonical, topics: labels('topics'), companies: labels('companies'), tags: labels('tags'), collections: labels('collections') }
  const content = contentOf(rows.content)
  const gradingAvailable = problem.kind === 'coding' && gradingVersionSchema.parse(canonicalRow.grading_version) != null
  return {
    problem, content, gradingAvailable,
    canExecute: gradingAvailable || (problem.kind === 'coding' && problem.sourceType === 'custom' && content !== null),
    requestedId, requestedProblem: problemRecord(rows.requested, state), requestedContent: contentOf(rows.requestedContent), sourceRecords
  }
}
