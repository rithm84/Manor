import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  addDays,
  monthKey,
  parseHabitDefinition,
  parseHabitDraft,
  parseHabitEntry,
  parseHabitLogMutation,
  parseHabitSeed,
  parseHabitStatusMutation,
  parseIsoDate,
  statusOn
} from '../shared/habits'
import type {
  HabitDefinition,
  HabitDraft,
  HabitFreezeGrant,
  HabitFreezeUsage,
  HabitLifecycleEvent,
  HabitLogMutation,
  HabitMonthPool,
  HabitsState,
  HabitStatusMutation,
  HabitSeed
} from '../shared/habits'

interface JsonRow {
  payload: string
}

interface ValueRow {
  value: string
}

interface DateRow {
  date: string
}

interface CountRow {
  count: number
}

interface MonthRow {
  month: string
  capacity: number
}

export class HabitStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS habits_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS habit_lifecycle (
        habit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'retired')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (habit_id, date),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS habit_entries (
        habit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        value INTEGER NOT NULL CHECK (value IN (25, 50, 75, 100)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (habit_id, date),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS habit_freeze_usage (
        habit_id TEXT NOT NULL,
        date TEXT NOT NULL,
        PRIMARY KEY (habit_id, date),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS habit_freeze_grants (
        date TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS habit_finalized_days (
        date TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS habit_month_pools (
        month TEXT PRIMARY KEY,
        capacity INTEGER NOT NULL CHECK (capacity >= 0)
      );
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: HabitSeed): HabitsState {
    const seed = parseHabitSeed(seedValue)
    this.transaction(() => {
      const initialized = this.database
        .prepare("SELECT value FROM habits_metadata WHERE key = 'initialized'")
        .get()
      if (initialized === undefined) {
        this.seed(seed)
      }
      const today = this.readToday()
      this.finalizeThrough(addDays(today, -1))
    })
    return this.readState()
  }

  createHabit(draftValue: HabitDraft, nowIso: string): HabitsState {
    const draft = parseHabitDraft(draftValue)
    this.transaction(() => {
      const today = this.readToday()
      const habit: HabitDefinition = {
        id: `habit-${randomUUID()}`,
        name: draft.name,
        kind: draft.kind,
        targetLabel: draft.targetLabel,
        createdOn: today,
        createdAt: nowIso
      }
      this.database
        .prepare('INSERT INTO habits (id, payload, updated_at) VALUES (?, ?, ?)')
        .run(habit.id, JSON.stringify(habit), nowIso)
      this.database
        .prepare(
          "INSERT INTO habit_lifecycle (habit_id, date, status, created_at) VALUES (?, ?, 'active', ?)"
        )
        .run(habit.id, today, nowIso)
      const month = monthKey(today)
      this.ensureMonthPool(month)
      this.database
        .prepare('UPDATE habit_month_pools SET capacity = capacity + 1 WHERE month = ?')
        .run(month)
    })
    return this.readState()
  }

  updateHabit(habitIdValue: string, draftValue: HabitDraft, nowIso: string): HabitsState {
    const habitId = this.parseHabitId(habitIdValue)
    const draft = parseHabitDraft(draftValue)
    this.transaction(() => {
      const previous = this.readHabit(habitId)
      const next: HabitDefinition = parseHabitDefinition({
        ...previous,
        name: draft.name,
        kind: draft.kind,
        targetLabel: draft.targetLabel
      })
      this.database
        .prepare('UPDATE habits SET payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(next), nowIso, habitId)
      if (previous.kind === 'quantized' && next.kind === 'binary') {
        const today = this.readToday()
        this.database
          .prepare('DELETE FROM habit_entries WHERE habit_id = ? AND date = ? AND value < 100')
          .run(habitId, today)
      }
    })
    return this.readState()
  }

  setEntry(mutationValue: HabitLogMutation, nowIso: string): HabitsState {
    const mutation = parseHabitLogMutation(mutationValue)
    this.transaction(() => {
      const today = this.readToday()
      const yesterday = addDays(today, -1)
      if (mutation.date !== today && mutation.date !== yesterday) {
        throw new RangeError(`Habit entries can only be changed for ${today} or ${yesterday}`)
      }
      const habit = this.readHabit(mutation.habitId)
      const lifecycle = this.readLifecycle()
      if (statusOn(habit.id, mutation.date, lifecycle) !== 'active') {
        throw new Error(`Cannot log ${habit.name} on ${mutation.date}: the habit was not active`)
      }
      if (habit.kind === 'binary' && mutation.value !== 0 && mutation.value !== 100) {
        throw new RangeError(`Cannot log ${mutation.value}% for binary habit ${habit.name}`)
      }
      if (mutation.value === 0) {
        this.database
          .prepare('DELETE FROM habit_entries WHERE habit_id = ? AND date = ?')
          .run(habit.id, mutation.date)
      } else {
        this.database
          .prepare(`
            INSERT INTO habit_entries (habit_id, date, value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(habit_id, date) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `)
          .run(habit.id, mutation.date, mutation.value, nowIso, nowIso)
      }
      if (mutation.date < today) {
        this.reconcileDay(mutation.date)
      }
    })
    return this.readState()
  }

  setStatus(mutationValue: HabitStatusMutation, nowIso: string): HabitsState {
    const mutation = parseHabitStatusMutation(mutationValue)
    this.transaction(() => {
      const today = this.readToday()
      if (mutation.date !== today) {
        throw new RangeError(`Habit lifecycle changes must take effect on ${today}`)
      }
      const habit = this.readHabit(mutation.habitId)
      const current = statusOn(habit.id, today, this.readLifecycle())
      if (current === 'retired') {
        throw new Error(`Cannot change ${habit.name}: retired habits keep their final state`)
      }
      if (mutation.status === current) {
        return
      }
      this.database
        .prepare(`
          INSERT INTO habit_lifecycle (habit_id, date, status, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(habit_id, date) DO UPDATE SET
            status = excluded.status,
            created_at = excluded.created_at
        `)
        .run(habit.id, today, mutation.status, nowIso)
    })
    return this.readState()
  }

  deleteHabit(habitIdValue: string): HabitsState {
    const habitId = this.parseHabitId(habitIdValue)
    this.transaction(() => {
      const habit = this.readHabit(habitId)
      const entryCount = this.count('habit_entries', habitId)
      const freezeCount = this.count('habit_freeze_usage', habitId)
      if (entryCount > 0 || freezeCount > 0 || habit.createdOn !== this.readToday()) {
        throw new Error(
          `Cannot permanently delete ${habit.name}: retire it to preserve its history`
        )
      }
      const result = this.database.prepare('DELETE FROM habits WHERE id = ?').run(habitId)
      if (result.changes !== 1) {
        throw new Error(`Cannot delete habit ${habitId}: no persisted habit has that id`)
      }
      const month = monthKey(this.readToday())
      this.database
        .prepare(
          'UPDATE habit_month_pools SET capacity = MAX(0, capacity - 1) WHERE month = ?'
        )
        .run(month)
    })
    return this.readState()
  }

  private seed(seed: HabitSeed): void {
    const nowIso = new Date().toISOString()
    const insertHabit = this.database.prepare(
      'INSERT INTO habits (id, payload, updated_at) VALUES (?, ?, ?)'
    )
    const insertLifecycle = this.database.prepare(
      'INSERT INTO habit_lifecycle (habit_id, date, status, created_at) VALUES (?, ?, ?, ?)'
    )
    const insertEntry = this.database.prepare(
      'INSERT INTO habit_entries (habit_id, date, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    const insertFreeze = this.database.prepare(
      'INSERT INTO habit_freeze_usage (habit_id, date) VALUES (?, ?)'
    )
    const insertGrant = this.database.prepare('INSERT INTO habit_freeze_grants (date) VALUES (?)')
    const insertFinalized = this.database.prepare('INSERT INTO habit_finalized_days (date) VALUES (?)')
    const insertPool = this.database.prepare(
      'INSERT INTO habit_month_pools (month, capacity) VALUES (?, ?)'
    )

    seed.habits.forEach((habit) => insertHabit.run(habit.id, JSON.stringify(habit), nowIso))
    seed.lifecycle.forEach((event) =>
      insertLifecycle.run(event.habitId, event.date, event.status, event.createdAt)
    )
    seed.entries.forEach((entry) =>
      insertEntry.run(entry.habitId, entry.date, entry.value, entry.createdAt, entry.updatedAt)
    )
    seed.freezes.forEach((freeze) => insertFreeze.run(freeze.habitId, freeze.date))
    seed.grants.forEach((grant) => insertGrant.run(grant.date))
    seed.finalizedDays.forEach((date) => insertFinalized.run(date))
    Object.entries(seed.monthCapacities).forEach(([month, capacity]) =>
      insertPool.run(month, capacity)
    )
    this.database
      .prepare("INSERT INTO habits_metadata (key, value) VALUES ('initialized', ?)")
      .run(nowIso)
    this.database
      .prepare("INSERT INTO habits_metadata (key, value) VALUES ('today', ?)")
      .run(seed.today)
  }

  private finalizeThrough(lastDate: string): void {
    const latest = this.database
      .prepare('SELECT date FROM habit_finalized_days ORDER BY date DESC LIMIT 1')
      .get() as DateRow | undefined
    const today = this.readToday()
    let date = latest === undefined ? addDays(today, -1) : addDays(latest.date, 1)
    while (date <= lastDate) {
      this.reconcileDay(date)
      date = addDays(date, 1)
    }
  }

  private reconcileDay(dateValue: string): void {
    const date = parseIsoDate(dateValue, 'finalized date')
    const month = monthKey(date)
    this.ensureMonthPool(month)
    this.database.prepare('DELETE FROM habit_freeze_usage WHERE date = ?').run(date)
    this.database.prepare('DELETE FROM habit_freeze_grants WHERE date = ?').run(date)

    const lifecycle = this.readLifecycle()
    const active = this.readHabits().filter((habit) => statusOn(habit.id, date, lifecycle) === 'active')
    const completedIds = new Set(
      (
        this.database
          .prepare('SELECT habit_id AS value FROM habit_entries WHERE date = ? AND value = 100')
          .all(date) as unknown as ValueRow[]
      ).map((row) => row.value)
    )
    const pool = this.readPool(month)
    if (active.length > 0 && active.every((habit) => completedIds.has(habit.id))) {
      if (pool.balance < pool.capacity) {
        this.database.prepare('INSERT INTO habit_freeze_grants (date) VALUES (?)').run(date)
      }
    } else {
      let balance = pool.balance
      active.forEach((habit) => {
        if (!completedIds.has(habit.id) && balance > 0) {
          this.database
            .prepare('INSERT INTO habit_freeze_usage (habit_id, date) VALUES (?, ?)')
            .run(habit.id, date)
          balance -= 1
        }
      })
    }
    this.database
      .prepare('INSERT OR IGNORE INTO habit_finalized_days (date) VALUES (?)')
      .run(date)
  }

  private ensureMonthPool(month: string): void {
    const existing = this.database
      .prepare('SELECT month FROM habit_month_pools WHERE month = ?')
      .get(month)
    if (existing !== undefined) {
      return
    }
    const firstDay = `${month}-01`
    const lifecycle = this.readLifecycle()
    const capacity = this.readHabits().filter(
      (habit) => statusOn(habit.id, firstDay, lifecycle) === 'active'
    ).length
    this.database
      .prepare('INSERT INTO habit_month_pools (month, capacity) VALUES (?, ?)')
      .run(month, capacity)
  }

  private readState(): HabitsState {
    const months = this.database
      .prepare('SELECT month, capacity FROM habit_month_pools ORDER BY month')
      .all() as unknown as MonthRow[]
    return {
      today: this.readToday(),
      habits: this.readHabits(),
      lifecycle: this.readLifecycle(),
      entries: (
        this.database
          .prepare('SELECT habit_id, date, value, created_at, updated_at FROM habit_entries ORDER BY date')
          .all() as unknown as Array<{
          habit_id: string
          date: string
          value: number
          created_at: string
          updated_at: string
        }>
      ).map((row) =>
        parseHabitEntry({
          habitId: row.habit_id,
          date: row.date,
          value: row.value,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
      ),
      freezes: (
        this.database
          .prepare('SELECT habit_id AS habitId, date FROM habit_freeze_usage ORDER BY date')
          .all() as unknown as HabitFreezeUsage[]
      ),
      grants: (
        this.database
          .prepare('SELECT date FROM habit_freeze_grants ORDER BY date')
          .all() as unknown as HabitFreezeGrant[]
      ),
      pools: months.map((row) => this.readPool(row.month))
    }
  }

  private readHabits(): readonly HabitDefinition[] {
    const rows = this.database
      .prepare('SELECT payload FROM habits ORDER BY rowid')
      .all() as unknown as JsonRow[]
    return rows.map((row) => parseHabitDefinition(JSON.parse(row.payload)))
  }

  private readHabit(habitId: string): HabitDefinition {
    const row = this.database.prepare('SELECT payload FROM habits WHERE id = ?').get(habitId) as
      | JsonRow
      | undefined
    if (row === undefined) {
      throw new Error(`No persisted habit has id ${habitId}`)
    }
    return parseHabitDefinition(JSON.parse(row.payload))
  }

  private readLifecycle(): readonly HabitLifecycleEvent[] {
    return (
      this.database
        .prepare(
          'SELECT habit_id, date, status, created_at FROM habit_lifecycle ORDER BY date, created_at'
        )
        .all() as unknown as Array<{
        habit_id: string
        date: string
        status: string
        created_at: string
      }>
    ).map((row) => ({
      habitId: row.habit_id,
      date: row.date,
      status: row.status as HabitLifecycleEvent['status'],
      createdAt: row.created_at
    }))
  }

  private readPool(month: string): HabitMonthPool {
    const capacityRow = this.database
      .prepare('SELECT capacity FROM habit_month_pools WHERE month = ?')
      .get(month) as { capacity: number } | undefined
    if (capacityRow === undefined) {
      throw new Error(`No freeze pool exists for ${month}`)
    }
    const earned = (
      this.database
        .prepare('SELECT COUNT(*) AS count FROM habit_freeze_grants WHERE substr(date, 1, 7) = ?')
        .get(month) as unknown as CountRow
    ).count
    const spent = (
      this.database
        .prepare('SELECT COUNT(*) AS count FROM habit_freeze_usage WHERE substr(date, 1, 7) = ?')
        .get(month) as unknown as CountRow
    ).count
    return {
      month,
      capacity: capacityRow.capacity,
      earned,
      spent,
      balance: Math.max(0, Math.min(capacityRow.capacity, earned - spent))
    }
  }

  private readToday(): string {
    const row = this.database
      .prepare("SELECT value FROM habits_metadata WHERE key = 'today'")
      .get() as ValueRow | undefined
    if (row === undefined) {
      throw new Error('Habit store has no configured current date')
    }
    return parseIsoDate(row.value, 'stored habit date')
  }

  private count(table: 'habit_entries' | 'habit_freeze_usage', habitId: string): number {
    return (
      this.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE habit_id = ?`).get(habitId) as unknown as CountRow
    ).count
  }

  private parseHabitId(value: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError('habit id must be a non-empty string')
    }
    return value.trim()
  }

  private transaction(action: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      action()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
