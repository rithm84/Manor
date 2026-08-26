/** Google Calendar connector: OAuth for a desktop client (loopback redirect),
    read-only calendar and event fetch with per-calendar syncToken incremental
    sync, and on-disk account storage. Electron-free so the dev bridge can
    serve it in plain browsers.

    Tokens persist as plain JSON in <storageDir>/gcal.json for v1; wrapping the
    file with Electron safeStorage is a hardening follow-up. Tokens are never
    logged. */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'

import type { CalendarAccount, CalendarDayEvent, GoogleCalendar } from '../shared/calendar'
import { envValueFrom } from './supabaseCore'

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const OAUTH_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.readonly'

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000
/** Renderer polls every ~60s; the service serves cached results for 45s so
    overlapping surfaces never hammer the API. */
const DAY_CACHE_TTL_MS = 45 * 1000
const FETCH_ATTEMPTS = 3

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GcalHttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'GcalHttpError'
    this.status = status
    this.body = body
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested, no network)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface DayWindow {
  start: Date
  end: Date
  timeMin: string
  timeMax: string
}

/** Local-midnight-to-local-midnight window for one YYYY-MM-DD day. */
export function dayWindowOf(date: string): DayWindow {
  if (!DATE_PATTERN.test(date)) {
    throw new TypeError(`Calendar day "${date}" is not a YYYY-MM-DD date`)
  }
  const [year, month, day] = date.split('-').map((part) => Number(part))
  const start = new Date(year, month - 1, day)
  const end = new Date(year, month - 1, day + 1)
  return { start, end, timeMin: start.toISOString(), timeMax: end.toISOString() }
}

/** True when the access token is at or past expiry, minus a safety skew. */
export function accessTokenExpired(expiresAt: string, nowMs: number, skewMs: number): boolean {
  const expiryMs = Date.parse(expiresAt)
  if (Number.isNaN(expiryMs)) return true
  return expiryMs - skewMs <= nowMs
}

/** Reads the email claim from a Google id_token. We received this token
    first-hand from Google's token endpoint over TLS in exchange for our own
    authorization code, so decoding the payload without signature verification
    is sound; signature checks defend against tokens presented by third
    parties, which this never is. */
export function emailFromIdToken(idToken: string): string {
  const segments = idToken.split('.')
  if (segments.length !== 3) {
    throw new Error('Google returned a malformed identity token')
  }
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('Google returned an unreadable identity token payload')
  }
  const email = (claims as { email?: unknown }).email
  if (typeof email !== 'string' || email === '') {
    throw new Error('Google identity token is missing the account email')
  }
  return email
}

export interface GcalEventItem {
  id: string
  status?: string
  summary?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

export interface EventSource {
  calendarId: string
  accountId: string
  color: string | null
}

function clockOf(instant: Date, window: DayWindow): string {
  if (instant.getTime() <= window.start.getTime()) return '00:00'
  if (instant.getTime() >= window.end.getTime()) return '24:00'
  const hours = String(instant.getHours()).padStart(2, '0')
  const minutes = String(instant.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Maps one Google event onto one local day; null when the event is cancelled
    or does not touch that day. Timed events are clamped into 00:00..24:00. */
export function dayEventOf(
  item: GcalEventItem,
  source: EventSource,
  date: string
): CalendarDayEvent | null {
  if (item.status === 'cancelled') return null
  const title = (item.summary ?? '').trim() === '' ? 'Untitled' : (item.summary as string).trim()
  const base = {
    id: `${source.accountId}/${source.calendarId}/${item.id}/${date}`,
    calendarId: source.calendarId,
    accountId: source.accountId,
    title,
    date,
    color: source.color
  }

  const startDate = item.start?.date
  const endDate = item.end?.date
  if (startDate !== undefined && endDate !== undefined) {
    // All-day: start inclusive, end exclusive, plain YYYY-MM-DD comparisons.
    if (date < startDate || date >= endDate) return null
    return { ...base, start: '00:00', end: '24:00', allDay: true }
  }

  const startStamp = item.start?.dateTime
  const endStamp = item.end?.dateTime
  if (startStamp === undefined || endStamp === undefined) return null
  const window = dayWindowOf(date)
  const startAt = new Date(startStamp)
  const endAt = new Date(endStamp)
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error(
      `Google event ${item.id} has unreadable times start=${startStamp} end=${endStamp}`
    )
  }
  if (endAt.getTime() <= window.start.getTime() || startAt.getTime() >= window.end.getTime()) {
    return null
  }
  const start = clockOf(startAt, window)
  const end = clockOf(endAt, window)
  if (start === end) return null
  return { ...base, start, end, allDay: false }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface StoredCalendar {
  id: string
  name: string
  color: string | null
  enabled: boolean
}

interface StoredAccount {
  id: string
  email: string
  connectedAt: string
  refreshToken: string
  accessToken: string
  accessTokenExpiresAt: string
  calendars: StoredCalendar[]
}

interface GcalStore {
  accounts: StoredAccount[]
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

async function fetchJson(url: string, init: RequestInit, label: string): Promise<unknown> {
  let lastError: Error = new Error(`${label} request never ran`)
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause))
      console.warn('Google Calendar request failed, retrying', { label, attempt, error: lastError.message })
      continue
    }
    if (response.ok) return response.json()
    const body = await response.text()
    const error = new GcalHttpError(
      `${label} failed with HTTP ${response.status}: ${body}`,
      response.status,
      body
    )
    if (response.status < 500) throw error
    lastError = error
    console.warn('Google Calendar request failed, retrying', { label, attempt, status: response.status })
  }
  throw lastError
}

