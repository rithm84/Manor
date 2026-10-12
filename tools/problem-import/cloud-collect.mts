/** Collect catalog-linked problem facts in an authenticated cloud browser without exporting its credentials. */
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs, parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, errors, type Page } from 'playwright-core'
import { z } from 'zod'
import { factAdapter, factSchema, SourceAccessRequired, type Fact, type FactAdapter } from './cloudProblemFacts.ts'

type Json = z.infer<ReturnType<typeof z.json>>
const catalogSchema = z.object({ version: z.literal(1), sourceBase: z.url(), records: z.array(z.object({ href: z.string().min(1), sourceKind: z.enum(['exercise', 'curated']) })) })
const checkpointSchema = z.object({ version: z.literal(1), sourceBase: z.url(), records: z.array(factSchema) })
const sessionSchema = z.object({ id: z.uuid(), status: z.enum(['active', 'stopped']), cdpUrl: z.url(), liveUrl: z.url().nullable() })
type Session = z.infer<typeof sessionSchema>
const pageSchema = z.object({ props: z.object({ pageProps: z.object({ trpcState: z.object({ json: z.object({ queries: z.array(z.object({ queryKey: z.json(), state: z.object({ data: z.json() }) })) }) }) }) }) })

class HumanActionRequired extends Error {}

class BrowserUseClient {
  private readonly key: string

  constructor(key: string) { this.key = key }

  private async request<T>(path: string, method: 'GET' | 'POST' | 'PATCH', body: Json | null, schema: z.ZodType<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response: Response
      try {
        response = await fetch('https://api.browser-use.com/api/v4' + path, {
          method, headers: { 'X-Browser-Use-API-Key': this.key, 'Content-Type': 'application/json' },
          body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        if (method === 'POST' || attempt === 3) throw new Error(`Browser Use ${method} ${path} transport failed; a POST outcome may be uncertain`, { cause: error })
        console.warn(JSON.stringify({ operation: 'browser-use-retry', method, path, attempt, error: error instanceof Error ? error.message.replaceAll(this.key, '[redacted]') : 'Transport failed' }))
        await delay(1000 * 2 ** (attempt - 1))
        continue
      }
      if (response.ok) return schema.parse(await response.json())
      const detail = (await response.text()).replaceAll(this.key, '[redacted]').slice(0, 2000)
      const retryable = response.status === 429 || response.status === 529 || (method !== 'POST' && response.status >= 500)
      if (!retryable || attempt === 3) throw new Error(`Browser Use ${method} ${path} returned HTTP ${response.status}: ${detail}`)
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 2 ** attempt
      if (seconds > 60) throw new Error(`Browser Use ${method} ${path} requires a ${seconds}-second cooldown: ${detail}`)
      console.warn(JSON.stringify({ operation: 'browser-use-retry', method, path, status: response.status, attempt, seconds, detail }))
      await delay(seconds * 1000)
    }
    throw new Error('Browser Use retry loop exhausted without a response')
  }

  async verifyProfile(profileId: string): Promise<void> {
    const profile = await this.request('/profiles/' + encodeURIComponent(profileId), 'GET', null, z.object({ id: z.uuid() }))
    if (profile.id !== profileId) throw new Error('Browser Use returned a different profile ID')
  }

  async create(profileId: string, marker: string): Promise<Session> {
    return this.request('/browsers', 'POST', { profileId, proxyCountryCode: 'us', timeout: 30, solveCaptchas: false, enableRecording: false, metadata: { task: 'manor-catalog-collection', marker } }, sessionSchema)
  }

  async resume(id: string): Promise<Session> {
    const session = await this.request('/browsers/' + id, 'GET', null, sessionSchema)
    if (session.id !== id || session.status !== 'active') throw new Error(`Browser Use session ${id} is no longer active`)
    return session
  }

  async stop(id: string): Promise<void> {
    const result = await this.request('/browsers/' + id, 'PATCH', { action: 'stop' }, z.object({ id: z.uuid(), status: z.enum(['active', 'stopped']) }))
    if (result.id !== id || result.status !== 'stopped') throw new Error(`Browser Use did not confirm browser ${id} stopped`)
  }
}

class FactCheckpoint {
  private readonly path: string
  private readonly sourceBase: string
  private readonly marker: string

