import { DatabaseSync } from 'node:sqlite'

import {
  parseCalendarDefinition,
  parseCalendarEvent,
  parseCalendarId,
  parseCalendarOccurrenceMutation,
  parseCalendarSeed,
  parseCalendarSettings
} from '../shared/calendar'
import type {
  CalendarDefinition,
  CalendarEventRecord,
  CalendarOccurrenceMutation,
  CalendarSeed,
  CalendarSettings,
  CalendarState
} from '../shared/calendar'

interface PayloadRow {
  payload: string
}

interface MetadataRow {
  value: string
}

interface CountRow {
  count: number
}

export class CalendarStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS calendar_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_definitions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (calendar_id) REFERENCES calendar_definitions(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS calendar_events_calendar_time
        ON calendar_events(calendar_id, updated_at);
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: CalendarSeed): CalendarState {
    const seed = parseCalendarSeed(seedValue)
    this.transaction(() => {
      const initialized = this.database
        .prepare("SELECT value FROM calendar_metadata WHERE key = 'initialized'")
        .get()
      if (initialized === undefined) this.seed(seed)
      this.migrateSeededLectureSeries(seed)
    })
    return this.readState()
  }

  upsertCalendar(calendarValue: CalendarDefinition): CalendarState {
    const calendar = parseCalendarDefinition(calendarValue)
    this.database.prepare(`
      INSERT INTO calendar_definitions (id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(calendar.id, JSON.stringify(calendar), calendar.createdAt, calendar.updatedAt)
    return this.readState()
  }

  deleteCalendar(calendarIdValue: string): CalendarState {
    const calendarId = parseCalendarId(calendarIdValue, 'calendar id')
    const calendar = this.readCalendar(calendarId)
    if (calendar.readOnly) {
      throw new Error(`Cannot delete read-only calendar ${calendar.name}`)
    }
    this.transaction(() => {
      this.database.prepare('DELETE FROM calendar_events WHERE calendar_id = ?').run(calendarId)
      const result = this.database.prepare('DELETE FROM calendar_definitions WHERE id = ?').run(calendarId)
      if (result.changes !== 1) {
        throw new Error(`Cannot delete calendar ${calendarId}: no persisted calendar has that id`)
      }
    })
    return this.readState()
  }

  upsertEvent(eventValue: CalendarEventRecord): CalendarState {
    const event = parseCalendarEvent(eventValue)
    this.transaction(() => {
      this.reconcileSeriesEdit(event)
      this.writeEvent(event)
    })
    return this.readState()
  }

  replaceOccurrence(mutationValue: CalendarOccurrenceMutation): CalendarState {
    const mutation = parseCalendarOccurrenceMutation(mutationValue)
    this.transaction(() => {
      this.reconcileSeriesEdit(mutation.series)
      const existingException = this.readOccurrenceException(mutation.series.id, mutation.occurrenceDate)
      this.writeEvent(mutation.series)
      this.database.prepare("DELETE FROM calendar_events WHERE json_extract(payload, '$.recurrenceParentId') = ? AND json_extract(payload, '$.recurrenceOriginalDate') = ?").run(mutation.series.id, mutation.occurrenceDate)
      if (mutation.exception !== null) {
        this.writeEvent({
          ...mutation.exception,
          createdAt: existingException?.createdAt ?? mutation.exception.createdAt
        })
      }
    })
    return this.readState()
  }

  deleteEvent(eventIdValue: string): CalendarState {
    const eventId = parseCalendarId(eventIdValue, 'calendar event id')
    const existing = this.readEvent(eventId)
    const calendar = this.readCalendar(existing.calendarId)
    if (calendar.readOnly) {
      throw new Error(`Cannot delete events from read-only calendar ${calendar.name}`)
    }
    this.transaction(() => {
      if (existing.recurrence !== null) {
        this.database.prepare("DELETE FROM calendar_events WHERE json_extract(payload, '$.recurrenceParentId') = ?").run(eventId)
      }
      const result = this.database.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId)
      if (result.changes !== 1) {
        throw new Error(`Cannot delete calendar event ${eventId}: no persisted event has that id`)
      }
    })
    return this.readState()
  }

  updateSettings(settingsValue: CalendarSettings): CalendarState {
    const settings = parseCalendarSettings(settingsValue)
    this.database.prepare(`
      INSERT INTO calendar_metadata (key, value) VALUES ('settings', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(settings))
    return this.readState()
  }

  private seed(seed: CalendarSeed): void {
    const insertCalendar = this.database.prepare(`
      INSERT INTO calendar_definitions (id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `)
    seed.calendars.forEach((calendar) =>
      insertCalendar.run(calendar.id, JSON.stringify(calendar), calendar.createdAt, calendar.updatedAt)
    )
    const insertEvent = this.database.prepare(`
      INSERT INTO calendar_events (id, calendar_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    seed.events.forEach((event) =>
      insertEvent.run(event.id, event.calendarId, JSON.stringify(event), event.createdAt, event.updatedAt)
    )
    this.database
      .prepare("INSERT INTO calendar_metadata (key, value) VALUES ('initialized', ?)")
      .run(new Date().toISOString())
    this.database
      .prepare("INSERT INTO calendar_metadata (key, value) VALUES ('settings', ?)")
      .run(JSON.stringify(seed.settings))
  }

  private migrateSeededLectureSeries(seed: CalendarSeed): void {
    const migrated = this.database
      .prepare("SELECT value FROM calendar_metadata WHERE key = 'lecture_series_v2'")
      .get()
    if (migrated !== undefined) return
    const replacement = seed.events.find((event) => event.id === 'evt-calc-recurring')
    if (replacement !== undefined) {
      this.database.prepare(`
        DELETE FROM calendar_events
        WHERE id IN ('evt-calc-mon', 'evt-calc-wed', 'evt-calc-fri')
          AND json_extract(payload, '$.title') = 'Calc III lecture'
      `).run()
      this.database.prepare(`
        INSERT OR IGNORE INTO calendar_events (id, calendar_id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(replacement.id, replacement.calendarId, JSON.stringify(replacement), replacement.createdAt, replacement.updatedAt)
    }
    this.database.prepare("INSERT INTO calendar_metadata (key, value) VALUES ('lecture_series_v2', ?)").run(new Date().toISOString())
  }

  private readCalendar(calendarId: string): CalendarDefinition {
    const row = this.database
      .prepare('SELECT payload FROM calendar_definitions WHERE id = ?')
      .get(calendarId) as PayloadRow | undefined
    if (row === undefined) {
      throw new Error(`Calendar event references missing calendar ${calendarId}`)
    }
    return parseCalendarDefinition(JSON.parse(row.payload))
  }

  private readEvent(eventId: string): CalendarEventRecord {
    const row = this.database
      .prepare('SELECT payload FROM calendar_events WHERE id = ?')
      .get(eventId) as PayloadRow | undefined
    if (row === undefined) {
      throw new Error(`Cannot find calendar event ${eventId}`)
    }
    return parseCalendarEvent(JSON.parse(row.payload))
  }

  private findEvent(eventId: string): CalendarEventRecord | null {
    const row = this.database
      .prepare('SELECT payload FROM calendar_events WHERE id = ?')
      .get(eventId) as PayloadRow | undefined
    return row === undefined ? null : parseCalendarEvent(JSON.parse(row.payload))
  }

  private readOccurrenceException(parentId: string, occurrenceDate: string): CalendarEventRecord | null {
    const row = this.database
      .prepare("SELECT payload FROM calendar_events WHERE json_extract(payload, '$.recurrenceParentId') = ? AND json_extract(payload, '$.recurrenceOriginalDate') = ?")
      .get(parentId, occurrenceDate) as PayloadRow | undefined
    return row === undefined ? null : parseCalendarEvent(JSON.parse(row.payload))
  }

  private reconcileSeriesEdit(event: CalendarEventRecord): void {
    const existing = this.findEvent(event.id)
    if (existing?.recurrence === null || existing === null) return
    const exceptionCount = this.database
      .prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE json_extract(payload, '$.recurrenceParentId') = ?")
      .get(event.id) as unknown as CountRow
    if (event.recurrence !== null && event.calendarId !== existing.calendarId && exceptionCount.count > 0) {
      throw new Error(`Cannot move recurring series ${event.id} to another calendar until its edited occurrences are reset`)
    }
    if (event.recurrence === null) {
      this.database.prepare("DELETE FROM calendar_events WHERE json_extract(payload, '$.recurrenceParentId') = ?").run(event.id)
    }
  }

  private writeEvent(event: CalendarEventRecord): void {
    const calendar = this.readCalendar(event.calendarId)
    if (calendar.readOnly) {
      throw new Error(`Cannot change events on read-only calendar ${calendar.name}`)
    }
    if (event.recurrenceParentId !== null) {
      const parent = this.readEvent(event.recurrenceParentId)
      if (parent.recurrence === null) {
        throw new Error(`Cannot persist calendar occurrence ${event.id}: parent ${parent.id} does not recur`)
      }
      if (parent.calendarId !== event.calendarId) {
        throw new Error(`Cannot persist calendar occurrence ${event.id}: parent ${parent.id} uses another calendar`)
      }
    }
    const existing = this.findEvent(event.id)
    const persisted = existing === null ? event : { ...event, createdAt: existing.createdAt }
    this.database.prepare(`
      INSERT INTO calendar_events (id, calendar_id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        calendar_id = excluded.calendar_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(persisted.id, persisted.calendarId, JSON.stringify(persisted), persisted.createdAt, persisted.updatedAt)
  }

  private readState(): CalendarState {
    const calendars = this.database
      .prepare('SELECT payload FROM calendar_definitions ORDER BY created_at, id')
      .all() as unknown as PayloadRow[]
    const events = this.database
      .prepare('SELECT payload FROM calendar_events ORDER BY created_at, id')
      .all() as unknown as PayloadRow[]
    const settings = this.database
      .prepare("SELECT value FROM calendar_metadata WHERE key = 'settings'")
      .get() as MetadataRow | undefined
    if (settings === undefined) {
      throw new Error('Calendar store is missing its settings metadata')
    }
    return {
      calendars: calendars.map((row) => parseCalendarDefinition(JSON.parse(row.payload))),
      events: events.map((row) => parseCalendarEvent(JSON.parse(row.payload))),
      settings: parseCalendarSettings(JSON.parse(settings.value))
    }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      operation()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
