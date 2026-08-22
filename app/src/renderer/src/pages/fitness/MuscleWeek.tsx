import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { Pill, Tooltip } from '../../components/ui'
import type { MuscleGroupStat } from '../../data/mock'

export interface MuscleWeekProps {
  groups: readonly MuscleGroupStat[]
}

interface WeekMark {
  label: string
  hit: boolean
}

function historyFor(group: MuscleGroupStat): readonly WeekMark[] {
  return [
    { label: 'Two weeks ago', hit: group.hitTwoWeeksAgo },
    { label: 'Last week', hit: group.hitPrevWeek },
    { label: 'This week', hit: group.hitThisWeek }
  ]
}

/** Nine muscle groups: this week's coverage plus a three-week trace. */
export function MuscleWeek({ groups }: MuscleWeekProps): ReactNode {
  return (
    <div className="fitness-muscles">
      {groups.map((group) => (
        <div key={group.group} className={`fitness-muscle${group.hitThisWeek ? ' is-hit' : ''}`}>
          <span className="fitness-muscle-mark" aria-hidden="true">
            {group.hitThisWeek ? <Check size={12} /> : null}
          </span>
          <span className="fitness-muscle-name">{group.group}</span>
          {group.longestStreak > 0 ? (
            <Pill variant="tag" colorway="gold" label={`${group.longestStreak} weeks running`} />
          ) : null}
          <span className="fitness-muscle-trace" aria-hidden="true">
            {historyFor(group).map((mark) => (
              <Tooltip key={mark.label} label={mark.label} side="top">
                <span className={`fitness-muscle-dot${mark.hit ? ' is-hit' : ''}`} />
              </Tooltip>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}