interface TokenGrant {
  accessToken: string
  expiresAt: string
  refreshToken: string | null
  idToken: string | null
}

function tokenGrantOf(payload: unknown, label: string): TokenGrant {
  const record = payload as {
    access_token?: unknown
    expires_in?: unknown
    refresh_token?: unknown
    id_token?: unknown
  }
  if (typeof record.access_token !== 'string' || typeof record.expires_in !== 'number') {
    throw new Error(`${label} returned no usable access token`)
  }
  return {
    accessToken: record.access_token,
    expiresAt: new Date(Date.now() + record.expires_in * 1000).toISOString(),
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : null,
    idToken: typeof record.id_token === 'string' ? record.id_token : null
  }
}

// ---------------------------------------------------------------------------
// OAuth loopback plumbing
// ---------------------------------------------------------------------------

interface PendingConnect {
  server: Server
  state: string
  verifier: string
  redirectUri: string
  code: Promise<string>
  settle: { resolve: (code: string) => void; reject: (error: Error) => void }
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

const CONNECT_DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Manor</title>' +
  '<body style="font-family:system-ui;padding:48px;color:#1b191d">' +
  '<h1 style="font-size:20px">Connected</h1>' +
  '<p style="color:#6e6975">You can close this tab and return to Manor.</p>'

const CONNECT_FAILED_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Manor</title>' +
  '<body style="font-family:system-ui;padding:48px;color:#1b191d">' +
  '<h1 style="font-size:20px">That didn\'t go through</h1>' +
  '<p style="color:#6e6975">Return to Manor and try connecting again.</p>'

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface DayCacheEntry {
  fetchedAt: number
  syncToken: string | null
  items: Map<string, GcalEventItem>
}

export interface GcalServiceConfig {
  envRoot: string
  storageDir: string
}

export class GcalService {
  private readonly envRoot: string
  private readonly storePath: string
  private pending: PendingConnect | null = null
  private readonly dayCache = new Map<string, DayCacheEntry>()

  constructor(config: GcalServiceConfig) {
    this.envRoot = config.envRoot
    this.storePath = join(config.storageDir, 'gcal.json')
  }

  // -- storage --------------------------------------------------------------

  private readStore(): GcalStore {
    if (!existsSync(this.storePath)) return { accounts: [] }
    const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as GcalStore
    return { accounts: Array.isArray(raw.accounts) ? raw.accounts : [] }
  }

