import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Checkbox, Pill } from '../../components/ui'
import type { PillColorway } from '../../components/ui'
import type { NeetcodeProblem, ProblemDifficulty } from '../../data/mock'

/** One topic with derived done count and its problem rows (null = count only). */
export interface TopicRowVM {
  name: string
  done: number
  total: number
  current: boolean
  problems: readonly NeetcodeProblem[] | null
}

export interface TopicListProps {
  topics: readonly TopicRowVM[]
  doneNames: ReadonlySet<string>
  expanded: ReadonlySet<string>
  onToggleExpand: (name: string) => void
  onToggleProblem: (name: string) => void
}

const DIFFICULTY_COLORWAY: Record<ProblemDifficulty, PillColorway> = {
  Easy: 'success',
  Medium: 'today',
  Hard: 'overdue'
}

/** Per-topic progress down the Neetcode 150; topics expand into problem rows. */
export function TopicList({
  topics,
  doneNames,
  expanded,
  onToggleExpand,
  onToggleProblem
}: TopicListProps): ReactNode {
  return (
    <div className="lc-topics">
      {topics.map((topic) => {
        const complete = topic.done === topic.total
        const expandable = topic.problems !== null
        const open = expandable && expanded.has(topic.name)
        const rowClass = [
          'lc-topic',
          complete ? 'is-complete' : '',
          topic.current ? 'is-current' : '',
          open ? 'is-open' : ''
        ]
          .filter((part) => part !== '')
          .join(' ')
        return (
          <div key={topic.name} className="lc-topic-block">
            <button
              type="button"
              className={rowClass}
              onClick={() => {
                if (expandable) {
                  onToggleExpand(topic.name)
                }
              }}
              aria-expanded={expandable ? open : undefined}
            >
              <span className={`lc-topic-chev${open ? ' is-open' : ''}`} aria-hidden="true">
                {expandable ? <ChevronRight size={14} /> : null}
              </span>
              <span className="lc-topic-mark" aria-hidden="true">
                {complete ? <Check size={12} /> : null}
              </span>
              <span className="lc-topic-name">{topic.name}</span>
              {topic.current ? <Pill variant="tag" colorway="coral" label="Up now" /> : null}
              <span className="lc-topic-bar">
                <span
                  className="lc-topic-fill"
                  style={{ width: `${topic.total === 0 ? 0 : (topic.done / topic.total) * 100}%` }}
                />
              </span>
              <span className="lc-topic-count tnum">
                {topic.done} of {topic.total}
              </span>
            </button>

            {open && topic.problems !== null ? (
              <div className="lc-problems">
                {topic.problems.map((problem) => {
                  const done = doneNames.has(problem.name)
                  return (
                    <div key={problem.name} className={`lc-problem${done ? ' is-done' : ''}`}>
                      <Checkbox
                        shape="round"
                        checked={done}
                        onChange={() => onToggleProblem(problem.name)}
                        ariaLabel={`Mark ${problem.name} solved`}
                      />
                      <span className="lc-problem-name">{problem.name}</span>
                      <Pill
                        variant="tag"
                        colorway={DIFFICULTY_COLORWAY[problem.difficulty]}
                        label={problem.difficulty}
                      />
                    </div>
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
