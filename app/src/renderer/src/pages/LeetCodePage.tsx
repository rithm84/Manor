import { CalendarClock, Code2, Flame, Snowflake } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { EmptyState, Tooltip } from '../components/ui'
import { events, leetcodeStats, leetcodeTopics, neetcodeProblems } from '../data/mock'
import { TopicList } from './leetcode/TopicList'
import type { TopicRowVM } from './leetcode/TopicList'
import './leetcode/leetcode.css'

const HOUR_WORDS = [
  'twelve',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven'
] as const

/** "14:00" -> "two o'clock"; falls back to the raw time off the hour. */
function spokenHour(time: string): string {
  const [hourPart, minutePart] = time.split(':')
  const hour = Number.parseInt(hourPart, 10)
  if (minutePart !== '00' || Number.isNaN(hour)) {
    return time
  }
  return `${HOUR_WORDS[hour % 12]} o'clock`
}

function todayLine(): string | null {
  if (leetcodeStats.todayBlockEventId === null) {
    return null
  }
  const block = events.find((event) => event.id === leetcodeStats.todayBlockEventId)
  const currentTopic = leetcodeTopics.find((topic) => topic.current)
  if (block === undefined || currentTopic === undefined) {
    return null
  }
  return `The ${spokenHour(block.start)} block is set aside for ${currentTopic.name}.`
}

/** Intensity column dates: last14Days ends today, Aug 20. */
function intensityDayLabel(index: number, total: number): string {
  const day = 20 - (total - 1 - index)
  if (day === 20) {
    return 'Today'
  }
  return `Aug ${day}`
}

function initialDoneNames(): ReadonlySet<string> {
  return new Set(
    neetcodeProblems.flatMap((topic) =>
      topic.problems.filter((problem) => problem.done).map((problem) => problem.name)
    )
  )
}

function initialExpanded(): ReadonlySet<string> {
  const current = leetcodeTopics.find((topic) => topic.current)
  return new Set(current !== undefined ? [current.name] : [])
}

export function LeetCodePage(): ReactNode {
  const [doneNames, setDoneNames] = useState<ReadonlySet<string>>(initialDoneNames)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(initialExpanded)

  const baselineDone = initialDoneNames().size
  const problemsByTopic = new Map(neetcodeProblems.map((entry) => [entry.topic, entry.problems]))

  const topicRows: readonly TopicRowVM[] = leetcodeTopics.map((topic) => {
    const problems = problemsByTopic.get(topic.name) ?? null
    const done =
      problems !== null
        ? problems.filter((problem) => doneNames.has(problem.name)).length
        : topic.done
    return { name: topic.name, done, total: topic.total, current: topic.current, problems }
  })

  const solved = topicRows.reduce((sum, topic) => sum + topic.done, 0)
  const solvedToday = Math.max(0, leetcodeStats.solvedToday + (doneNames.size - baselineDone))

  const toggleExpand = (name: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const toggleProblem = (name: string): void => {
    setDoneNames((previous) => {
      const next = new Set(previous)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  if (solved === 0) {
    return (
      <div className="lc">
        <h1 className="page-title">LeetCode</h1>
        <EmptyState
          icon={<Code2 size={20} />}
          title="The grind starts here"
          message="Pick a topic and Manor keeps the score."
        />
      </div>
    )
  }

  const blockLine = todayLine()
  const maxSolves = Math.max(1, ...leetcodeStats.last14Days)

  return (
    <div className="lc">
      <h1 className="page-title">LeetCode</h1>

      <section className="lc-hero ui-card">
        <div className="lc-hero-main">
          <span className="lc-hero-count tnum">
            {solved}
            <span className="lc-hero-total"> of {leetcodeStats.total}</span>
          </span>
          <span className="lc-hero-label">Neetcode 150</span>
          <div className="lc-hero-bar">
            <div
              className="lc-hero-fill"
              style={{ width: `${(solved / leetcodeStats.total) * 100}%` }}
            />
          </div>
        </div>
        <div className="lc-hero-side">
          <span className="lc-chip">
            <Flame size={14} />
            <span className="tnum">{leetcodeStats.streak}</span> day streak
          </span>
          <span className="lc-chip">
            <Snowflake size={14} />
            <span className="tnum">{leetcodeStats.freezesLeft}</span> of{' '}
            <span className="tnum">{leetcodeStats.freezesPerMonth}</span> freezes left
          </span>
        </div>
      </section>

      {blockLine !== null ? (
        <div className="lc-today">
          <CalendarClock size={15} />
          <span className="lc-today-line">{blockLine}</span>
          <span className="lc-today-sub">
            {solvedToday === 0 ? 'Nothing solved yet today.' : `${solvedToday} solved today.`}
          </span>
        </div>
      ) : null}

      <div className="lc-grid">
        <section className="lc-panel ui-card">
          <h2 className="lc-panel-title">By topic</h2>
          <TopicList
            topics={topicRows}
            doneNames={doneNames}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onToggleProblem={toggleProblem}
          />
        </section>

        <section className="lc-panel lc-panel--intensity ui-card">
          <h2 className="lc-panel-title">The last two weeks</h2>
          <div className="lc-intensity">
            {leetcodeStats.last14Days.map((count, index) => (
              <Tooltip
                key={index}
                label={`${intensityDayLabel(index, leetcodeStats.last14Days.length)} · ${count} solved`}
                side="top"
              >
                <span className="lc-intensity-col">
                  {count === 0 ? (
                    <span className="lc-intensity-zero" />
                  ) : (
                    <span
                      className="lc-intensity-bar"
                      style={{ height: `${(count / maxSolves) * 100}%` }}
                    />
                  )}
                </span>
              </Tooltip>
            ))}
          </div>
          <span className="lc-intensity-caption">Problems solved per day.</span>
        </section>
      </div>
    </div>
  )
}
