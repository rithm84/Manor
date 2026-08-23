import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '../../data/mock'
import { EventDetailDialog } from './EventDetailDialog'

const EVENT: CalendarEvent = {
  id: 'event-one',
  title: 'Office hours',
  calendarId: 'ucla',
  date: '2026-08-22',
  start: '14:00',
  end: '15:00',
  scratch: false,
  faded: false,
  taskId: null,
  note: 'Bring questions.'
}

describe('calendar event detail dialog', () => {
  it('renders event content and actions with centered modal semantics', () => {
    const markup = renderToStaticMarkup(
      <EventDetailDialog
        selection={{ kind: 'event', id: EVENT.id }}
        events={[EVENT]}
        onClose={() => undefined}
        onRename={() => undefined}
        onRemove={() => undefined}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Event details for Office hours"')
    expect(markup).toContain('Office hours')
    expect(markup).toContain('Bring questions.')
    expect(markup).toContain('Remove')
    expect(markup).not.toContain('<aside')
    expect(markup).not.toContain('cal-panel')
  })
})
