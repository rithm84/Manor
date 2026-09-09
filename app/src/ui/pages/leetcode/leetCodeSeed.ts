import type { LeetCodeAttempt, LeetCodeProblem, LeetCodeSeed } from '../../../shared/leetcode'
import { leetcodeMistakeNotes, leetcodeStats, leetcodeTopics, neetcodeProblems } from '../../data/mock'

const INTENSITY_END_DATE = '2026-08-20'
const OLDER_HISTORY_START_DATE = '2026-07-01'

function addUtcDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function problemId(topicIndex: number, problemIndex: number): string {
  return `neetcode-${topicIndex + 1}-${problemIndex + 1}`
}

function seededAttemptDates(doneCount: number): readonly string[] {
  const recentDates = leetcodeStats.last14Days.flatMap((count, index) => {
    const date = addUtcDays(INTENSITY_END_DATE, index - (leetcodeStats.last14Days.length - 1))
    return Array.from({ length: count }, () => date)
  })
  const olderCount = doneCount - recentDates.length
  if (olderCount < 0) {
    throw new RangeError('LeetCode intensity history exceeds the number of solved mock problems')
  }
  const olderDates = Array.from({ length: olderCount }, (_, index) =>
    addUtcDays(OLDER_HISTORY_START_DATE, index)
  )
  return [...olderDates, ...recentDates]
}

function seedData(): LeetCodeSeed {
  let curriculumOrder = 0
  const problems: LeetCodeProblem[] = neetcodeProblems.flatMap((topic, topicIndex) =>
    topic.problems.map((problem, problemIndex) => ({
      id: problemId(topicIndex, problemIndex),
      topic: topic.topic,
      name: problem.name,
      difficulty: problem.difficulty,
      curriculumOrder: curriculumOrder++
    }))
  )
  const doneIds = neetcodeProblems.flatMap((topic, topicIndex) =>
    topic.problems.flatMap((problem, problemIndex) =>
      problem.done ? [problemId(topicIndex, problemIndex)] : []
    )
  )
  const dates = seededAttemptDates(doneIds.length)
  const attempts: LeetCodeAttempt[] = doneIds.map((id, index) => {
    const date = dates[index]
    const timestamp = `${date}T20:00:${String(index % 60).padStart(2, '0')}.000Z`
    return {
      id: `imported-${id}`,
      problemId: id,
      date,
      solution: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }
  })
  const legacyProgress = leetcodeTopics.flatMap((topic) => {
    const namedSolved = neetcodeProblems
      .find((entry) => entry.topic === topic.name)
      ?.problems.filter((problem) => problem.done).length ?? 0
    const legacyCount = topic.done - namedSolved
    if (legacyCount < 0) {
      throw new RangeError(`LeetCode topic ${topic.name} has more named solves than its summary`)
    }
    return legacyCount === 0
      ? []
      : [{ topic: topic.name, solvedCount: legacyCount, attemptCount: legacyCount }]
  })

  return {
    problems,
    attempts,
    notes: leetcodeMistakeNotes.map((note) => ({
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
      updatedAt: note.createdAt
    })),
    summary: {
      totalProblems: leetcodeStats.total,
      streak: leetcodeStats.streak,
      freezesLeft: leetcodeStats.freezesLeft,
      freezesPerMonth: leetcodeStats.freezesPerMonth,
      legacyProgress
    }
  }
}

export const LEETCODE_SEED = seedData()
