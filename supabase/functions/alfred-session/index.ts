/* Mints an ephemeral OpenAI Realtime client secret for one Alfred voice
   session. Builds the memory preamble from the caller's alfred_memories
   (RLS-scoped via the caller's JWT), echoes the tool schema sent by the
   renderer into the session config, and never exposes OPENAI_API_KEY. */

import { createClient } from 'npm:@supabase/supabase-js@2'

const REALTIME_MODEL = 'gpt-realtime-2.1'
const REALTIME_VOICE = 'ash'
const CLIENT_SECRET_TTL_SECONDS = 600
const FACT_LIMIT = 20

interface MemoryRow {
  kind: 'fact' | 'session_summary'
  content: string
  created_at: string
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`alfred-session is missing required secret ${name}`)
  }
  return value
}

function preambleOf(today: string, facts: readonly string[], lastSummary: string | null): string {
  const lines = [
    "You are Alfred, the voice of Manor, the user's personal productivity system.",
    'Speak like a concise, capable butler: warm, brief, never chatty. Your replies',
    'are heard, not read, so use short natural sentences. No markdown, no lists,',
    'no symbols, no em-dashes.',
    '',
    `Today is ${today}.`,
    '',
    'You act through your tools. Rules of authority:',
    '- The Journal is off limits, architecturally. You cannot read it, write it,',
    '  open it, or discuss its contents. If asked, say the Journal stays private.',
    '- Logging, check-offs, and creating things need no confirmation. Do them,',
    '  then confirm in one short sentence.',
    '- Deleting anything or editing history requires a spoken confirm-back.',
    '  Say exactly what you are about to do, ask the user, and call the tool with',
    '  confirmed true only after a clear yes. The tools enforce this.',
    '- For hard questions, cross-module insight, or anything drawing on saved',
    '  knowledge, say a brief filler line, call the consult tool, and relay its',
    '  answer in your own voice.',
    '- When you learn a lasting fact about the user, store it with remember.'
  ]
  if (facts.length > 0) {
    lines.push('', 'What you remember about the user:')
    for (const fact of facts) lines.push(`- ${fact}`)
  }
  if (lastSummary !== null) {
    lines.push('', `Last session: ${lastSummary}`)
  }
  return lines.join('\n')
}

Deno.serve(async (request) => {
  const authorization = request.headers.get('Authorization')
  if (authorization === null) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }
  const openaiKey = requiredEnv('OPENAI_API_KEY')
  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  })

  const body = await request.json()
  const tools = body?.tools
  if (!Array.isArray(tools) || tools.length === 0) {
    return new Response(JSON.stringify({ error: 'tools must be a non-empty array' }), {
      status: 400
    })
  }

  try {
    const { data: memories, error: memoryError } = await supabase
      .from('alfred_memories')
      .select('kind, content, created_at')
      .order('created_at', { ascending: false })
      .limit(60)
    if (memoryError !== null) {
      throw new Error(`could not load Alfred memories: ${memoryError.message}`)
    }
    const rows = (memories ?? []) as MemoryRow[]
    const facts = rows
      .filter((row) => row.kind === 'fact')
      .slice(0, FACT_LIMIT)
      .map((row) => row.content)
    const lastSummary = rows.find((row) => row.kind === 'session_summary')?.content ?? null

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    const instructions = preambleOf(today, facts, lastSummary)

    const minted = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions,
          audio: { output: { voice: REALTIME_VOICE } },
          tools
        }
      })
    })
    if (!minted.ok) {
      throw new Error(`client secret mint failed: ${minted.status} ${await minted.text()}`)
    }
    const payload = await minted.json()
    const clientSecret = payload.value
    if (typeof clientSecret !== 'string' || clientSecret === '') {
      throw new Error('client secret mint returned no value')
    }
    const expiresAt =
      typeof payload.expires_at === 'number'
        ? new Date(payload.expires_at * 1000).toISOString()
        : new Date(Date.now() + CLIENT_SECRET_TTL_SECONDS * 1000).toISOString()

    return new Response(JSON.stringify({ clientSecret, expiresAt, instructions }), {
      headers: { 'content-type': 'application/json' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
})
