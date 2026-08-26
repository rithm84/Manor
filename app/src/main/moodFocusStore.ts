import { DatabaseSync } from 'node:sqlite'

import {
  moodFocusPreviousDate,
  parseFocusMutation,
  parseMoodFocusEntry,
  parseMoodFocusNoteMutation,
  parseMoodFocusSeed,
  parseMoodMutation
} from '../shared/moodFocus'
import type {
  FocusMutation,
  MoodFocusEntry,
  MoodFocusNoteMutation,
  MoodFocusSeed,
  MoodFocusState,
  MoodMutation
} from '../shared/moodFocus'

interface EntryRow {
  date: string
  mood: string | null
  focus: string | null
  note: string | null
  note_source: string | null
  created_at: string
  updated_at: string
}

interface MetadataRow {
  value: string
}

export class MoodFocusStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mood_focus_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mood_focus_entries (
        date TEXT PRIMARY KEY,
        mood TEXT CHECK (mood IN ('Great', 'Good', 'Neutral', 'Bad', 'Awful')),
        focus TEXT CHECK (focus IN ('Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting')),
        note TEXT,
        note_source TEXT CHECK (note_source IN ('manual', 'alfred')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (mood IS NOT NULL OR focus IS NOT NULL),
        CHECK ((note IS NULL AND note_source IS NULL) OR (note IS NOT NULL AND note_source IS NOT NULL))
      );
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: MoodFocusSeed): MoodFocusState {
    const seed = parseMoodFocusSeed(seedValue)
    const initialized = this.database
      .prepare("SELECT value FROM mood_focus_metadata WHERE key = 'initialized'")
      .get()
    if (initialized === undefined) {
      this.seed(seed)
    } else {
      this.database
        .prepare("UPDATE mood_focus_metadata SET value = ? WHERE key = 'today'")
        .run(seed.today)
    }
    return this.readState()
  }

  setMood(mutationValue: MoodMutation, nowIso: string): MoodFocusState {
    const mutation = parseMoodMutation(mutationValue)
    this.assertMutableDate(mutation.date)
    this.database
      .prepare(`
        INSERT INTO mood_focus_entries
          (date, mood, focus, note, note_source, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, updated_at = excluded.updated_at
      `)
      .run(mutation.date, mutation.mood, nowIso, nowIso)
    return this.readState()
  }

  setFocus(mutationValue: FocusMutation, nowIso: string): MoodFocusState {
    const mutation = parseFocusMutation(mutationValue)
    this.assertMutableDate(mutation.date)
    this.database
      .prepare(`
        INSERT INTO mood_focus_entries
          (date, mood, focus, note, note_source, created_at, updated_at)
        VALUES (?, NULL, ?, NULL, NULL, ?, ?)
        ON CONFLICT(date) DO UPDATE SET focus = excluded.focus, updated_at = excluded.updated_at
      `)
      .run(mutation.date, mutation.focus, nowIso, nowIso)
    return this.readState()
  }

  setNote(mutationValue: MoodFocusNoteMutation, nowIso: string): MoodFocusState {
    const mutation = parseMoodFocusNoteMutation(mutationValue)
    this.assertMutableDate(mutation.date)
    const existing = this.database
      .prepare('SELECT date FROM mood_focus_entries WHERE date = ?')
      .get(mutation.date)
    if (existing === undefined) {
      throw new Error(`Cannot save context for ${mutation.date}: log mood or focus first`)
    }
    this.database
      .prepare(
        'UPDATE mood_focus_entries SET note = ?, note_source = ?, updated_at = ? WHERE date = ?'
      )
      .run(mutation.note, mutation.source, nowIso, mutation.date)
    return this.readState()
  }

  /** Whether the store has ever been seeded or hydrated. */
  initialized(): boolean {
    return (
      this.database
        .prepare("SELECT value FROM mood_focus_metadata WHERE key = 'initialized'")
        .get() !== undefined
    )
  }

  /** Current persisted entries, for the sync engine's full-module push. */
  snapshot(): readonly MoodFocusEntry[] {
    return this.readState().entries
  }

  /** Replace every persisted entry with cloud state (sync pull). */
  replaceAll(entriesValue: readonly MoodFocusEntry[], fallbackToday: string): MoodFocusState {
    const seed = parseMoodFocusSeed({ today: fallbackToday, entries: entriesValue })
    this.transaction(() => {
      this.database.exec('DELETE FROM mood_focus_entries')
      const insert = this.database.prepare(`
        INSERT INTO mood_focus_entries
          (date, mood, focus, note, note_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      seed.entries.forEach((entry) =>
        insert.run(
          entry.date,
          entry.mood,
          entry.focus,
          entry.note,
          entry.noteSource,
          entry.createdAt,
          entry.updatedAt
        )
      )
      this.database
        .prepare(
          "INSERT OR REPLACE INTO mood_focus_metadata (key, value) VALUES ('initialized', ?)"
        )
        .run(new Date().toISOString())
      this.database
        .prepare("INSERT OR IGNORE INTO mood_focus_metadata (key, value) VALUES ('today', ?)")
        .run(seed.today)
    })
    return this.readState()
  }

  private seed(seed: MoodFocusSeed): void {
    this.transaction(() => {
      const insert = this.database.prepare(`
        INSERT INTO mood_focus_entries
          (date, mood, focus, note, note_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      seed.entries.forEach((entry) =>
        insert.run(
          entry.date,
          entry.mood,
          entry.focus,
          entry.note,
          entry.noteSource,
          entry.createdAt,
          entry.updatedAt
        )
      )
      const initializedAt = new Date().toISOString()
      this.database
        .prepare("INSERT INTO mood_focus_metadata (key, value) VALUES ('initialized', ?)")
        .run(initializedAt)
      this.database
        .prepare("INSERT INTO mood_focus_metadata (key, value) VALUES ('today', ?)")
        .run(seed.today)
    })
  }

  private assertMutableDate(date: string): void {
    const today = this.readToday()
    const yesterday = moodFocusPreviousDate(today)
    if (date !== today && date !== yesterday) {
      throw new RangeError(`Mood and focus can only be changed for ${today} or ${yesterday}`)
    }
  }

  private readToday(): string {
    const row = this.database
      .prepare("SELECT value FROM mood_focus_metadata WHERE key = 'today'")
      .get() as MetadataRow | undefined
    if (row === undefined) {
      throw new Error('Mood and focus store is missing its today metadata')
    }
    return row.value
  }

  private readState(): MoodFocusState {
    const rows = this.database
      .prepare(
        'SELECT date, mood, focus, note, note_source, created_at, updated_at FROM mood_focus_entries ORDER BY date'
      )
      .all() as unknown as EntryRow[]
    const entries = rows.map(
      (row): MoodFocusEntry =>
        parseMoodFocusEntry({
          date: row.date,
          mood: row.mood,
          focus: row.focus,
          note: row.note,
          noteSource: row.note_source,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
    )
    return { today: this.readToday(), entries }
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
