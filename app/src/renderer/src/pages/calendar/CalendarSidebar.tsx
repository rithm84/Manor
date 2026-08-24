import { BriefcaseBusiness, CalendarPlus, CheckSquare2, MoreHorizontal, Settings2, TimerReset } from 'lucide-react'
import type { ReactNode } from 'react'

import type { CalendarDefinition, CalendarSettings } from '../../../../shared/calendar'
import type { CalendarItemReference } from './calendarEvents'
import { MiniMonth } from './MiniMonth'

export type ManorOverlay = 'tasks' | 'jobs' | 'scratch'

export interface CalendarUpcomingItem {
  id: string
  title: string
  date: string
  color: string
  reference: CalendarItemReference
}

export interface CalendarSidebarProps {
  anchor: string
  calendars: readonly CalendarDefinition[]
  settings: CalendarSettings
  overlays: ReadonlySet<ManorOverlay>
  upcoming: readonly CalendarUpcomingItem[]
  onPickDay: (date: string) => void
  onToggleCalendar: (calendar: CalendarDefinition) => void
  onEditCalendar: (calendar: CalendarDefinition) => void
  onCreateCalendar: () => void
  onToggleOverlay: (overlay: ManorOverlay) => void
  onOpenSettings: () => void
  onOpenUpcoming: (reference: CalendarItemReference) => void
}

function CalendarRow({
  calendar,
  onToggle,
  onEdit
}: {
  calendar: CalendarDefinition
  onToggle: () => void
  onEdit: () => void
}): ReactNode {
  return (
    <div className="cal-source-row">
      <button
        type="button"
        className={`cal-source-toggle${calendar.visible ? ' is-on' : ''}`}
        style={{ '--calendar-color': calendar.color } as React.CSSProperties}
        onClick={onToggle}
        aria-label={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.name}`}
        aria-pressed={calendar.visible}
      />
      <button type="button" className="cal-source-name" onClick={onToggle}>
        {calendar.name}
      </button>
      {!calendar.readOnly ? (
        <button type="button" className="cal-source-more" onClick={onEdit} aria-label={`Edit ${calendar.name}`}>
          <MoreHorizontal size={14} />
        </button>
      ) : null}
    </div>
  )
}

const OVERLAY_ROWS: readonly { id: ManorOverlay; label: string; icon: ReactNode; color: string }[] = [
  { id: 'tasks', label: 'Task due dates', icon: <CheckSquare2 size={14} />, color: '#71549e' },
  { id: 'jobs', label: 'Job milestones', icon: <BriefcaseBusiness size={14} />, color: '#8f6a0e' },
  { id: 'scratch', label: 'Scratch blocks', icon: <TimerReset size={14} />, color: '#48708e' }
]

export function CalendarSidebar({
  anchor,
  calendars,
  settings,
  overlays,
  upcoming,
  onPickDay,
  onToggleCalendar,
  onEditCalendar,
  onCreateCalendar,
  onToggleOverlay,
  onOpenSettings,
  onOpenUpcoming
}: CalendarSidebarProps): ReactNode {
  return (
    <aside className="cal-sidebar" aria-label="Calendar controls">
      <MiniMonth anchor={anchor} weekStart={settings.weekStart} primaryTimeZone={settings.primaryTimeZone} onPickDay={onPickDay} />

      <section className="cal-source-section">
        <header className="cal-source-heading">
          <span>My calendars</span>
          <button type="button" className="cal-icon-btn" onClick={onCreateCalendar} aria-label="Create calendar">
            <CalendarPlus size={14} />
          </button>
        </header>
        {calendars.filter((calendar) => calendar.source !== 'manor').map((calendar) => (
          <CalendarRow
            key={calendar.id}
            calendar={calendar}
            onToggle={() => onToggleCalendar(calendar)}
            onEdit={() => onEditCalendar(calendar)}
          />
        ))}
      </section>

      <section className="cal-source-section">
        <header className="cal-source-heading"><span>Manor</span></header>
        {OVERLAY_ROWS.map((row) => (
          <div className="cal-source-row" key={row.id}>
            <button
              type="button"
              className={`cal-source-toggle${overlays.has(row.id) ? ' is-on' : ''}`}
              style={{ '--calendar-color': row.color } as React.CSSProperties}
              aria-pressed={overlays.has(row.id)}
              aria-label={`${overlays.has(row.id) ? 'Hide' : 'Show'} ${row.label}`}
              onClick={() => onToggleOverlay(row.id)}
            />
            <button type="button" className="cal-source-name cal-source-name--icon" onClick={() => onToggleOverlay(row.id)}>
              {row.icon}<span>{row.label}</span>
            </button>
          </div>
        ))}
      </section>

      <section className="cal-upcoming-section" aria-label="Upcoming events">
        <header className="cal-source-heading"><span>Upcoming</span></header>
        {upcoming.length === 0 ? <p>No upcoming events</p> : upcoming.map((item) => (
          <button key={item.id} type="button" className="cal-upcoming-row" onClick={() => onOpenUpcoming(item.reference)}>
            <span className="cal-upcoming-mark" style={{ background: item.color }} />
            <span><strong>{item.title}</strong><small>{item.date}</small></span>
          </button>
        ))}
      </section>

      <div className="cal-sidebar-spacer" />
      <button type="button" className="cal-settings-button" onClick={onOpenSettings}>
        <Settings2 size={14} />
        Calendar settings
      </button>
    </aside>
  )
}
