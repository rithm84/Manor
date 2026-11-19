/**
 * The rules behind alfred-proxy, kept apart from the request handling so they can be tested: which requests a
 * signed-in Manor account may send to Alfred's providers with Manor's keys, what each one costs, and when an account
 * has used its share.
 */

/** Models a Manor account may call through the proxy. */
export const anthropicModels = new Set(['claude-opus-5-5'])
export const routerModels = new Set(['gpt-6-luna'])
/** Beta headers passed through to Anthropic; anything else is dropped. */
export const anthropicBetas = new Set(['server-side-fallback-2026-07-01'])
export const anthropicVersion = '2026-10-21'
export const maxAnthropicTokens = 32_000
export const maxRouterTokens = 1_000
/** Screenshots make answer requests large; nothing Alfred sends comes near this. */
export const maxBodyBytes = 8 * 1024 * 1024

type Json = Record<string, unknown>
export type Checked = {ok: true, body: Json} | {ok: false, message: string}

/**
 * An Anthropic Messages request Alfred would send: an allowed model, a bounded reply, and only the app's own tools.
 * Server tools (web search, code execution, MCP connectors) run on Manor's bill without a limit, so they're refused.
 */
export function checkAnthropicBody(value: unknown): Checked {
  if (!isObject(value)) return {ok: false, message: 'The request body must be a JSON object.'}
  if (typeof value.model !== 'string' || !anthropicModels.has(value.model)) return {ok: false, message: 'That model is not available through Manor.'}
  if (typeof value.max_tokens !== 'number' || value.max_tokens < 1 || value.max_tokens > maxAnthropicTokens) {
    return {ok: false, message: `max_tokens must be between 1 and ${maxAnthropicTokens}.`}
  }
  if (!Array.isArray(value.messages)) return {ok: false, message: 'The request needs messages.'}
  if ('mcp_servers' in value || 'container' in value) return {ok: false, message: 'Server tools are not available through Manor.'}
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools)) return {ok: false, message: 'tools must be a list.'}
    for (const tool of value.tools) {
      if (!isObject(tool) || (tool.type !== undefined && tool.type !== 'custom') || typeof tool.name !== 'string') {
        return {ok: false, message: 'Only Alfred\'s own tools are available through Manor.'}
      }
    }
  }
  return {ok: true, body: value}
}

/** An OpenAI Responses request for the new-topic check: the router model, a short reply, no tools. */
export function checkRouterBody(value: unknown): Checked {
  if (!isObject(value)) return {ok: false, message: 'The request body must be a JSON object.'}
  if (typeof value.model !== 'string' || !routerModels.has(value.model)) return {ok: false, message: 'That model is not available through Manor.'}
  if ('tools' in value) return {ok: false, message: 'Tools are not available for this model through Manor.'}
  const cap = typeof value.max_output_tokens === 'number' ? Math.min(value.max_output_tokens, maxRouterTokens) : maxRouterTokens
  return {ok: true, body: {...value, max_output_tokens: cap}}
}

/** Token counts as Anthropic reports them; input excludes cache reads and writes, which are counted apart. */
export interface AnthropicUsage { input: number, output: number, cacheRead: number, cacheWrite: number, fast: boolean }

/**
 * Collects usage from a Messages response: `message_start` carries the input side and `message_delta` the running
 * output count, in a stream; a plain response carries both in `usage`.
 */
export class AnthropicMeter {
  usage: AnthropicUsage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, fast: false}
  private pending = ''

  /** Feeds streamed text; complete `data:` lines are read as they finish. */
  feed(chunk: string): void {
    this.pending += chunk
    let newline: number
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline).trim()
      this.pending = this.pending.slice(newline + 1)
      if (line.startsWith('data:')) this.event(line.slice(5).trim())
    }
  }

  /** A whole (non-streamed) response. */
  response(json: unknown): void {
    if (isObject(json) && isObject(json.usage)) this.take(json.usage)
  }

  private event(payload: string): void {
    let json: unknown
    try { json = JSON.parse(payload) } catch { return }
    if (!isObject(json)) return
    if (json.type === 'message_start' && isObject(json.message) && isObject(json.message.usage)) this.take(json.message.usage)
    if (json.type === 'message_delta' && isObject(json.usage)) this.take(json.usage)
  }

  private take(usage: Json): void {
    const n = (key: string) => typeof usage[key] === 'number' ? usage[key] as number : undefined
    this.usage.input = n('input_tokens') ?? this.usage.input
    this.usage.cacheRead = n('cache_read_input_tokens') ?? this.usage.cacheRead
    this.usage.cacheWrite = n('cache_creation_input_tokens') ?? this.usage.cacheWrite
    // message_delta reports the cumulative output count, so the latest value wins.
    this.usage.output = n('output_tokens') ?? this.usage.output
    if (usage.speed === 'fast') this.usage.fast = true
  }
}

/**
 * Claude Opus 5.5's list price in USD per million tokens, which is also micro-dollars per token: input 4, output 20,
 * 5-minute cache writes 5, cache reads 0.2. Fast mode doubles every rate.
 */
export function anthropicCostMicroUSD(u: AnthropicUsage): number {
  const m = u.fast ? 2 : 1
  return Math.round(m * (u.input * 4 + u.output * 20 + u.cacheWrite * 5 + u.cacheRead * 0.2))
}

/** How much each account may use. Every value comes from a function secret with a default. */
export interface Limits {
  enabled: boolean
  dailyMicroUSD: number
  monthlyMicroUSD: number
  dailyListeningSessions: number
  dailyRouterRequests: number
  /** Accounts with no limit (the owner). */
  unlimited: Set<string>
}

export function limitsFromEnv(get: (name: string) => string | undefined): Limits {
  const dollars = (name: string, fallback: number) => Math.round(numberOr(get(name), fallback) * 1_000_000)
  return {
    enabled: (get('ALFRED_HOSTED') ?? 'on').toLowerCase() !== 'off',
    dailyMicroUSD: dollars('ALFRED_DAILY_LIMIT_USD', 10),
    monthlyMicroUSD: dollars('ALFRED_MONTHLY_LIMIT_USD', 100),
    dailyListeningSessions: Math.round(numberOr(get('ALFRED_DAILY_LISTENING_SESSIONS'), 20)),
    dailyRouterRequests: Math.round(numberOr(get('ALFRED_DAILY_ROUTER_REQUESTS'), 500)),
    unlimited: new Set((get('ALFRED_UNLIMITED_ACCOUNTS') ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean)),
  }
}

/** Today's and this month's totals for an account, from `manor_alfred_usage`. */
export interface UsageTotals {
  day_cost_microusd: number
  month_cost_microusd: number
  day_listening_sessions: number
  day_router_requests: number
}

export type Kind = 'answer' | 'router' | 'listening'

/** The reader-facing reason a request is refused, or null when it may go ahead. */
export function refusal(kind: Kind, totals: UsageTotals, limits: Limits): string | null {
  if (kind === 'answer') {
    if (totals.month_cost_microusd >= limits.monthlyMicroUSD) return 'You\'ve used this month\'s Alfred allowance. It resets on the 1st (UTC).'
    if (totals.day_cost_microusd >= limits.dailyMicroUSD) return 'You\'ve used today\'s Alfred allowance. It resets at midnight UTC.'
  }
  if (kind === 'router' && totals.day_router_requests >= limits.dailyRouterRequests) return 'You\'ve used today\'s new-topic checks.'
  if (kind === 'listening' && totals.day_listening_sessions >= limits.dailyListeningSessions) {
    return 'You\'ve used today\'s listening sessions. They reset at midnight UTC.'
  }
  return null
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
