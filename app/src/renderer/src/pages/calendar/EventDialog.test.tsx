import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CalendarDefinition, CalendarEventRecord } from '../../../../shared/calendar'
import { EventDialog } from './EventDialog'

const CALENDAR: CalendarDefinition = {
  id: 'personal', name: 'Personal', color: '#3b684b', visible: true, readOnly: false,
  source: 'local', createdAt: '2026-08-22T10:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z'
}
const EVENT: CalendarEventRecord = {
  id: 'event-one', calendarId: CALENDAR.id, title: 'Studio review', eventType: 'event', allDay: false,
  startDate: '2026-08-22', endDate: '2026-08-22', startTime: '09:00', endTime: '10:00',
  timeZone: 'America/Los_Angeles', location: '', description: '', conferenceUrl: '', visibility: 'default',
  busyStatus: 'busy', reminders: [10], notePageIds: [], recurrence: { frequency: 'weekly', interval: 1, weekdays: [6], excludedDates: [], end: { type: 'after', count: 6 } },
  recurrenceParentId: null, recurrenceOriginalDate: null,
  createdAt: '2026-08-22T10:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z'
}

describe('Calendar event editor', () => {
  it('renders the floating event editor, recurrence controls, and destructive confirmation', () => {
    const markup = renderToStaticMarkup(
      <EventDialog open event={EVENT} calendars={[CALENDAR]} creating={false} confirmingDelete occurrenceDate="2026-08-22" occurrenceEvent={null} timeFormat="12h" notePages={[]}
        anchor={null}
        onClose={() => undefined} onSave={() => undefined} onDuplicate={() => undefined} onDelete={() => undefined} onOpenNote={() => undefined} />
    )
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Edit event"')
    expect(markup).toContain('cal-event-popover')
    expect(markup).toContain('This event')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('role="combobox"')
    expect(markup).not.toContain('type="time"')
    expect(markup).toContain('Delete this event?')
    expect(markup).not.toContain('sidepeek')
  })
})