  constructor(path: string, sourceBase: string, marker: string) { this.path = path; this.sourceBase = sourceBase; this.marker = marker }

  async save(records: Fact[]): Promise<void> {
    const temporary = this.path + '.' + this.marker + '.tmp'
    await writeFile(temporary, JSON.stringify({ version: 1, sourceBase: this.sourceBase, records }), { mode: 0o600 })
    await rename(temporary, this.path)
  }
}

async function waitForOrdinaryVerification(page: Page): Promise<boolean> {
  const title = await page.title()
  if (title !== 'Just a moment...' && !title.toLowerCase().includes('security verification')) return false
  try {
    await page.waitForFunction(() => document.title !== 'Just a moment...' && !document.title.toLowerCase().includes('security verification'), null, { timeout: 30_000 })
  } catch (error) {
    if (error instanceof errors.TimeoutError) throw new HumanActionRequired(`Source verification remains at ${new URL(page.url()).pathname}`, { cause: error })
    throw error
  }
  return true
}

async function collect(page: Page, sourceBase: string, href: string, queryPath: string, adapter: FactAdapter): Promise<Fact> {
  const target = new URL(href, sourceBase)
  if (target.origin !== new URL(sourceBase).origin) throw new Error(`Catalog link leaves the authorized source origin: ${href}`)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = attempt === 1 && page.url() === target.href ? null : await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const redirected = await waitForOrdinaryVerification(page)
    if (redirected || response === null || response.ok()) break
    const detail = (await response.text()).slice(0, 500)
    if (response.status() !== 429 || attempt === 3) throw new Error(`Source document ${href} returned HTTP ${response.status()}: ${detail}`)
    const retryAfter = response.headers()['retry-after']
    const seconds = retryAfter !== undefined && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 30 * attempt
    if (seconds > 60) throw new Error(`Source document ${href} requires a ${seconds}-second cooldown: ${detail}`)
    console.warn(JSON.stringify({ operation: 'source-rate-limit', href, attempt, seconds, status: response.status() }))
    await delay(seconds * 1000)
  }
  const script = await page.locator('script#__NEXT_DATA__').textContent()
  if (script === null) throw new Error(`Source document ${href} has no structured page data`)
  const document = pageSchema.parse(JSON.parse(script))
  const query = document.props.pageProps.trpcState.json.queries.find(item => Array.isArray(item.queryKey) && Array.isArray(item.queryKey[0]) && item.queryKey[0].join('.') === queryPath)
  if (query === undefined) throw new Error(`Source document ${href} has no ${queryPath} record`)
  const fact = adapter.parse(href, target, query.queryKey, query.state.data)
  if (fact.description === null || fact.description.trim() === '') console.warn(JSON.stringify({ operation: 'source-incomplete', problemId: fact.id, href, missing: ['statement'] }))
  return fact
}

