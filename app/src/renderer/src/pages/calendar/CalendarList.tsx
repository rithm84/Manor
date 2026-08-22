import type { ReactNode } from 'react'

import { calendars, user } from '../../data/mock'
import type { CalendarId, CalendarSource } from '../../data/mock'

export interface CalendarListProps {
  enabled: ReadonlySet<CalendarId>
  onToggle: (id: CalendarId) => void
}

function CalendarRow({
  calendar,
  on,
  onToggle
}: {
  calendar: CalendarSource
  on: boolean
  onToggle: (id: CalendarId) => void
}): ReactNode {
  return (
    <button
      type="button"
      className="cal-account-row"
      role="checkbox"
      aria-checked={on}
      onClick={() => onToggle(calendar.id)}
    >
      <span
        className={`cal-swatch${calendar.scratch ? ' cal-swatch--dashed' : ''}${on ? ' is-on' : ''}`}
        style={{ ['--swatch' as string]: calendar.color }}
        aria-hidden="true"
      >
        <svg width="10" height="10" viewBox="0 0 12 12">
          <path
            className="cal-swatch-check"
            d="M2 6.2 L4.8 9 L10 3.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={`cal-account-name${on ? '' : ' is-off'}`}>{calendar.name}</span>
    </button>
  )
}

/**
 * Account-grouped calendar lists (Notion Calendar anatomy): the Google
 * account's calendars under its email, then the Manor scratch-blocks
 * source under its own group. Rows toggle visibility.
 */
export function CalendarList({ enabled, onToggle }: CalendarListProps): ReactNode {
  const accountCalendars = calendars.filter((calendar) => !calendar.scratch)
  const manorCalendars = calendars.filter((calendar) => calendar.scratch)

  return (
    <div className="cal-accounts">
      <div className="cal-accounts-head">{user.email}</div>
      {accountCalendars.map((calendar) => (
        <CalendarRow
          key={calendar.id}
          calendar={calendar}
          on={enabled.has(calendar.id)}
          onToggle={onToggle}
        />
      ))}
      <div className="cal-accounts-head cal-accounts-head--gap">Manor</div>
      {manorCalendars.map((calendar) => (
        <CalendarRow
          key={calendar.id}
          calendar={calendar}
          on={enabled.has(calendar.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
