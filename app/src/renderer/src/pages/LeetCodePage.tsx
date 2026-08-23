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
  const intensity = useMemo(
    () => state === null ? [] : recentAttemptCounts(state.attempts, today, 14),
    [state, today]
  )

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

  const maxAttempts = Math.max(1, ...intensity.map((day) => day.count))

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

        <aside className="lc-panel lc-panel--intensity">
          <h2 className="lc-panel-title">The last two weeks</h2>
          <div className="lc-intensity">
            {intensity.map((day) => (
              <Tooltip
                key={day.date}
                label={`${intensityDayLabel(day.date, today)} · ${day.count} ${day.count === 1 ? 'attempt' : 'attempts'}`}
                side="top"
              >
                <span className="lc-intensity-col">
                  {day.count === 0 ? (
                    <span className="lc-intensity-zero" />
                  ) : (
                    <span
                      className="lc-intensity-bar"
                      style={{ height: `${(day.count / maxAttempts) * 100}%` }}
                    />
                  )}
                </span>
              </Tooltip>
            ))}
          </div>
          <span className="lc-intensity-caption">Solve and review attempts per day.</span>
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
