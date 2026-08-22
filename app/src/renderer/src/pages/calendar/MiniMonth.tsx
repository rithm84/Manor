import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { TODAY_ISO } from '../../data/mock'
import { addMonths, monthCells, monthTitle, startOfWeek } from './calendarModel'

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

export interface MiniMonthProps {
  /** The main view's anchor date; its week row is banded. */
  anchor: string
  onPickDay: (iso: string) => void
}

/**
 * Notion Calendar mini month: title + chevrons, weekday letters, banded
 * current week, today filled. Chevrons browse months locally without
 * moving the main view; picking a day hands the date up and snaps back.
 */
export function MiniMonth({ anchor, onPickDay }: MiniMonthProps): ReactNode {
  const [monthShift, setMonthShift] = useState(0)

  useEffect(() => {
    setMonthShift(0)
  }, [anchor])

  const shownMonth = addMonths(anchor, monthShift)
  const cells = monthCells(shownMonth)
  const bandStart = startOfWeek(anchor)
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <span className="cal-mini-title">{monthTitle(shownMonth)}</span>
        <span className="cal-mini-nav">
          <button
            type="button"
            className="cal-chev cal-chev--sm"
            onClick={() => setMonthShift(monthShift - 1)}
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="cal-chev cal-chev--sm"
            onClick={() => setMonthShift(monthShift + 1)}
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div className="cal-mini-row" aria-hidden="true">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <span key={`${letter}-${index}`} className="cal-mini-cell cal-mini-weekday">
            {letter}
          </span>
        ))}
      </div>
      {weeks.map((week) => {
        const banded = week[0].iso === bandStart
        return (
          <div key={week[0].iso} className={`cal-mini-row${banded ? ' is-current-week' : ''}`}>
            {week.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                className={`cal-mini-cell cal-mini-day${cell.inMonth ? '' : ' is-outside'}${
                  cell.iso === TODAY_ISO ? ' is-today' : ''
                }${cell.iso === anchor ? ' is-anchor' : ''}`}
                onClick={() => onPickDay(cell.iso)}
                aria-label={cell.iso}
              >
                {cell.day}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