  private writeStore(store: GcalStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true })
    writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf8')
  }

  private accountOf(store: GcalStore, accountId: string): StoredAccount {
    const account = store.accounts.find((candidate) => candidate.id === accountId)
    if (account === undefined) {
      throw new Error(`No connected Google account matches "${accountId}"`)
    }
    return account
  }

  // -- credentials ----------------------------------------------------------

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = envValueFrom(this.envRoot, 'GOOGLE_CLIENT_ID')
    const clientSecret = envValueFrom(this.envRoot, 'GOOGLE_CLIENT_SECRET')
    if (clientId === null || clientSecret === null) {
      throw new Error(
        'Google Calendar is not set up yet. Add GOOGLE_CLIENT_ID and ' +
          'GOOGLE_CLIENT_SECRET to .env.local at the repository root, then try again.'
      )
    }
    return { clientId, clientSecret }
  }

  // -- connect flow ---------------------------------------------------------

  async beginConnect(): Promise<{ authorizeUrl: string }> {
    const { clientId } = this.credentials()
    this.abandonPendingConnect('A newer connection attempt replaced this one')

    const state = base64Url(randomBytes(16))
    const verifier = base64Url(randomBytes(32))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())

    let settle: PendingConnect['settle'] = { resolve: () => undefined, reject: () => undefined }
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })

    const server = createServer((request, response) => this.handleLoopback(request, response))
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', (error) => reject(error))
      // Port 0 binds an ephemeral port; Google accepts any loopback port for
      // desktop OAuth clients, so the redirect URI carries the actual port.
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('Loopback server started without a usable port'))
          return
        }
        resolve(address.port)
      })
    })

    const redirectUri = `http://127.0.0.1:${port}/`
    this.pending = { server, state, verifier, redirectUri, code, settle }

    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPE,
      access_type: 'offline',
      // consent forces a refresh token; select_account lets a second Google
      // account be added while the first stays signed in.
      prompt: 'consent select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
    return { authorizeUrl: `${AUTHORIZE_ENDPOINT}?${query.toString()}` }
  }

  private handleLoopback(request: IncomingMessage, response: ServerResponse): void {
    const pending = this.pending
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (pending === null || url.pathname !== '/') {
      response.writeHead(404).end()
      return
    }
    const state = url.searchParams.get('state')
    const problem = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (state !== pending.state || problem !== null || code === null) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      response.end(CONNECT_FAILED_PAGE)
      pending.settle.reject(
        problem === 'access_denied'
          ? new Error('Google sign-in was cancelled. Try again when you are ready.')
          : new Error(`Google sign-in did not finish (${problem ?? 'no code returned'}). Try again.`)
      )
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(CONNECT_DONE_PAGE)
    pending.settle.resolve(code)
  }

  private abandonPendingConnect(reason: string): void {
    if (this.pending === null) return
    this.pending.settle.reject(new Error(reason))
    this.pending.server.close()
    this.pending = null
  }

  async completeConnect(): Promise<CalendarAccount> {
    const pending = this.pending
    if (pending === null) {
      throw new Error('Start connecting from Manor first, then approve access in the browser.')
    }
    const { clientId, clientSecret } = this.credentials()

    let code: string
    try {
      let timer: ReturnType<typeof setTimeout> | null = null
      code = await Promise.race([
        pending.code,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('The Google sign-in window timed out. Try again.')),
            CONNECT_TIMEOUT_MS
          )
        })
      ]).finally(() => {
        if (timer !== null) clearTimeout(timer)
      })
    } finally {
      pending.server.close()
      if (this.pending === pending) this.pending = null
    }

    const payload = await fetchJson(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: pending.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: pending.verifier
        }).toString()
      },
      'Google token exchange'
    )
    const grant = tokenGrantOf(payload, 'Google token exchange')
    if (grant.refreshToken === null) {
      throw new Error('Google did not grant offline access. Disconnect the account in Google security settings and try again.')
    }
    if (grant.idToken === null) {
      throw new Error('Google token exchange returned no identity token')
    }
    const email = emailFromIdToken(grant.idToken)

    const store = this.readStore()
    const existing = store.accounts.find((candidate) => candidate.id === email)
    const account: StoredAccount = {
      id: email,
      email,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      refreshToken: grant.refreshToken,
      accessToken: grant.accessToken,
      accessTokenExpiresAt: grant.expiresAt,
      calendars: existing?.calendars ?? []
    }
    account.calendars = await this.fetchCalendarList(account)
    store.accounts = [...store.accounts.filter((candidate) => candidate.id !== email), account]
    this.writeStore(store)
    this.dropCachesFor(email)
    return { id: account.id, email: account.email, connectedAt: account.connectedAt }
  }

  // -- accounts and calendars ----------------------------------------------

  async accounts(): Promise<readonly CalendarAccount[]> {
    return this.readStore().accounts.map((account) => ({
      id: account.id,
      email: account.email,
      connectedAt: account.connectedAt
    }))
  }

  async calendars(): Promise<readonly GoogleCalendar[]> {
    const store = this.readStore()
    for (const account of store.accounts) {
      account.calendars = await this.fetchCalendarList(account)
    }
    this.writeStore(store)
    return store.accounts.flatMap((account) =>
      account.calendars.map((calendar) => ({
        id: calendar.id,
        accountId: account.id,
        name: calendar.name,
        colorId: calendar.color,
        enabled: calendar.enabled
      }))
    )
  }

  private async fetchCalendarList(account: StoredAccount): Promise<StoredCalendar[]> {
    const payload = await this.apiGet(account, '/users/me/calendarList', new URLSearchParams(), 'Google calendar list')
    const items = (payload as { items?: unknown }).items
    if (!Array.isArray(items)) {
      throw new Error('Google calendar list response had no items array')
    }
    const known = new Map(account.calendars.map((calendar) => [calendar.id, calendar]))
    return items.flatMap((entry: unknown): StoredCalendar[] => {
      const record = entry as {
        id?: unknown
        summary?: unknown
        summaryOverride?: unknown
        backgroundColor?: unknown
        selected?: unknown
        primary?: unknown
      }
      if (typeof record.id !== 'string') return []
      const name =
        typeof record.summaryOverride === 'string' && record.summaryOverride !== ''
          ? record.summaryOverride
          : typeof record.summary === 'string'
            ? record.summary
            : record.id
      return [
        {
          id: record.id,
          name,
          color: typeof record.backgroundColor === 'string' ? record.backgroundColor : null,
          // New calendars follow Google's own shown-in-UI flag.
          enabled: known.get(record.id)?.enabled ?? (record.selected === true || record.primary === true)
        }
      ]
    })
  }

  async setCalendarEnabled(calendarId: string, accountId: string, enabled: boolean): Promise<void> {
    const store = this.readStore()
    const account = this.accountOf(store, accountId)
    const calendar = account.calendars.find((candidate) => candidate.id === calendarId)
    if (calendar === undefined) {
      throw new Error(`Account ${accountId} has no calendar "${calendarId}"`)
    }
    calendar.enabled = enabled
    this.writeStore(store)
    this.dropCachesFor(accountId)
  }

  async disconnect(accountId: string): Promise<void> {
    const store = this.readStore()
    const account = this.accountOf(store, accountId)
    try {
      const response = await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: account.refreshToken }).toString()
      })
      if (!response.ok) {
        console.warn('Google token revoke was refused; disconnecting locally anyway', {
          accountId,
          status: response.status
        })
      }
    } catch (error) {
      console.warn('Google token revoke failed; disconnecting locally anyway', {
        accountId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    store.accounts = store.accounts.filter((candidate) => candidate.id !== accountId)
    this.writeStore(store)
    this.dropCachesFor(accountId)
  }

  // -- events ---------------------------------------------------------------

  async eventsFor(dates: readonly string[]): Promise<readonly CalendarDayEvent[]> {
    const store = this.readStore()
    const results: CalendarDayEvent[] = []
    for (const date of dates) {
      dayWindowOf(date)
      for (const account of store.accounts) {
        for (const calendar of account.calendars.filter((candidate) => candidate.enabled)) {
          results.push(...(await this.dayEventsFor(account, calendar, date)))
        }
      }
    }
    return results.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  }

  private async dayEventsFor(
    account: StoredAccount,
    calendar: StoredCalendar,
    date: string
  ): Promise<readonly CalendarDayEvent[]> {
    const key = `${account.id} ${calendar.id} ${date}`
    const cached = this.dayCache.get(key)
    const now = Date.now()
    if (cached !== undefined && now - cached.fetchedAt < DAY_CACHE_TTL_MS) {
      return this.mapCached(cached, account, calendar, date)
    }

    let entry: DayCacheEntry
    if (cached !== undefined && cached.syncToken !== null) {
      try {
        entry = await this.incrementalFetch(account, calendar, cached)
      } catch (error) {
        if (error instanceof GcalHttpError && error.status === 410) {
          // The syncToken aged out (410 GONE); refetch the full day window.
          entry = await this.fullFetch(account, calendar, date)
        } else {
          throw error
        }
      }
    } else {
      entry = await this.fullFetch(account, calendar, date)
    }
    this.dayCache.set(key, entry)
    return this.mapCached(entry, account, calendar, date)
  }

  private mapCached(
    entry: DayCacheEntry,
    account: StoredAccount,
    calendar: StoredCalendar,
    date: string
  ): readonly CalendarDayEvent[] {
    const source: EventSource = { calendarId: calendar.id, accountId: account.id, color: calendar.color }
    return [...entry.items.values()]
      .flatMap((item) => {
        const mapped = dayEventOf(item, source, date)
        return mapped === null ? [] : [mapped]
      })
      .sort((a, b) => a.start.localeCompare(b.start))
  }

  private async fullFetch(
    account: StoredAccount,
    calendar: StoredCalendar,
    date: string
  ): Promise<DayCacheEntry> {
    const window = dayWindowOf(date)
    // No orderBy: Google withholds nextSyncToken when orderBy is set, and the
    // incremental sync it enables is worth more than server-side ordering.
    // Results are sorted locally in mapCached.
    const params = new URLSearchParams({
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      singleEvents: 'true',
      maxResults: '250'
    })
    return this.collectEvents(account, calendar, params, new Map())
  }

  private async incrementalFetch(
    account: StoredAccount,
    calendar: StoredCalendar,
    cached: DayCacheEntry
  ): Promise<DayCacheEntry> {
    if (cached.syncToken === null) throw new Error('Incremental fetch requires a syncToken')
    const params = new URLSearchParams({ syncToken: cached.syncToken })
    return this.collectEvents(account, calendar, params, new Map(cached.items))
  }

  private async collectEvents(
    account: StoredAccount,
    calendar: StoredCalendar,
    baseParams: URLSearchParams,
    items: Map<string, GcalEventItem>
  ): Promise<DayCacheEntry> {
    let pageToken: string | null = null
    let syncToken: string | null = null
    do {
      const params = new URLSearchParams(baseParams)
      if (pageToken !== null) params.set('pageToken', pageToken)
      const payload = await this.apiGet(
        account,
        `/calendars/${encodeURIComponent(calendar.id)}/events`,
        params,
        'Google events fetch'
      )
      const page = payload as { items?: unknown; nextPageToken?: unknown; nextSyncToken?: unknown }
      for (const raw of Array.isArray(page.items) ? page.items : []) {
        const item = raw as GcalEventItem
        if (typeof item.id !== 'string') continue
        if (item.status === 'cancelled') {
          items.delete(item.id)
        } else {
          items.set(item.id, item)
        }
      }
      pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : null
      if (typeof page.nextSyncToken === 'string') syncToken = page.nextSyncToken
    } while (pageToken !== null)
    return { fetchedAt: Date.now(), syncToken, items }
  }

  // -- authorized requests --------------------------------------------------

  private async apiGet(
    account: StoredAccount,
    path: string,
    params: URLSearchParams,
    label: string
  ): Promise<unknown> {
    const search = params.toString()
    const query = search === '' ? '' : `?${search}`
    const url = `${CALENDAR_API}${path}${query}`
    await this.ensureFreshAccessToken(account, false)
    try {
      return await fetchJson(url, { headers: { authorization: `Bearer ${account.accessToken}` } }, label)
    } catch (error) {
      if (error instanceof GcalHttpError && error.status === 401) {
        // The token was revoked or expired early; refresh once and retry.
        await this.ensureFreshAccessToken(account, true)
        return fetchJson(url, { headers: { authorization: `Bearer ${account.accessToken}` } }, label)
      }
      throw error
    }
  }

  private async ensureFreshAccessToken(account: StoredAccount, force: boolean): Promise<void> {
    if (!force && !accessTokenExpired(account.accessTokenExpiresAt, Date.now(), TOKEN_EXPIRY_SKEW_MS)) {
      return
    }
    const { clientId, clientSecret } = this.credentials()
    const payload = await fetchJson(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: account.refreshToken,
          grant_type: 'refresh_token'
        }).toString()
      },
      'Google token refresh'
    )
    const grant = tokenGrantOf(payload, 'Google token refresh')
    account.accessToken = grant.accessToken
    account.accessTokenExpiresAt = grant.expiresAt
    if (grant.refreshToken !== null) account.refreshToken = grant.refreshToken
    const store = this.readStore()
    this.persistAccount(store, account)
  }

  private persistAccount(store: GcalStore, account: StoredAccount): void {
    const index = store.accounts.findIndex((candidate) => candidate.id === account.id)
    if (index === -1) return
    store.accounts[index] = account
    this.writeStore(store)
  }

  private dropCachesFor(accountId: string): void {
    for (const key of [...this.dayCache.keys()]) {
      if (key.startsWith(`${accountId} `)) this.dayCache.delete(key)
    }
  }
}
