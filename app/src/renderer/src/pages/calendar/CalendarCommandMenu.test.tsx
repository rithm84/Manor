import { describe, expect, it } from 'vitest'

import { filterCalendarCommands } from './CalendarCommandMenu'
import type { CalendarCommand } from './CalendarCommandMenu'

const COMMANDS: readonly CalendarCommand[] = [
  { id: 'new', label: 'New event', group: 'Actions', icon: null, keys: ['C'], run: () => undefined },
  { id: 'hide', label: 'Hide Personal', group: 'Calendars', icon: null, keys: null, run: () => undefined }
]

describe('CalendarCommandMenu', () => {
  it('searches both command labels and groups', () => {
    expect(filterCalendarCommands(COMMANDS, 'personal').map((command) => command.id)).toEqual(['hide'])
    expect(filterCalendarCommands(COMMANDS, 'actions').map((command) => command.id)).toEqual(['new'])
  })
})
