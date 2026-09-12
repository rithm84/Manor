import { describe, expect, it } from 'vitest'

import type { ManorGateway, JsonObject } from '../ManorGateway'
import { MoodFocusService } from './MoodFocusService'

const TODAY = '2026-09-12'

/** Gateway stand-in with real asynchronous latency and server-side revision checks on the single daily row. */
class RevisionCheckingGateway {
  row: JsonObject | null = null
  readonly commands: JsonObject[] = []
  readonly client = { rpc: async () => ({ data: { today: TODAY, timezone: 'America/Los_Angeles' }, error: null }) }
  async rows(table: string): Promise<JsonObject[]> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (table === 'profiles') return [{ timezone: 'America/Los_Angeles' }]
    return this.row === null ? [] : [this.row]
  }
  async command(operation: string, input: JsonObject): Promise<{ command_id: string; operation: string; replayed: boolean; record: JsonObject | null }> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    this.commands.push(input)
    const current = this.row === null ? 0 : (this.row.revision as number)
    if (input.expected_revision !== current) throw new Error('PT409: Record changed. Reload and resolve the edit.')
    this.row = { ...(this.row ?? { date: TODAY, mood: null, focus: null, note: null, note_source: null, created_at: '2026-09-12T20:00:00Z', updated_at: '2026-09-12T20:00:00Z' }), ...(input.mood !== undefined ? { mood: input.mood } : {}), ...(input.focus !== undefined ? { focus: input.focus } : {}), revision: current + 1 }
    return { command_id: 'c', operation, replayed: false, record: this.row }
  }
}

describe('MoodFocusService quick capture', () => {
  it('lets a mood tap and a focus tap on the same day land in revision order', async () => {
    const gateway = new RevisionCheckingGateway()
    const service = new MoodFocusService(gateway as unknown as ManorGateway)
    await service.load()

    const mood = service.setMood({ date: TODAY, mood: 'Good' })
    const focus = service.setFocus({ date: TODAY, focus: 'High' })
    await Promise.all([mood, focus])

    expect(gateway.commands.map((input) => input.expected_revision)).toEqual([0, 1])
    expect(gateway.row).toMatchObject({ mood: 'Good', focus: 'High', revision: 2 })
  })
})
