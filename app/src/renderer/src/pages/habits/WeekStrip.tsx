import { Snowflake } from 'lucide-react'
import type { ReactNode } from 'react'

import type { HabitDayMark } from '../../data/mock'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

export interface WeekStripProps {
  week: readonly HabitDayMark[]
}

/** Mon..Sun mini strip for one habit; future days stay blank. */
export function WeekStrip({ week }: WeekStripProps): ReactNode {
  return (
    <div className="habit-week" aria-hidden="true">
      {week.map((mark, index) => (
        <span key={index} className={`habit-week-day is-${mark}`}>
          <span className="habit-week-letter">{DAY_LETTERS[index]}</span>
          <span className="habit-week-dot">{mark === 'frozen' ? <Snowflake size={9} /> : null}</span>
        </span>
      ))}
    </div>
  )
}
