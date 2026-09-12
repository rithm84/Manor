import { describe, expect, it } from 'vitest'

import type { ManorGateway, JsonObject } from '../ManorGateway'
import { HabitsService } from './HabitsService'

const HABIT = 'habit-1'
const TODAY = '2026-09-12'

/** Gateway stand-in with real asynchronous latency and server-side revision checks, so a stale cache is caught the way production catches it. */
class RevisionCheckingGateway {
  entry: JsonObject | null = null
  readonly commands: JsonObject[] = []
  readonly client = {
    rpc: async () => ({ data: { poolDays: [], today: TODAY, habits: [], lifecycle: [], entries: [], intents: [], freezes: [], grants: [], pools: [] }, error: null })
  }
  async rows(table: string): Promise<JsonObject[]> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return table === 'habit_entries' && this.entry !== null ? [this.entry] : []
  }
  async command(operation: string, input: JsonObject): Promise<{ command_id: string; operation: string; replayed: boolean; record: JsonObject | null }> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    this.commands.push(input)
    const current = this.entry === null ? 0 : (this.entry.revision as number)
    if (input.expected_revision !== current) throw new Error('PT409: Record changed. Reload and resolve the edit.')
    if (operation === 'clear_habit_entry') { const removed = this.entry; this.entry = null; return { command_id: 'c', operation, replayed: false, record: removed } }
    this.entry = { habit_id: HABIT, date: TODAY, value: input.value, revision: current + 1, user_id: 'u' }
    return { command_id: 'c', operation, replayed: false, record: this.entry }
  }
}

describe('HabitsService entry logging', () => {
  it('keeps rapid successive clicks in revision order instead of racing the reload', async () => {
    const gateway = new RevisionCheckingGateway()
    const service = new HabitsService(gateway as unknown as ManorGateway)
    await service.load()

    const first = service.setEntry({ habitId: HABIT, date: TODAY, value: 33 })
    const second = service.setEntry({ habitId: HABIT, date: TODAY, value: 66 })
    const third = service.setEntry({ habitId: HABIT, date: TODAY, value: 0 })
    await Promise.all([first, second, third])

    expect(gateway.commands.map((input) => input.expected_revision)).toEqual([0, 1, 2])
    expect(gateway.entry).toBeNull()
  })
})
