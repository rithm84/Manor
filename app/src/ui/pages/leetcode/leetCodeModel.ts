import type { LeetCodeAttempt } from '../../../shared/leetcode'

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
