/* Alfred's supervisor and memory writer. Three request shapes, all under the
   caller's JWT so RLS scopes every read and write to the owner:
   - { question, context? }  -> terra answers with top matches from the
     knowledge base and Alfred memories; returns { answer }
   - { rememberFact }        -> embeds and stores a 'fact' memory
   - { sessionSummary }      -> embeds and stores a 'session_summary' memory */

import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const TERRA_MODEL = 'gpt-5.6-terra'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const MATCH_COUNT = 5

interface KbMatch {
  title: string | null
  summary: string | null
  content_md: string | null
  url: string | null
  similarity: number
}

interface MemoryMatch {
  kind: string
  content: string
  created_at: string
  similarity: number
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`alfred-consult is missing required secret ${name}`)
  }
  return value
}

async function embed(openaiKey: string, text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 24_000) })
  })
  if (!response.ok) {
    throw new Error(`embedding failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json()
  const vector = payload.data?.[0]?.embedding
  if (!Array.isArray(vector)) {
    throw new Error('embedding response had no vector')
  }
  return vector
}

async function storeMemory(
  supabase: SupabaseClient,
  openaiKey: string,
  kind: 'fact' | 'session_summary',
  content: string
): Promise<Response> {
  const embedding = await embed(openaiKey, content)
  const { error } = await supabase
    .from('alfred_memories')
    .insert({ kind, content, embedding })
  if (error !== null) {
    throw new Error(`could not store ${kind}: ${error.message}`)
  }
  return new Response(JSON.stringify({ ok: true, kind }), {
    headers: { 'content-type': 'application/json' }
  })
}

function kbBlock(matches: readonly KbMatch[]): string {
  if (matches.length === 0) return 'Knowledge base: no relevant entries.'
  const entries = matches.map((match) => {
    const body = match.summary ?? match.content_md?.slice(0, 1200) ?? ''
    return `- ${match.title ?? 'Untitled'}${match.url === null ? '' : ` (${match.url})`}: ${body}`
  })
  return `Knowledge base matches:\n${entries.join('\n')}`
}

function memoryBlock(matches: readonly MemoryMatch[]): string {
  if (matches.length === 0) return 'Memories: none relevant.'
  const entries = matches.map(
    (match) => `- [${match.kind}, ${match.created_at.slice(0, 10)}] ${match.content}`
  )
  return `Relevant memories:\n${entries.join('\n')}`
}

async function answerQuestion(
  supabase: SupabaseClient,
  openaiKey: string,
  question: string,
  context: string | null
): Promise<Response> {
  const queryEmbedding = await embed(openaiKey, question)
  const [kb, memories] = await Promise.all([
    supabase.rpc('match_kb_entries', { query_embedding: queryEmbedding, match_count: MATCH_COUNT }),
    supabase.rpc('match_alfred_memories', {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT
    })
  ])
  if (kb.error !== null) {
    throw new Error(`knowledge base match failed: ${kb.error.message}`)
  }
  if (memories.error !== null) {
    throw new Error(`memory match failed: ${memories.error.message}`)
  }

  const systemPrompt = [
    'You are the supervisor behind Alfred, the voice assistant of a personal',
    'productivity system. Your answer is spoken aloud by a realtime voice model,',
    'so write for text-to-speech: short sentences, plain words, no markdown, no',
    'lists, no headings, no em-dashes. Be direct and concise. Use the provided',
    'knowledge base matches and memories when relevant; ignore them when not.',
    'If you do not know, say so plainly.'
  ].join(' ')

  const userContent = [
    context === null ? '' : `Session context: ${context}`,
    kbBlock((kb.data ?? []) as KbMatch[]),
    memoryBlock((memories.data ?? []) as MemoryMatch[]),
    `Question: ${question}`
  ]
    .filter((part) => part !== '')
    .join('\n\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: TERRA_MODEL,
      reasoning_effort: 'medium',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  })
  if (!response.ok) {
    throw new Error(`terra consult failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json()
  const answer = payload.choices?.[0]?.message?.content
  if (typeof answer !== 'string' || answer === '') {
    throw new Error('terra consult returned no answer')
  }
  return new Response(JSON.stringify({ answer }), {
    headers: { 'content-type': 'application/json' }
  })
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

  try {
    const body = await request.json()
    if (typeof body?.rememberFact === 'string' && body.rememberFact.trim() !== '') {
      return await storeMemory(supabase, openaiKey, 'fact', body.rememberFact)
    }
    if (typeof body?.sessionSummary === 'string' && body.sessionSummary.trim() !== '') {
      return await storeMemory(supabase, openaiKey, 'session_summary', body.sessionSummary)
    }
    if (typeof body?.question === 'string' && body.question.trim() !== '') {
      const context = typeof body.context === 'string' ? body.context : null
      return await answerQuestion(supabase, openaiKey, body.question, context)
    }
    return new Response(
      JSON.stringify({ error: 'Body must contain question, rememberFact, or sessionSummary' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
})
