/**
 * Alfred's model access with Manor's keys, for signed-in Manor accounts. The app sends the same requests it would
 * send to the provider, with its Supabase session instead of a provider key:
 *
 *   POST /alfred-proxy/anthropic/messages   Claude Opus 5.5 (answers, memory, the Notes writer, Alfred in Manor)
 *   POST /alfred-proxy/openai/responses     GPT-6 Luna (the new-topic check)
 *   POST /alfred-proxy/deepgram/token       a short-lived Deepgram token for one listening session
 *   GET  /alfred-proxy/anthropic/models     a cheap reachability check (also warms the connection)
 *
 * Responses stream straight through. Usage is counted from the provider's own numbers and recorded per account
 * and day; no request or response content is stored or logged. ALFRED_HOSTED=off pauses everything.
 */
import {adminClient, required, verifiedCaller} from '../_shared/integrationRuntime.ts'
import {AnthropicMeter, anthropicBetas, anthropicCostMicroUSD, anthropicVersion, checkAnthropicBody, checkRouterBody, type Kind, limitsFromEnv,
  maxBodyBytes, refusal, type UsageTotals} from '../_shared/alfredProxy.ts'

const json = (status: number, value: unknown, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', ...extra}})
/** Errors shaped like each provider's, so the app's clients read them the same way. */
const anthropicError = (status: number, message: string) =>
  json(status, {type: 'error', error: {type: status === 429 ? 'rate_limit_error' : status === 401 ? 'authentication_error' : 'invalid_request_error', message}})
const openAIError = (status: number, message: string) => json(status, {error: {message}})

Deno.serve(async (request: Request): Promise<Response> => {
  const route = new URL(request.url).pathname.replace(/^.*\/alfred-proxy/, '')
  const errorFor = route.startsWith('/openai') || route.startsWith('/deepgram') ? openAIError : anthropicError
  const limits = limitsFromEnv((name) => Deno.env.get(name))
  if (!limits.enabled) return errorFor(503, 'Alfred is paused right now. Try again later.')

  let owner: string
  try {
    const caller = await verifiedCaller(request)
    // Agent tokens (ChatGPT, Codex) act on Manor's data; they don't spend Alfred's model access.
    if (caller.agent) return errorFor(403, 'Alfred\'s models are only available in the Manor app.')
    owner = caller.owner
  } catch {
    return errorFor(401, 'Sign in to Manor to use Alfred.')
  }

  if (request.method === 'GET' && (route === '/anthropic/models' || route === '/openai/models')) return json(200, {data: []})
  if (request.method !== 'POST') return errorFor(405, 'Use POST.')

  const db = adminClient()
  const unlimited = limits.unlimited.has(owner.toLowerCase())
  const allowed = async (kind: Kind): Promise<string | null> => {
    if (unlimited) return null
    const totals = await db.rpc('manor_alfred_usage', {p_owner: owner})
    if (totals.error) throw new Error(`Usage lookup failed: ${totals.error.message}`)
    return refusal(kind, totals.data as UsageTotals, limits)
  }
  const record = async (input: Record<string, number>) => {
    const result = await db.rpc('manor_alfred_record', {p_owner: owner, p_input: input})
    if (result.error) console.error(`alfred-proxy: recording usage failed: ${result.error.message}`)
  }

  try {
    switch (route) {
      case '/anthropic/messages': return await anthropic(request, allowed, record)
      case '/openai/responses': return await router(request, allowed, record)
      case '/deepgram/token': return await deepgram(allowed, record)
      default: return errorFor(404, 'Unknown Alfred route.')
    }
  } catch (error) {
    console.error(`alfred-proxy ${route}: ${error instanceof Error ? error.message : String(error)}`)
    return errorFor(502, 'Alfred couldn\'t reach its model provider. Try again.')
  }
})

type Allowed = (kind: Kind) => Promise<string | null>
type Recorder = (input: Record<string, number>) => Promise<void>

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > maxBodyBytes) throw new RangeError('too large')
  return JSON.parse(text)
}

