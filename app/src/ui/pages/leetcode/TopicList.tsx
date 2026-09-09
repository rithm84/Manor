import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import type { LeetCodeDifficulty } from '../../../shared/leetcode'
import { Pill } from '../../components/ui'
import type { PillColorway } from '../../components/ui'
import { formatAttemptDate } from './leetCodeModel'
import type { LeetCodeTopicVM } from './leetCodeModel'

export interface TopicListProps {
  topics: readonly LeetCodeTopicVM[]
  expanded: ReadonlySet<string>
  onToggleExpand: (name: string) => void
  onOpenProblem: (problemId: string) => void
}

const DIFFICULTY_COLORWAY: Record<LeetCodeDifficulty, PillColorway> = {
  Easy: 'success',
  Medium: 'today',
  Hard: 'overdue'
}

function attemptSummary(attemptCount: number, lastAttemptDate: string | null): string {
  if (attemptCount === 0 || lastAttemptDate === null) {
    return 'Not solved'
  }
  return `${attemptCount} ${attemptCount === 1 ? 'attempt' : 'attempts'} · ${formatAttemptDate(lastAttemptDate)}`
}

/** Per-topic curriculum progress. Problem rows open durable solve and review history. */
export function TopicList({
  topics,
  expanded,
  onToggleExpand,
  onOpenProblem
}: TopicListProps): ReactNode {
  return (
    <div className="lc-topics">
      {topics.map((topic) => {
        const complete = topic.done === topic.total
        const expandable = topic.problems !== null
        const open = expandable && expanded.has(topic.name)
        const rowClass = ['lc-topic', complete ? 'is-complete' : '', open ? 'is-open' : '']
          .filter((part) => part !== '')
          .join(' ')
        const rowContent = (
          <>
            <span className={`lc-topic-chev${open ? ' is-open' : ''}`} aria-hidden="true">
              {expandable ? <ChevronRight size={14} /> : null}
            </span>
            <span className="lc-topic-mark" aria-hidden="true">
              {complete ? <Check size={12} /> : null}
            </span>
            <span className="lc-topic-name">{topic.name}</span>
            <span className="lc-topic-bar" aria-hidden="true">
              <span
                className="lc-topic-fill"
                style={{ width: `${topic.total === 0 ? 0 : (topic.done / topic.total) * 100}%` }}
              />
            </span>
            <span className="lc-topic-count tnum">
              {topic.done} of {topic.total}
            </span>
          </>
        )
        return (
          <div key={topic.name} className="lc-topic-block">
            {expandable ? (
              <button
                type="button"
                className={rowClass}
                onClick={() => onToggleExpand(topic.name)}
                aria-expanded={open}
              >
                {rowContent}
              </button>
            ) : (
              <div className={`${rowClass} is-static`}>{rowContent}</div>
            )}

            {open && topic.problems !== null ? (
              <div className="lc-problems">
                {topic.problems.map((problem) => {
                  const solved = problem.attemptCount > 0
                  const summary = attemptSummary(problem.attemptCount, problem.lastAttemptDate)
                  return (
                    <button
                      key={problem.id}
                      type="button"
                      className={`lc-problem${solved ? ' is-done' : ''}`}
                      onClick={() => onOpenProblem(problem.id)}
                      aria-label={`${problem.name}. ${summary}. Open solve and review history.`}
                    >
                      <span className="lc-problem-mark" aria-hidden="true">
                        {solved ? <Check size={11} /> : null}
                      </span>
                      <span className="lc-problem-name">{problem.name}</span>
                      <span className="lc-problem-attempts tnum">{summary}</span>
                      <Pill
                        variant="tag"
                        colorway={DIFFICULTY_COLORWAY[problem.difficulty]}
                        label={problem.difficulty}
                      />
                      <ChevronRight className="lc-problem-open" size={14} aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
