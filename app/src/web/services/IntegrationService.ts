import { z } from 'zod'
import type { CalendarApi, CalendarAccount, GoogleCalendar, CalendarDayEvent } from '../../shared/calendar'
import type { XApi, XConnectionStatus } from '../../shared/xConnection'
import type { CourseFeedApi, CourseFeedCheck, CourseFeedStatus } from '../../shared/courseFeed'
import { ManorRequestError, type ManorGateway, type JsonObject } from '../ManorGateway'
import { calendarDays } from '../../shared/calendarDays'
import { accountToday } from './rows'

const accountSchema = z.object({ id: z.string(), email: z.email(), connectedAt: z.string() })
const calendarSchema = z.object({ id: z.string(), accountId: z.string(), name: z.string(), colorId: z.string().nullable(), enabled: z.boolean() })
const storedEventSchema = z.object({ id: z.string(), account_id: z.string(), calendar_id: z.string(), title: z.string(), starts_at: z.string().nullable(), ends_at: z.string().nullable(), start_date: z.string().nullable(), end_date: z.string().nullable(), all_day: z.boolean() })

/** Calls one connection function (`integrations` or `course-feed`) with the session and unwraps its error envelope. */
export class IntegrationService {
  private readonly gateway: ManorGateway
  private readonly functionName: string
  constructor(gateway: ManorGateway, functionName: string) { this.gateway = gateway; this.functionName = functionName }
  async request<T>(action: string, input: JsonObject, schema: z.ZodType<T>): Promise<T> {
    const { data, error } = await this.gateway.client.functions.invoke(this.functionName, { body: { action, ...input } })
    if (error) {
      if ('context' in error && error.context instanceof Response) {
        const failure = z.object({ error: z.string() }).parse(await error.context.json())
        throw new Error(failure.error)
      }
      throw new Error(`Integration request failed: ${error.message}`)
    }
    return schema.parse(data)
  }

  async connect(provider: 'google' | 'x'): Promise<void> {
    const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const challenge = btoa(String.fromCharCode(...hash)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const result = await this.request('oauth_start', { provider, codeChallenge: challenge }, z.object({ url: z.url(), state: z.string() }))
    sessionStorage.setItem(`manor-connection:${result.state}`, verifier)
    window.location.assign(result.url)
  }

  async completeConnection(code: string, state: string): Promise<void> {
    const verifier = sessionStorage.getItem(`manor-connection:${state}`)
    if (verifier === null) throw new Error('Complete the connection in the same browser tab where you started it.')
    await this.request('oauth_complete', { code, state, verifier }, z.object({ committed: z.literal(true) }))
    sessionStorage.removeItem(`manor-connection:${state}`)
  }
}

/** Calendar reads go straight to the owner-scoped tables; only OAuth and visibility changes need the integrations function. */
export class CalendarService implements CalendarApi {
  private readonly gateway: ManorGateway
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.gateway = gateway; this.integration = new IntegrationService(gateway, 'integrations') }
  connect(): Promise<void> { return this.integration.connect('google') }
  completeConnection(code: string, state: string): Promise<void> { return this.integration.completeConnection(code, state) }
  async accounts(): Promise<CalendarAccount[]> {
    return (await this.gateway.rows('calendar_accounts')).map((row) => accountSchema.parse({ id: row.id, email: row.email, connectedAt: row.connected_at }))
  }
  async calendars(): Promise<GoogleCalendar[]> {
    return (await this.gateway.rows('calendars')).map((row) => calendarSchema.parse({ id: row.id, accountId: row.account_id, name: row.name, colorId: row.color, enabled: row.enabled }))
  }
  eventsFor(dates: readonly string[]): Promise<CalendarDayEvent[]> {
    const ordered = [...dates].sort()
    if (ordered.length === 0 || ordered.length > 14) throw new RangeError('Calendar reads cover 1 to 14 days')
    return this.gateway.cached(['calendar_days', ordered.join(',')], () => this.readEvents(ordered))
  }

