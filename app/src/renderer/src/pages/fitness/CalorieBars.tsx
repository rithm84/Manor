import type { ReactNode } from 'react'

import { Tooltip } from '../../components/ui'
import type { CalorieDay } from '../../data/mock'

export interface CalorieBarsProps {
  days: readonly CalorieDay[]
  averageIn: number
}

function barTooltip(day: CalorieDay): string {
  const intake = `${day.caloriesIn.toLocaleString('en-US')} in`
  if (day.caloriesOut === 0) {
    return intake
  }
  return `${intake} · ${day.caloriesOut.toLocaleString('en-US')} out`
}

/** Seven days of calorie intake as quiet bars, with the weekly average line. */
export function CalorieBars({ days, averageIn }: CalorieBarsProps): ReactNode {
  const max = Math.max(...days.map((day) => day.caloriesIn))

  return (
    <div className="fitness-bars">
      <div className="fitness-bars-plot">
        <div className="fitness-bars-avg" style={{ top: `${(1 - averageIn / max) * 100}%` }}>
          <span className="fitness-bars-avg-label tnum">avg {averageIn.toLocaleString('en-US')}</span>
        </div>
        {days.map((day, index) => {
          const isYesterday = index === days.length - 1
          return (
            <div key={day.date} className="fitness-bars-col">
              <Tooltip label={barTooltip(day)} side="top">
                <div
                  className={`fitness-bars-bar${isYesterday ? ' is-yesterday' : ''}`}
                  style={{ height: `${(day.caloriesIn / max) * 100}%` }}
                />
              </Tooltip>
            </div>
          )
        })}
      </div>
      <div className="fitness-bars-axis">
        {days.map((day) => (
          <span key={day.date} className="fitness-bars-day">
            {day.weekdayShort}
          </span>
        ))}
      </div>
    </div>
  )
}
