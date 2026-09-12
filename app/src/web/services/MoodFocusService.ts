import { parseMoodFocusEntry, parseMoodMutation, parseFocusMutation, parseMoodFocusNoteMutation, parseMoodFocusHistoryMutation } from '../../shared/moodFocus'
import type { MoodFocusApi, MoodFocusState, MoodMutation, FocusMutation, MoodFocusNoteMutation, MoodFocusHistoryMutation } from '../../shared/moodFocus'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { accountToday, camelRow, rowRevision } from './rows'

export class MoodFocusService implements MoodFocusApi {
  private readonly gateway: ManorGateway
  private snapshot: readonly JsonObject[] | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(gateway: ManorGateway) { this.gateway = gateway }

  /** Runs saves one at a time so each one sends the revision committed by the one before it. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }
  private applyCommitted(date: string, record: JsonObject | null | undefined): void {
    if (!record) throw new Error('The daily record was not returned after saving')
    this.snapshot = [...(this.snapshot ?? []).filter((candidate) => candidate.date !== date), record]
  }

  async load(): Promise<MoodFocusState> {
    const [rows, { today }] = await Promise.all([this.gateway.rows('mood_focus_entries'), accountToday(this.gateway)])
    const entries = rows.map((row) => parseMoodFocusEntry(camelRow(row)))
    this.snapshot = rows
    return { today, entries }
  }

  private save(date: string, fields: JsonObject): Promise<MoodFocusState> {
    return this.serialize(async () => {
      if (this.snapshot === null) throw new Error('Load mood and focus before saving a rating')
      const row = this.snapshot.find((candidate) => candidate.date === date)
      const receipt = await this.gateway.command('commit_debrief', { date, expected_revision: row === undefined ? 0 : rowRevision(row), ...fields }, crypto.randomUUID())
      this.applyCommitted(date, receipt.record)
      return this.load()
    })
  }

  setMood(mutation: MoodMutation): Promise<MoodFocusState> {
    const { date, mood } = parseMoodMutation(mutation)
    return this.save(date, { mood })
  }
  setFocus(mutation: FocusMutation): Promise<MoodFocusState> {
    const { date, focus } = parseFocusMutation(mutation)
    return this.save(date, { focus })
  }
  setNote(mutation: MoodFocusNoteMutation): Promise<MoodFocusState> {
    const { date, note } = parseMoodFocusNoteMutation(mutation)
    return this.save(date, { note })
  }
  setRatings(mutation: MoodFocusHistoryMutation): Promise<MoodFocusState> {
    const { date, mood, focus, expectedUpdatedAt } = parseMoodFocusHistoryMutation(mutation)
    this.requireHistoryBaseline(date, expectedUpdatedAt)
    return this.save(date, { mood, focus })
  }
  correctHistory(mutation: MoodFocusHistoryMutation): Promise<MoodFocusState> {
    const fields = parseMoodFocusHistoryMutation(mutation)
    return this.serialize(async () => {
      if (this.snapshot === null) throw new Error('Load mood and focus before correcting history')
      this.requireHistoryBaseline(fields.date, fields.expectedUpdatedAt)
      const row = this.snapshot.find((candidate) => candidate.date === fields.date)
      const receipt = await this.gateway.command('correct_mood_focus_history', {
        date: fields.date,
        mood: fields.mood,
        focus: fields.focus,
        expected_revision: row === undefined ? 0 : rowRevision(row)
      }, crypto.randomUUID())
      this.applyCommitted(fields.date, receipt.record)
      return this.load()
    })
  }

  private requireHistoryBaseline(date: string, expectedUpdatedAt: string | null): void {
    if (this.snapshot === null) throw new Error('Load mood and focus before saving history')
    const row = this.snapshot.find((candidate) => candidate.date === date)
    const currentUpdatedAt = typeof row?.updated_at === 'string' ? row.updated_at : null
    if (currentUpdatedAt !== expectedUpdatedAt) {
      throw new Error('This daily record changed while you were editing. Close it, reopen it, and apply your changes again.')
    }
  }
}