async function anthropic(request: Request, allowed: Allowed, record: Recorder): Promise<Response> {
  let parsed: unknown
  try { parsed = await readBody(request) } catch { return anthropicError(400, 'The request was too large or not valid JSON.') }
  const checked = checkAnthropicBody(parsed)
  if (!checked.ok) return anthropicError(400, checked.message)
  const refused = await allowed('answer')
  if (refused) return anthropicError(429, refused)

  const betas = (request.headers.get('anthropic-beta') ?? '').split(',').map((b) => b.trim()).filter((b) => anthropicBetas.has(b))
  const headers: HeadersInit = {
    'content-type': 'application/json',
    'x-api-key': required('ANTHROPIC_API_KEY'),
    'anthropic-version': anthropicVersion,
    ...(betas.length ? {'anthropic-beta': betas.join(',')} : {}),
  }
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers, body: JSON.stringify(checked.body), signal: request.signal})
  const meter = new AnthropicMeter()
  const settle = () => record({
    requests: 1, input_tokens: meter.usage.input + meter.usage.cacheRead + meter.usage.cacheWrite, output_tokens: meter.usage.output,
    cost_microusd: anthropicCostMicroUSD(meter.usage),
  })
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), {status: upstream.status, headers: {'Content-Type': upstream.headers.get('content-type') ?? 'application/json'}})
  }
  if (checked.body.stream !== true) {
    const text = await upstream.text()
    try { meter.response(JSON.parse(text)) } catch { /* counted as zero */ }
    await settle()
    return new Response(text, {status: upstream.status, headers: {'Content-Type': 'application/json'}})
  }
  // Pass the stream through untouched while reading its usage events; usage is recorded once it ends.
  const decoder = new TextDecoder()
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      meter.feed(decoder.decode(chunk, {stream: true}))
      controller.enqueue(chunk)
    },
    async flush() { await settle() },
  })
  return new Response(upstream.body.pipeThrough(tap), {
    status: upstream.status,
    headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'},
  })
}

async function router(request: Request, allowed: Allowed, record: Recorder): Promise<Response> {
  let parsed: unknown
  try { parsed = await readBody(request) } catch { return openAIError(400, 'The request was too large or not valid JSON.') }
  const checked = checkRouterBody(parsed)
  if (!checked.ok) return openAIError(400, checked.message)
  const refused = await allowed('router')
  if (refused) return openAIError(429, refused)
  // The new-topic check is a short yes-or-no, so it's read whole even when the app asked for a stream.
  const body = {...checked.body, stream: false}
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: request.signal,
    headers: {'content-type': 'application/json', authorization: `Bearer ${required('OPENAI_API_KEY')}`},
    body: JSON.stringify(body),
  })
  const text = await upstream.text()
  if (upstream.ok) {
    let usage: Record<string, unknown> = {}
    try { usage = (JSON.parse(text) as {usage?: Record<string, unknown>}).usage ?? {} } catch { /* counted as zero */ }
    await record({
      router_requests: 1,
      input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    })
  }
  return new Response(text, {status: upstream.status, headers: {'Content-Type': 'application/json'}})
}

async function deepgram(allowed: Allowed, record: Recorder): Promise<Response> {
  const refused = await allowed('listening')
  if (refused) return openAIError(429, refused)
  // A grant lives about 30 seconds: long enough to open the stream, which then stays open on its own.
  const upstream = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST', headers: {authorization: `Token ${required('DEEPGRAM_API_KEY')}`, 'content-type': 'application/json'}, body: '{}',
  })
  const grant = await upstream.json().catch(() => ({})) as {access_token?: string, expires_in?: number}
  if (!upstream.ok || !grant.access_token) return openAIError(502, 'Alfred couldn\'t start listening. Try again.')
  await record({listening_sessions: 1})
  return json(200, {access_token: grant.access_token, expires_in: grant.expires_in ?? 30})
}
