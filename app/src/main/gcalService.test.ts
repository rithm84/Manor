import { describe, expect, it } from 'vitest'

import { accessTokenExpired, dayEventOf, dayWindowOf, emailFromIdToken } from './gcalService'
import type { EventSource, GcalEventItem } from './gcalService'

const SOURCE: EventSource = { calendarId: 'cal-1', accountId: 'me@example.com', color: '#4576b5' }

function localStamp(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

describe('dayWindowOf', () => {
  it('spans local midnight to the next local midnight', () => {
    const window = dayWindowOf('2026-08-26')
    expect(window.start.getHours()).toBe(0)
    expect(window.start.getMinutes()).toBe(0)
    expect(window.start.getDate()).toBe(26)
    expect(window.end.getTime() - window.start.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(window.timeMin).toBe(window.start.toISOString())
    expect(window.timeMax).toBe(window.end.toISOString())
  })

  it('rolls over month boundaries', () => {
    const window = dayWindowOf('2026-08-31')
    expect(window.end.getMonth()).toBe(8)
    expect(window.end.getDate()).toBe(1)
  })

  it('rejects non-dates', () => {
    expect(() => dayWindowOf('today')).toThrow(TypeError)
    expect(() => dayWindowOf('2026-8-1')).toThrow(TypeError)
  })
})

describe('accessTokenExpired', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z')

  it('is fresh well before expiry', () => {
    expect(accessTokenExpired('2026-08-26T13:00:00.000Z', now, 60_000)).toBe(false)
  })

  it('expires inside the skew window', () => {
    expect(accessTokenExpired('2026-08-26T12:00:30.000Z', now, 60_000)).toBe(true)
  })

  it('treats unreadable stamps as expired', () => {
    expect(accessTokenExpired('not-a-date', now, 60_000)).toBe(true)
  })
})

describe('emailFromIdToken', () => {
  function tokenWith(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `header.${body}.signature`
  }

  it('reads the email claim', () => {
    expect(emailFromIdToken(tokenWith({ email: 'me@example.com' }))).toBe('me@example.com')
  })

  it('rejects tokens without an email claim', () => {
    expect(() => emailFromIdToken(tokenWith({ sub: '123' }))).toThrow('missing the account email')
  })

  it('rejects malformed tokens', () => {
    expect(() => emailFromIdToken('nonsense')).toThrow('malformed')
  })
})

describe('dayEventOf', () => {
  it('maps a timed event into local HH:MM', () => {
    const item: GcalEventItem = {
      id: 'evt-1',
      summary: 'Standup',
      start: { dateTime: localStamp('2026-08-26', '09:30') },
      end: { dateTime: localStamp('2026-08-26', '10:00') }
    }
    expect(dayEventOf(item, SOURCE, '2026-08-26')).toEqual({
      id: 'me@example.com/cal-1/evt-1/2026-08-26',
      calendarId: 'cal-1',
      accountId: 'me@example.com',
      title: 'Standup',
      date: '2026-08-26',
      start: '09:30',
      end: '10:00',
      allDay: false,
      color: '#4576b5'
    })
  })

  it('clamps events that spill past the day edges', () => {
    const item: GcalEventItem = {
      id: 'evt-overnight',
      summary: 'Red-eye',
      start: { dateTime: localStamp('2026-08-25', '22:00') },
      end: { dateTime: localStamp('2026-08-26', '05:30') }
    }
    const mapped = dayEventOf(item, SOURCE, '2026-08-26')
    expect(mapped?.start).toBe('00:00')
    expect(mapped?.end).toBe('05:30')
  })

  it('skips days the event never touches', () => {
    const item: GcalEventItem = {
      id: 'evt-far',
      summary: 'Elsewhere',
      start: { dateTime: localStamp('2026-08-20', '09:00') },
      end: { dateTime: localStamp('2026-08-20', '10:00') }
    }
    expect(dayEventOf(item, SOURCE, '2026-08-26')).toBeNull()
  })

  it('flags all-day events across their inclusive-exclusive range', () => {
    const item: GcalEventItem = {
      id: 'evt-allday',
      summary: 'Conference',
      start: { date: '2026-08-26' },
      end: { date: '2026-08-28' }
    }
    expect(dayEventOf(item, SOURCE, '2026-08-26')?.allDay).toBe(true)
    expect(dayEventOf(item, SOURCE, '2026-08-27')?.allDay).toBe(true)
    expect(dayEventOf(item, SOURCE, '2026-08-28')).toBeNull()
    expect(dayEventOf(item, SOURCE, '2026-08-25')).toBeNull()
  })

  it('drops cancelled events and titles the untitled', () => {
    expect(
      dayEventOf(
        {
          id: 'evt-gone',
          status: 'cancelled',
          start: { dateTime: localStamp('2026-08-26', '09:00') },
          end: { dateTime: localStamp('2026-08-26', '10:00') }
        },
        SOURCE,
        '2026-08-26'
      )
    ).toBeNull()
    const untitled = dayEventOf(
      {
        id: 'evt-untitled',
        start: { dateTime: localStamp('2026-08-26', '09:00') },
        end: { dateTime: localStamp('2026-08-26', '10:00') }
      },
      SOURCE,
      '2026-08-26'
    )
    expect(untitled?.title).toBe('Untitled')
  })
})
