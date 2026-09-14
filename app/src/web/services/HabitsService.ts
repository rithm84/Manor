import { z } from 'zod'
import { parseHabitDefinition, parseHabitEntry, parseHabitLifecycleEvent, parseHabitFreezeIntent, parseHabitDraft, parseHabitLogMutation, parseHabitOrder, parseHabitFreezeMutation } from '../../shared/habits'
import type { HabitsApi, HabitsState, HabitDraft, HabitLogMutation, HabitStatusMutation, HabitFreezeMutation } from '../../shared/habits'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { derivedRead, rowRevision } from './rows'

const stateSchema = z.object({
  poolDays: z.array(z.object({ date: z.iso.date(), balance: z.number().int().nonnegative() })),
  today: z.iso.date(), habits: z.array(z.record(z.string(), z.json())), lifecycle: z.array(z.record(z.string(), z.json())),
  entries: z.array(z.record(z.string(), z.json())), intents: z.array(z.record(z.string(), z.json())),
  freezes: z.array(z.object({ habitId: z.string(), date: z.iso.date() })), grants: z.array(z.object({ date: z.iso.date() })),
  pools: z.array(z.object({ month: z.string(), capacity: z.number().int().nonnegative(), earned: z.number().int().nonnegative(), spent: z.number().int().nonnegative(), balance: z.number().int().nonnegative() }))
})

export class HabitsService implements HabitsApi {
  private readonly gateway: ManorGateway
  private entries: readonly JsonObject[] | null = null
  private habits: readonly JsonObject[] | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async load(): Promise<HabitsState> {
    const [history, habits, entries] = await Promise.all([derivedRead(this.gateway, 'manor_habits_state', 'Read habit history'), this.gateway.rows('habits'), this.gateway.rows('habit_entries')])
    const state = stateSchema.parse(history)
    const parsed: HabitsState = { ...state, habits: state.habits.map((row) => { const definition = parseHabitDefinition(row); const source = habits.find((habit) => habit.id === definition.id); if (source === undefined) throw new Error('Habit changed while loading. Reload the page.'); return { ...definition, revision: rowRevision(source) } }), entries: state.entries.map(parseHabitEntry), lifecycle: state.lifecycle.map(parseHabitLifecycleEvent), intents: state.intents.map(parseHabitFreezeIntent) }
    this.habits = habits; this.entries = entries
    return parsed
  }
  /** Runs mutations one at a time so each one sends the revisions committed by the one before it. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }
  private revision(habitId: string): number {
    if (this.habits === null) throw new Error('Load habits before editing')
    const row = this.habits.find((habit) => habit.id === habitId)
    if (row === undefined) throw new Error(`Habit ${habitId} is no longer available`)
    return rowRevision(row)
  }
  async createHabit(input: HabitDraft): Promise<HabitsState> {
    const draft = parseHabitDraft(input)
    return this.serialize(async () => {
      if (this.habits === null) throw new Error('Load habits before creating one')
      await this.gateway.command('create_habit', { id: crypto.randomUUID(), expected_revision: 0, name: draft.name, kind: draft.kind, target_label: draft.targetLabel, position: this.habits.length }, crypto.randomUUID())
      return this.load()
    })
  }
  async updateHabit(habitId: string, input: HabitDraft): Promise<HabitsState> {
    const draft = parseHabitDraft(input)
    return this.serialize(async () => {
      await this.gateway.command('update_habit', { id: habitId, expected_revision: z.number().int().positive().parse(input.expectedRevision), name: draft.name, kind: draft.kind, target_label: draft.targetLabel }, crypto.randomUUID())
      return this.load()
    })
  }
  async setEntry(input: HabitLogMutation): Promise<HabitsState> {
    const mutation = parseHabitLogMutation(input)
    return this.serialize(async () => {
      if (this.entries === null) throw new Error('Load habit entries before logging')
      const existing = this.entries.find((row) => row.habit_id === mutation.habitId && row.date === mutation.date)
      const receipt = await this.gateway.command(mutation.value === 0 ? 'clear_habit_entry' : 'log_habit', { id: mutation.habitId, date: mutation.date, value: mutation.value, expected_revision: existing === undefined ? 0 : rowRevision(existing) }, crypto.randomUUID())
      const others = this.entries.filter((row) => row !== existing)
      if (mutation.value === 0) this.entries = others
      else {
        if (!receipt.record) throw new Error('log_habit returned no committed entry')
        this.entries = [...others, receipt.record]
      }
      return this.load()
    })
  }
  async setStatus(mutation: HabitStatusMutation): Promise<HabitsState> {
    return this.serialize(async () => {
      await this.gateway.command('set_habit_status', { id: mutation.habitId, expected_revision: this.revision(mutation.habitId), status: mutation.status }, crypto.randomUUID())
      return this.load()
    })
  }
  async applyFreeze(input: HabitFreezeMutation): Promise<HabitsState> {
    const mutation = parseHabitFreezeMutation(input)
    return this.serialize(async () => {
      await this.gateway.command('apply_habit_freeze', { id: mutation.habitId, date: mutation.date, expected_revision: this.revision(mutation.habitId) }, crypto.randomUUID())
      return this.load()
    })
  }
  async clearFreeze(input: HabitFreezeMutation): Promise<HabitsState> {
    const mutation = parseHabitFreezeMutation(input)
    return this.serialize(async () => {
      await this.gateway.command('clear_habit_freeze', { id: mutation.habitId, date: mutation.date, expected_revision: this.revision(mutation.habitId) }, crypto.randomUUID())
      return this.load()
    })
  }
  async reorder(input: readonly string[]): Promise<HabitsState> {
    const habitIds = parseHabitOrder(input)
    return this.serialize(async () => {
      await this.gateway.command('reorder_habits', { habits: habitIds.map((id) => ({ id, expected_revision: this.revision(id) })) }, crypto.randomUUID())
      return this.load()
    })
  }
}