  private async readEvents(ordered: readonly string[]): Promise<CalendarDayEvent[]> {
    const [{ timezone }, calendars] = await Promise.all([accountToday(this.gateway), this.calendars()])
    const enabled = calendars.filter((calendar) => calendar.enabled)
    if (enabled.length === 0) return []
    const earliest = new Date(`${ordered[0]}T00:00:00Z`); earliest.setUTCDate(earliest.getUTCDate() - 1)
    const latest = new Date(`${ordered[ordered.length - 1]}T00:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 2)
    const { data, error } = await this.gateway.client.from('calendar_events').select('*').eq('user_id', this.gateway.accountId)
      .or(`and(all_day.eq.true,start_date.lte.${ordered[ordered.length - 1]},end_date.gt.${ordered[0]}),and(all_day.eq.false,starts_at.lt.${latest.toISOString()},ends_at.gt.${earliest.toISOString()})`)
    if (error) throw new ManorRequestError('Read calendar_events', error.code, error.message)
    const records = z.array(storedEventSchema).parse(data)
    if (records.length > 5000) throw new RangeError('This date range contains more than 5,000 events. Choose fewer dates.')
    return records.flatMap((event) => {
      const calendar = enabled.find((item) => item.id === event.calendar_id && item.accountId === event.account_id)
      return calendar === undefined ? [] : calendarDays(event, ordered, timezone, calendar.colorId)
    })
  }
  async setCalendarEnabled(calendarId: string, accountId: string, enabled: boolean): Promise<void> {
    await this.integration.request('calendar_visibility', { calendarId, accountId, enabled }, z.object({ committed: z.literal(true) }))
  }
  async disconnect(accountId: string): Promise<void> {
    await this.integration.request('calendar_disconnect', { accountId }, z.object({ committed: z.literal(true) }))
  }
}

export class XService implements XApi {
  private readonly gateway: ManorGateway
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.gateway = gateway; this.integration = new IntegrationService(gateway, 'integrations') }
  connect(): Promise<void> { return this.integration.connect('x') }
  completeConnection(code: string, state: string): Promise<void> { return this.integration.completeConnection(code, state) }
  async status(): Promise<XConnectionStatus> {
    const { data, error } = await this.gateway.client.rpc('manor_x_status')
    if (error) throw new ManorRequestError('manor_x_status', error.code, error.message)
    return z.object({ connected: z.boolean(), username: z.string().nullable(), connectedAt: z.string().nullable() }).parse(data)
  }
  async disconnect(): Promise<void> { await this.integration.request('x_disconnect', {}, z.object({ committed: z.literal(true) })) }
  ingestNow(): Promise<{ added: number }> { return this.integration.request('x_sync', {}, z.object({ added: z.number().int().nonnegative() })) }
}

const courseFeedStatusSchema = z.object({ connected: z.boolean(), host: z.string().nullable(), connectedAt: z.string().nullable(), lastCheckedAt: z.string().nullable(), lastItemCount: z.number().int().nullable(), lastError: z.string().nullable() })

export class CourseFeedService implements CourseFeedApi {
  private readonly gateway: ManorGateway
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.gateway = gateway; this.integration = new IntegrationService(gateway, 'course-feed') }
  async status(): Promise<CourseFeedStatus> {
    const { data, error } = await this.gateway.client.rpc('manor_course_feed_status')
    if (error) throw new ManorRequestError('manor_course_feed_status', error.code, error.message)
    return courseFeedStatusSchema.parse(data)
  }
  connect(url: string): Promise<{ host: string; count: number }> {
    return this.integration.request('connect', { url }, z.object({ connected: z.literal(true), host: z.string(), count: z.number().int().nonnegative() }))
  }
  async disconnect(): Promise<void> { await this.integration.request('disconnect', {}, z.object({ connected: z.literal(false) })) }
  check(): Promise<CourseFeedCheck> {
    return this.integration.request('events', {}, z.object({ from: z.string(), to: z.string(), total: z.number().int().nonnegative() }))
  }
}
