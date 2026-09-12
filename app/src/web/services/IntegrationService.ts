import { z } from 'zod'
import type { CalendarApi, CalendarAccount, GoogleCalendar, CalendarDayEvent } from '../../shared/calendar'
import type { XApi, XConnectionStatus } from '../../shared/xConnection'
import type { ManorGateway, JsonObject } from '../ManorGateway'

const accountSchema = z.object({ id: z.string(), email: z.email(), connectedAt: z.string() })
const calendarSchema = z.object({ id: z.string(), accountId: z.string(), name: z.string(), colorId: z.string().nullable(), enabled: z.boolean() })
const eventSchema = z.object({ id: z.string(), calendarId: z.string(), accountId: z.string(), title: z.string(), date: z.string(), start: z.string(), end: z.string(), allDay: z.boolean(), color: z.string().nullable() })

export class IntegrationService {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async request<T>(action: string, input: JsonObject, schema: z.ZodType<T>): Promise<T> {
    const { data, error } = await this.gateway.client.functions.invoke('integrations', { body: { action, ...input } })
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

export class CalendarService implements CalendarApi {
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.integration = new IntegrationService(gateway) }
  connect(): Promise<void> { return this.integration.connect('google') }
  completeConnection(code: string, state: string): Promise<void> { return this.integration.completeConnection(code, state) }
  accounts(): Promise<CalendarAccount[]> { return this.integration.request('calendar_accounts', {}, z.array(accountSchema)) }
  calendars(): Promise<GoogleCalendar[]> { return this.integration.request('calendars', {}, z.array(calendarSchema)) }
  eventsFor(dates: readonly string[]): Promise<CalendarDayEvent[]> { return this.integration.request('calendar_events', { dates: [...dates] }, z.array(eventSchema)) }
  async setCalendarEnabled(calendarId: string, accountId: string, enabled: boolean): Promise<void> {
    await this.integration.request('calendar_visibility', { calendarId, accountId, enabled }, z.object({ committed: z.literal(true) }))
  }
  async disconnect(accountId: string): Promise<void> {
    await this.integration.request('calendar_disconnect', { accountId }, z.object({ committed: z.literal(true) }))
  }
}

export class XService implements XApi {
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.integration = new IntegrationService(gateway) }
  connect(): Promise<void> { return this.integration.connect('x') }
  completeConnection(code: string, state: string): Promise<void> { return this.integration.completeConnection(code, state) }
  status(): Promise<XConnectionStatus> {
    return this.integration.request('x_status', {}, z.object({ connected: z.boolean(), username: z.string().nullable(), connectedAt: z.string().nullable() }))
  }
  async disconnect(): Promise<void> { await this.integration.request('x_disconnect', {}, z.object({ committed: z.literal(true) })) }
  ingestNow(): Promise<{ added: number }> { return this.integration.request('x_sync', {}, z.object({ added: z.number().int().nonnegative() })) }
}
