import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { OriginNotAllowedError, originHeaders, requestOrigin } from '../_shared/origins.ts'

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required server configuration: ${name}`)
  return value
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (byte: number) => byte.toString(16).padStart(2, '0')).join('')
}

function matchesSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

Deno.serve(async (request: Request): Promise<Response> => {
  let origin: string | null
  try { origin = requestOrigin(request) }
  catch (error) { if (error instanceof OriginNotAllowedError) return Response.json({ error: error.message }, { status: 403 }); throw error }
  const headers = { 'Content-Type': 'application/json', ...originHeaders(origin), 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
  const reply = (status: number, body: object): Response => new Response(JSON.stringify(body), { status, headers })
  if (origin === null) return reply(403, { error: 'A browser origin is required' })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST' })
  if (Number(request.headers.get('content-length')) > 4096) return reply(413, { error: 'Request is too large' })
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > 4096) return reply(413, { error: 'Request is too large' })
  let body: { email?: string; password?: string }
  try { body = JSON.parse(raw) as { email?: string; password?: string } }
  catch { return reply(400, { error: 'Request must be JSON' }) }
  if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 || typeof body.password !== 'string' || body.password.length > 512) return reply(400, { error: 'Provide a valid Google email and signup password' })
  const email = body.email.trim().toLowerCase()
  const client = createClient(requiredEnvironment('SUPABASE_URL'), requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: permitted, error: limitError } = await client.rpc('manor_signup_attempt', { p_email_hash: await digest(email) })
  if (limitError) { console.error('signup_limit_failed', { code: limitError.code }); return reply(503, { error: 'Signup is temporarily unavailable' }) }
  if (!permitted) return reply(429, { error: 'Too many signup attempts. Try again in 15 minutes.' })
  if (!matchesSecret(await digest(body.password), await digest(requiredEnvironment('MANOR_SIGNUP_PASSWORD')))) return reply(403, { error: 'The signup password is incorrect' })
  const { error } = await client.rpc('manor_issue_signup_grant', { p_email: email })
  if (error) { console.error('signup_grant_failed', { code: error.code }); return reply(503, { error: 'Signup is temporarily unavailable' }) }
  return reply(200, { granted: true, expiresIn: 600 })
})
