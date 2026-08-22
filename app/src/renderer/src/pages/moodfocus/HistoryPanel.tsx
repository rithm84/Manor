import { Moon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tooltip } from '../../components/ui'
import { moodFocusHistory } from '../../data/mock'
import type { Focus, Mood, MoodFocusEntry } from '../../data/mock'
import { focusLevel, moodLevel, shortDate } from './scales'

export interface HistoryPanelProps {
  todayMood: Mood | null
  todayFocus: Focus | null
}

const MONTH_DAY_COUNT = 31
const TODAY_DAY = 20
/** Aug 1, 2026 falls on a Friday: four leading blanks in a Mon-first grid. */
const MONTH_LEAD_BLANKS = 4

function entryFor(day: number): MoodFocusEntry | null {
  const iso = `2026-08-${String(day).padStart(2, '0')}`
  return moodFocusHistory.find((entry) => entry.date === iso) ?? null
}

function focusCellClass(focus: Focus): string {
  const level = focusLevel(focus)
  return level === 0 ? 'mf-cell mf-cell--rest' : `mf-cell mf-focus-${level}`
}

/** Fourteen-day twin strips plus the compact August texture, on quiet ramps. */
export function HistoryPanel({ todayMood, todayFocus }: HistoryPanelProps): ReactNode {
  const strip = moodFocusHistory.slice(-14)

  return (
    <div className="mf-history">
      <div className="mf-strips">
        <div className="mf-strip">
          <span className="mf-strip-label">Mood</span>
          <div className="mf-strip-cells">
            {strip.map((entry) => (
              <Tooltip key={entry.date} label={`${shortDate(entry.date)} · ${entry.mood}`} side="top">
                <span className={`mf-cell mf-mood-${moodLevel(entry.mood)}`} />
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="mf-strip">
          <span className="mf-strip-label">Focus</span>
          <div className="mf-strip-cells">
            {strip.map((entry) => (
              <Tooltip key={entry.date} label={`${shortDate(entry.date)} · ${entry.focus}`} side="top">
                <span className={focusCellClass(entry.focus)}>
                  {focusLevel(entry.focus) === 0 ? <Moon size={10} /> : null}
                </span>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="mf-strip mf-strip--axis">
          <span className="mf-strip-label" />
          <div className="mf-strip-cells">
            {strip.map((entry) => (
              <span key={entry.date} className="mf-axis-day tnum">
                {Number.parseInt(entry.date.slice(8), 10)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mf-legend" aria-hidden="true">
        <span className="mf-legend-end">Awful</span>
        {[1, 2, 3, 4, 5].map((level) => (
          <span key={level} className={`mf-legend-swatch mf-mood-${level}`} />
        ))}
        <span className="mf-legend-end">Great</span>
        <span className="mf-legend-sep" />
        <span className="mf-legend-rest">
          <Moon size={11} /> Resting
        </span>
      </div>

      <div className="mf-month">
        <span className="mf-month-label">August</span>
        <div className="mf-month-grid">
          {Array.from({ length: MONTH_LEAD_BLANKS }, (_, index) => (
            <span key={`b-${index}`} />
          ))}
          {Array.from({ length: MONTH_DAY_COUNT }, (_, index) => {
            const day = index + 1
            if (day > TODAY_DAY) {
              return <span key={day} className="mf-month-cell is-future" />
            }
            if (day === TODAY_DAY) {
              if (todayMood !== null && todayFocus !== null) {
                return (
                  <Tooltip key={day} label={`Today · ${todayMood}, ${todayFocus} focus`} side="top">
                    <span className={`mf-month-cell mf-mood-${moodLevel(todayMood)} is-logged`} />
                  </Tooltip>
                )
              }
              return <span key={day} className="mf-month-cell is-today" />
            }
            const entry = entryFor(day)
            if (entry === null) {
              return <span key={day} className="mf-month-cell is-blank" />
            }
            return (
              <Tooltip
                key={day}
                label={`${shortDate(entry.date)} · ${entry.mood}, ${entry.focus} focus`}
                side="top"
              >
                <span className={`mf-month-cell mf-mood-${moodLevel(entry.mood)} is-logged`} />
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