async function main(): Promise<void> {
  const args = parseArgs({ options: { catalog: { type: 'string' }, checkpoint: { type: 'string' }, out: { type: 'string' }, env: { type: 'string' }, limit: { type: 'string' }, concurrency: { type: 'string' }, 'query-path': { type: 'string' }, 'session-file': { type: 'string' }, 'resume-session': { type: 'string' } }, strict: true })
  const options = z.object({ catalog: z.string(), checkpoint: z.string(), out: z.string(), env: z.string(), limit: z.coerce.number().int().min(1).max(1000), concurrency: z.coerce.number().int().min(1).max(8), 'query-path': z.string().min(1), 'session-file': z.string(), 'resume-session': z.string().optional() }).parse(args.values)
  const config = z.object({ BROWSER_USE_API_KEY: z.string().min(1), BROWSER_USE_PROFILE: z.uuid() }).parse(parseEnv(await readFile(resolve(options.env), 'utf8')))
  const catalog = catalogSchema.parse(JSON.parse(await readFile(resolve(options.catalog), 'utf8')))
  const prior = checkpointSchema.parse(JSON.parse(await readFile(resolve(options.checkpoint), 'utf8')))
  const adapter = factAdapter(options['query-path'])
  if (prior.sourceBase !== catalog.sourceBase) throw new Error('Catalog and checkpoint have different source origins')
  const facts = new Map(prior.records.map(record => [record.href, record]))
  if (facts.size !== prior.records.length) throw new Error('The checkpoint contains duplicate catalog links')
  const entries = catalog.records.filter(record => record.sourceKind === adapter.sourceKind && !facts.has(record.href)).slice(0, options.limit)
  if (entries.length === 0) { console.log(JSON.stringify({ operation: 'collection-complete', remaining: 0, total: facts.size })); return }
  const marker = randomUUID()
  const provider = new BrowserUseClient(config.BROWSER_USE_API_KEY)
  await provider.verifyProfile(config.BROWSER_USE_PROFILE)
  const previous = options['resume-session'] === undefined ? null : sessionSchema.parse(JSON.parse(await readFile(resolve(options['resume-session']), 'utf8')))
  const session = previous === null ? await provider.create(config.BROWSER_USE_PROFILE, marker) : await provider.resume(previous.id)
  const checkpoint = new FactCheckpoint(resolve(options.out), catalog.sourceBase, marker)
  const started = Date.now()
  let preserve = false
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
  try {
    if (previous === null) await writeFile(resolve(options['session-file']), JSON.stringify(session), { mode: 0o600, flag: 'wx' })
    browser = await chromium.connectOverCDP(session.cdpUrl)
    const context = browser.contexts()[0]
    if (context === undefined) throw new Error('Browser Use has no persistent profile context')
    const existing = context.pages().filter(page => page.url().startsWith(catalog.sourceBase))
    await Promise.all(existing.map(waitForOrdinaryVerification))
    const pages: Page[] = existing.slice(0, options.concurrency)
    while (pages.length < options.concurrency) pages.push(await context.newPage())
    console.log(JSON.stringify({ operation: 'collection-started', sessionId: session.id, planned: entries.length, concurrency: pages.length }))
    const first = await collect(pages[0], catalog.sourceBase, entries[0].href, options['query-path'], adapter)
    facts.set(first.href, first)
    await checkpoint.save([...facts.values()])
    for (let offset = 1; offset < entries.length; offset += pages.length) {
      const results = await Promise.allSettled(entries.slice(offset, offset + pages.length).map((entry, index) => collect(pages[index], catalog.sourceBase, entry.href, options['query-path'], adapter)))
      for (const result of results) if (result.status === 'fulfilled') facts.set(result.value.href, result.value)
      await checkpoint.save([...facts.values()])
      if (offset % (pages.length * 10) === 1 || offset + pages.length >= entries.length) console.log(JSON.stringify({ operation: 'collection-progress', collected: facts.size - prior.records.length, total: facts.size, elapsedMs: Date.now() - started }))
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        const index = results.indexOf(failure)
        preserve = failure.reason instanceof HumanActionRequired || failure.reason instanceof SourceAccessRequired
        console.error(JSON.stringify({ operation: 'collection-failed', sessionId: session.id, reason: failure.reason instanceof Error ? failure.reason.message : String(failure.reason) }))
        try { await pages[index].screenshot({ path: resolve(options['session-file']) + '.png', timeout: 5000, animations: 'disabled' }) }
        catch (error) { console.warn(JSON.stringify({ operation: 'collection-screenshot-failed', sessionId: session.id, reason: error instanceof Error ? error.message : String(error) })) }
        if (preserve) console.error(JSON.stringify({ operation: 'collection-needs-human', sessionId: session.id, liveUrl: session.liveUrl, screenshot: resolve(options['session-file']) + '.png' }))
        throw failure.reason
      }
    }
  } catch (error) {
    if (error instanceof HumanActionRequired || error instanceof SourceAccessRequired) {
      preserve = true
      console.error(JSON.stringify({ operation: 'collection-paused', sessionId: session.id, liveUrl: session.liveUrl, reason: error.message }))
    }
    throw error
  } finally {
    try { if (browser !== null) await browser.close() }
    finally { if (!preserve) await provider.stop(session.id) }
  }
  console.log(JSON.stringify({ operation: 'collection-complete', collected: entries.length, total: facts.size, elapsedMs: Date.now() - started, sessionStopped: true }))
}

await main()
