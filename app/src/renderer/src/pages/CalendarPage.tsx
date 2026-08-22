import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/ui'
import { TODAY_ISO, events as mockEvents, pipeline } from '../data/mock'
import type { CalendarEvent, CalendarId } from '../data/mock'
import { CalendarList } from './calendar/CalendarList'
import { EventPanel } from './calendar/EventPanel'
import { MiniMonth } from './calendar/MiniMonth'
import { MonthGrid } from './calendar/MonthGrid'
import { WeekGrid } from './calendar/WeekGrid'
import type { AllDayItem } from './calendar/WeekGrid'
import type { CalendarSelection } from './calendar/EventPanel'
import { addDays, addMonths, monthTitle, weekDays } from './calendar/calendarModel'
import { PageShell } from './PageShell'
import './calendar/calendar.css'

type CalendarView = 'day' | 'week' | 'month'

const VIEWS: readonly { view: CalendarView; label: string }[] = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' }
]

/** OA deadlines surface in the all-day row. */
const allDayItems: readonly AllDayItem[] = pipeline.flatMap((entry) =>
  entry.dueDate !== null
    ? [{ id: entry.id, date: entry.dueDate, label: `${entry.company} OA` }]
    : []
)

/**
 * The calendar workspace (Notion Calendar anatomy): internal sidebar with
 * mini month and account-grouped calendar lists, slim top bar, and a week
 * grid that owns every remaining pixel. The details panel is closed until
 * an event or block is clicked. Everything is local state over the mock
 * story; the canon week is Mon Aug 18 to Sun Aug 24.
 */
export function CalendarPage(): ReactNode {
  const [view, setView] = useState<CalendarView>('week')
  const [anchor, setAnchor] = useState(TODAY_ISO)
  const [localEvents, setLocalEvents] = useState<readonly CalendarEvent[]>(mockEvents)
  const [enabled, setEnabled] = useState<ReadonlySet<CalendarId>>(
    new Set<CalendarId>(['google-personal', 'ucla', 'manor-scratch'])
  )
  const [selection, setSelection] = useState<CalendarSelection | null>(null)
  const createdCount = useRef(0)

  const visibleEvents = useMemo(
    () => localEvents.filter((event) => enabled.has(event.calendarId)),
    [localEvents, enabled]
  )

  const gridDays = view === 'day' ? [anchor] : weekDays(anchor)

  const step = (direction: 1 | -1): void => {
    if (view === 'day') {
      setAnchor(addDays(anchor, direction))
    } else if (view === 'week') {
      setAnchor(addDays(anchor, direction * 7))
    } else {
      setAnchor(addMonths(anchor, direction))
    }
  }

  const toggleCalendar = (id: CalendarId): void => {
    const next = new Set(enabled)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setEnabled(next)
  }

  const createBlock = (date: string, hour: number): void => {
    createdCount.current += 1
    const id = `scratch-new-${createdCount.current}`
    const start = `${String(hour).padStart(2, '0')}:00`
    const end = `${String(Math.min(24, hour + 1)).padStart(2, '0')}:00`
    const block: CalendarEvent = {
      id,
      title: 'New block',
      calendarId: 'manor-scratch',
      date,
      start,
      end: end === '24:00' ? '23:59' : end,
      scratch: true,
      faded: false,
      taskId: null,
      note: null
    }
    setLocalEvents([...localEvents, block])
    setSelection({ kind: 'event', id })
  }

  const renameEvent = (id: string, title: string): void => {
    setLocalEvents(localEvents.map((event) => (event.id === id ? { ...event, title } : event)))
  }

  const removeEvent = (id: string): void => {
    setLocalEvents(localEvents.filter((event) => event.id !== id))
    setSelection(null)
  }

  const selectedId = selection !== null ? selection.id : null

  return (
    <PageShell title="Calendar" fullBleed>
      <div className="cal-page">
        <aside className="cal-sidebar">
          <MiniMonth anchor={anchor} onPickDay={setAnchor} />
          <CalendarList enabled={enabled} onToggle={toggleCalendar} />
          <button type="button" className="cal-account-add">
            <Plus size={14} />
            Add calendar account
          </button>
        </aside>

        <div className="cal-main">
          <div className="cal-toolbar">
            <h1 className="cal-toolbar-title">{monthTitle(anchor)}</h1>
            <span className="cal-toolbar-spacer" />
            <div className="cal-segment" role="tablist" aria-label="Calendar view">
              {VIEWS.map((option) => (
                <button
                  key={option.view}
                  type="button"
                  role="tab"
                  aria-selected={view === option.view}
                  className={`cal-segment-btn${view === option.view ? ' is-active' : ''}`}
                  onClick={() => setView(option.view)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setAnchor(TODAY_ISO)}>
              Today
            </Button>
            <div className="cal-toolbar-nav">
              <button
                type="button"
                className="cal-chev"
                onClick={() => step(-1)}
                aria-label="Previous"
              >
                <ChevronLeft size={16} />
              </button>
              <button type="button" className="cal-chev" onClick={() => step(1)} aria-label="Next">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {view === 'month' ? (
            <MonthGrid
              anchor={anchor}
              events={visibleEvents}
              selectedId={selectedId}
              onSelectEvent={(id) => setSelection({ kind: 'event', id })}
              onOpenDay={(iso) => {
                setAnchor(iso)
                setView('day')
              }}
            />
          ) : (
            <WeekGrid
              days={gridDays}
              events={visibleEvents}
              allDayItems={allDayItems}
              selectedId={selectedId}
              onSelectEvent={(id) => setSelection({ kind: 'event', id })}
              onSelectAllDay={(id) => setSelection({ kind: 'oa', id })}
              onCreateBlock={createBlock}
            />
          )}
        </div>

        {selection !== null ? (
          <EventPanel
            selection={selection}
            events={localEvents}
            onClose={() => setSelection(null)}
            onRename={renameEvent}
            onRemove={removeEvent}
          />
        ) : null}
      </div>
    </PageShell>
  )
}
