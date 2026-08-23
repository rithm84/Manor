import type { LeetCodeAttempt, LeetCodeProblem, LeetCodeState } from '../../../../shared/leetcode'
import type { LeetCodeTopic } from '../../data/mock'

export interface LeetCodeProblemVM extends LeetCodeProblem {
  attemptCount: number
  lastAttemptDate: string | null
}

export interface LeetCodeTopicVM {
  name: string
  done: number
  total: number
  problems: readonly LeetCodeProblemVM[] | null
}

export interface LeetCodeViewModel {
  topics: readonly LeetCodeTopicVM[]
  distinctSolved: number
  attemptCount: number
}

function addUtcDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function previousIsoDate(dateValue: string): string {
  return addUtcDays(dateValue, -1)
}

export function attemptsForProblem(
  attempts: readonly LeetCodeAttempt[],
  problemId: string
): readonly LeetCodeAttempt[] {
  return [...attempts]
    .filter((attempt) => attempt.problemId === problemId)
    .sort((left, right) =>
      right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)
    )
}

export function buildLeetCodeView(
  state: LeetCodeState,
  topicDefinitions: readonly LeetCodeTopic[]
): LeetCodeViewModel {
  const attemptsByProblem = new Map<string, LeetCodeAttempt[]>()
  state.attempts.forEach((attempt) => {
    const attempts = attemptsByProblem.get(attempt.problemId) ?? []
    attempts.push(attempt)
    attemptsByProblem.set(attempt.problemId, attempts)
  })
  const legacyByTopic = new Map(
    state.summary.legacyProgress.map((progress) => [progress.topic, progress])
  )
  const topics = topicDefinitions.map((topic): LeetCodeTopicVM => {
    const topicProblems = state.problems.filter((problem) => problem.topic === topic.name)
    const problemRows = topicProblems.map((problem): LeetCodeProblemVM => {
      const attempts = attemptsByProblem.get(problem.id) ?? []
      const lastAttemptDate = attempts.reduce<string | null>(
        (latest, attempt) => latest === null || attempt.date > latest ? attempt.date : latest,
        null
      )
      return { ...problem, attemptCount: attempts.length, lastAttemptDate }
    })
    const solvedProblems = problemRows.filter((problem) => problem.attemptCount > 0).length
    const legacySolved = legacyByTopic.get(topic.name)?.solvedCount ?? 0
    return {
      name: topic.name,
      done: solvedProblems + legacySolved,
      total: topic.total,
      problems: problemRows.length === 0 ? null : problemRows
    }
  })
  const legacySolved = state.summary.legacyProgress.reduce(
    (sum, progress) => sum + progress.solvedCount,
    0
  )
  const legacyAttempts = state.summary.legacyProgress.reduce(
    (sum, progress) => sum + progress.attemptCount,
    0
  )
  return {
    topics,
    distinctSolved: attemptsByProblem.size + legacySolved,
    attemptCount: state.attempts.length + legacyAttempts
  }
}

export function recentAttemptCounts(
  attempts: readonly LeetCodeAttempt[],
  endDate: string,
  dayCount: number
): readonly { date: string; count: number }[] {
  if (!Number.isInteger(dayCount) || dayCount <= 0) {
    throw new RangeError('LeetCode intensity day count must be a positive integer')
  }
  const counts = new Map<string, number>()
  attempts.forEach((attempt) => counts.set(attempt.date, (counts.get(attempt.date) ?? 0) + 1))
  return Array.from({ length: dayCount }, (_, index) => {
    const date = addUtcDays(endDate, index - (dayCount - 1))
    return { date, count: counts.get(date) ?? 0 }
  })
}

export function formatAttemptDate(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
