/** Google Calendar connection model. Read-only: connected calendars feed the
    Home Today timeline and nothing ever writes back (scratch blocks stay
    Manor-only). The main-process service lives in `main/gcalService.ts`; the
    orchestrator wires `CalendarApi` onto `window.manor.gcal`. */

/** A connected Google account. `id` is the Google account email. */
export interface CalendarAccount {
  id: string
  email: string
  connectedAt: string
}

export interface GoogleCalendar {
  id: string
  accountId: string
  name: string
  /** Hex swatch from the Google calendar list's backgroundColor. */
  colorId: string | null
  enabled: boolean
}

/** One event occurrence on one local day, mapped for the Today timeline. */
export interface CalendarDayEvent {
  id: string
  calendarId: string
  accountId: string
  title: string
  /** Local day, YYYY-MM-DD. */
  date: string
  /** Local HH:MM, clamped into the day (00:00 to 24:00). */
  start: string
  end: string
  allDay: boolean
  /** Hex passthrough from the source calendar; null when Google has none. */
  color: string | null
}

export interface CalendarApi {
  beginConnect: () => Promise<{ authorizeUrl: string }>
  completeConnect: () => Promise<CalendarAccount>
  accounts: () => Promise<readonly CalendarAccount[]>
  calendars: () => Promise<readonly GoogleCalendar[]>
  setCalendarEnabled: (calendarId: string, accountId: string, enabled: boolean) => Promise<void>
  disconnect: (accountId: string) => Promise<void>
  eventsFor: (dates: readonly string[]) => Promise<readonly CalendarDayEvent[]>
}

/** Window bridge shape until env.d.ts declares `gcal` on window.manor.
    Renderer files cast through this so the typing lives in one place. */
export interface CalendarBridgeHost {
  gcal: CalendarApi
}
