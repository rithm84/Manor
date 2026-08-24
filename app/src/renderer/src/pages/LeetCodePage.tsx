import { Code2, Flame, Snowflake } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type {
  AddLeetCodeAttemptMutation,
  LeetCodeState,
  UpdateLeetCodeAttemptMutation
} from '../../../shared/leetcode'
import { leetCodeLocalDate } from '../../../shared/leetcode'
import { Button, Tooltip } from '../components/ui'
import { leetcodeTopics } from '../data/mock'
import { ProblemReviewModal } from './leetcode/ProblemReviewModal'
import { TopicList } from './leetcode/TopicList'
import {
  attemptsForProblem,
  buildLeetCodeView,
  errorMessage,
  formatAttemptDate,
  recentAttemptCounts
} from './leetcode/leetCodeModel'
import { LEETCODE_SEED } from './leetcode/leetCodeSeed'
import './leetcode/leetcode.css'

const WEEK_ROW_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
})

function weekRowLabel(date: string, today: string): string {
  return date === today ? 'Today' : WEEK_ROW_DATE.format(new Date(`${date}T00:00:00.000Z`))
}

function intensityDayLabel(date: string, today: string): string {
  return date === today ? 'Today' : formatAttemptDate(date).replace(/, \d{4}$/, '')
}

function firstIncompleteTopic(state: LeetCodeState): string | null {
  return buildLeetCodeView(state, leetcodeTopics).topics.find(
    (topic) => topic.problems !== null && topic.done < topic.total
  )?.name ?? null
}

export function LeetCodePage(): ReactNode {
  const [state, setState] = useState<LeetCodeState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const today = leetCodeLocalDate(new Date())

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void window.manor.leetcode
      .load(LEETCODE_SEED)
      .then((nextState) => {
        if (cancelled) return
        setState(nextState)
        const firstTopic = firstIncompleteTopic(nextState)
        setExpanded(firstTopic === null ? new Set() : new Set([firstTopic]))
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(error))
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [loadAttempt])

  const view = useMemo(
    () => state === null ? null : buildLeetCodeView(state, leetcodeTopics),
    [state]
  )
  const week = useMemo(
    () => state === null ? [] : recentAttemptCounts(state.attempts, today, 7),
    [state, today]
  )
  const weekTotal = week.reduce((total, day) => total + day.count, 0)
  const weekMax = week.reduce((max, day) => Math.max(max, day.count), 1)

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

  const addAttempt = async (mutation: AddLeetCodeAttemptMutation): Promise<void> => {
    setState(await window.manor.leetcode.addAttempt(mutation))
  }

  const updateAttempt = async (mutation: UpdateLeetCodeAttemptMutation): Promise<void> => {
    setState(await window.manor.leetcode.updateAttempt(mutation))
  }

  const deleteAttempt = async (attemptId: string): Promise<void> => {
    setState(await window.manor.leetcode.deleteAttempt(attemptId))
  }

  const selectedProblem = state?.problems.find((problem) => problem.id === selectedProblemId) ?? null
  const selectedAttempts = state === null || selectedProblem === null
    ? []
    : attemptsForProblem(state.attempts, selectedProblem.id)

  if (loadError !== null && state === null) {
    return (
      <div className="lc">
        <h1 className="page-title">LeetCode</h1>
        <div className="lc-load-error" role="alert">
          <Code2 size={20} aria-hidden="true" />
          <div>
            <strong>LeetCode could not load.</strong>
            <p>{loadError}</p>
          </div>
          <Button variant="ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
        </div>
      </div>
    )
  }

  if (state === null || view === null) {
    return (
      <div className="lc">
        <h1 className="page-title">LeetCode</h1>
        <p className="lc-loading" role="status">Loading curriculum…</p>
      </div>
    )
  }

  return (
    <div className="lc">
      <header className="lc-header">
        <h1 className="page-title">LeetCode</h1>
        <span className="lc-header-meta">Neetcode 150</span>
      </header>

      <section className="lc-hero" aria-label="Neetcode progress">
        <div className="lc-hero-main">
          <span className="lc-hero-count tnum">
            {view.distinctSolved}
            <span className="lc-hero-total"> of {state.summary.totalProblems}</span>
          </span>
          <span className="lc-hero-label">
            Distinct problems solved · <span className="tnum">{view.attemptCount}</span> total attempts
          </span>
          <div className="lc-hero-bar" aria-hidden="true">
            <div
              className="lc-hero-fill"
              style={{ width: `${(view.distinctSolved / state.summary.totalProblems) * 100}%` }}
            />
          </div>
        </div>
        <div className="lc-hero-side">
          <span className="lc-chip">
            <Flame size={14} aria-hidden="true" />
            <span className="tnum">{state.summary.streak}</span> day streak
          </span>
          <span className="lc-chip">
            <Snowflake size={14} aria-hidden="true" />
            <span className="tnum">{state.summary.freezesLeft}</span> of{' '}
            <span className="tnum">{state.summary.freezesPerMonth}</span> freezes left
          </span>
        </div>
      </section>

      <div className="lc-grid">
        <section className="lc-panel lc-panel--topics">
          <h2 className="lc-panel-title">By topic</h2>
          <TopicList
            topics={view.topics}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onOpenProblem={setSelectedProblemId}
          />
        </section>

        <aside className="lc-panel lc-panel--week">
          <h2 className="lc-panel-title">This week</h2>
          <div className="lc-week" role="list" aria-label="Attempts in the last seven days">
            {week.map((day) => (
              <Tooltip
                key={day.date}
                label={`${intensityDayLabel(day.date, today)} · ${day.count} ${day.count === 1 ? 'attempt' : 'attempts'}`}
                side="top"
              >
                <span
                  role="listitem"
                  className={`lc-week-row${day.date === today ? ' is-today' : ''}${day.count === 0 ? ' is-zero' : ''}`}
                >
                  <span className="lc-week-label">{weekRowLabel(day.date, today)}</span>
                  <span className="lc-week-track" aria-hidden="true">
                    {day.count > 0 ? (
                      <span
                        className="lc-week-fill"
                        style={{ width: `${Math.max((day.count / weekMax) * 100, 8)}%` }}
                      />
                    ) : null}
                  </span>
                  <span className="lc-week-count tnum">{day.count}</span>
                </span>
              </Tooltip>
            ))}
          </div>
          <span className="lc-week-total">
            <span className="tnum">{weekTotal}</span> {weekTotal === 1 ? 'attempt' : 'attempts'} this week
          </span>
        </aside>
      </div>

      {selectedProblem === null ? null : (
        <ProblemReviewModal
          problem={selectedProblem}
          attempts={selectedAttempts}
          today={today}
          onClose={() => setSelectedProblemId(null)}
          onAddAttempt={addAttempt}
          onUpdateAttempt={updateAttempt}
          onDeleteAttempt={deleteAttempt}
        />
      )}
    </div>
  )
}
