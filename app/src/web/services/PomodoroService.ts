import { z } from 'zod'
import { activeSession, parsePomodoroLabel, parsePomodoroSession, parsePomodoroSettings, plannedSeconds, settingsPatchRow } from '../../shared/pomodoro'
import type { PomodoroApi, PomodoroSession, PomodoroSettings, PomodoroStartInput, PomodoroState } from '../../shared/pomodoro'
import type { JsonObject, ManorGateway } from '../ManorGateway'
import { accountToday, camelRow, rowRevision } from './rows'

/**
 * Sessions and timer preferences. The server holds the clock: every session carries its start instant,
 * paused time, and plan, so the countdown is derived on read and survives relaunches and other devices.
 */
export class PomodoroService implements PomodoroApi {
  private readonly gateway: ManorGateway
  private state: PomodoroState | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(gateway: ManorGateway) { this.gateway = gateway }

  /** Runs writes one at a time so each carries the revision committed by the one before it. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  async load(): Promise<PomodoroState> {
    const [rows, profiles, { today, timezone }] = await Promise.all([this.gateway.rows('pomodoro_sessions'), this.gateway.rows('profiles'), accountToday(this.gateway)])
    if (profiles.length !== 1) throw new Error('The account profile is missing. Complete account setup before opening Manor.')
    const settings = z.record(z.string(), z.json()).parse(profiles[0].settings ?? {})
    const sessions = rows.map((row) => parsePomodoroSession(camelRow(row))).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    this.state = { today, timezone, settings: parsePomodoroSettings(settings.pomodoro), settingsRevision: rowRevision(profiles[0]), sessions }
    return this.state
  }

  private loaded(): PomodoroState {
    if (this.state === null) throw new Error('Load Pomodoro before changing a session')
    return this.state
  }

  private session(id: string): PomodoroSession {
    const session = this.loaded().sessions.find((candidate) => candidate.id === id)
    if (session === undefined) throw new Error('This session is no longer available')
    return session
  }

  /** The input is built when the write runs, not when it is queued, so it carries the revision the write before it committed. */
  private command(operation: string, input: () => JsonObject): Promise<PomodoroState> {
    return this.serialize(async () => {
      await this.gateway.command(operation, input(), crypto.randomUUID())
      return this.load()
    })
  }

  start(input: PomodoroStartInput): Promise<PomodoroState> {
    const label = parsePomodoroLabel(input.label)
    return this.command('start_pomodoro_session', () => {
      const state = this.loaded()
      if (activeSession(state.sessions) !== null) throw new Error('A session is already in progress')
      return { id: crypto.randomUUID(), expected_revision: 0, kind: input.kind, planned_seconds: plannedSeconds(input.kind, state.settings), label }
    })
  }

  pause(id: string): Promise<PomodoroState> {
    return this.command('pause_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision }))
  }

  resume(id: string): Promise<PomodoroState> {
    return this.command('resume_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision }))
  }

  complete(id: string): Promise<PomodoroState> {
    return this.command('end_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision, outcome: 'completed' }))
  }

  stop(id: string): Promise<PomodoroState> {
    return this.command('end_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision, outcome: 'abandoned' }))
  }

  relabel(id: string, label: string | null): Promise<PomodoroState> {
    const parsed = parsePomodoroLabel(label)
    return this.command('update_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision, label: parsed }))
  }

  remove(id: string): Promise<PomodoroState> {
    return this.command('delete_pomodoro_session', () => ({ id, expected_revision: this.session(id).revision }))
  }

  saveSettings(patch: Partial<PomodoroSettings>): Promise<PomodoroState> {
    const row = settingsPatchRow(patch)
    return this.command('save_pomodoro_settings', () => ({ expected_revision: this.loaded().settingsRevision, settings: row }))
  }
}
