/* Normalizes one knowledge-base capture: reads the kb_entries row, gathers
   the page text (server-side fetch) and/or the screenshot (signed URL), has
   terra produce clean fields, embeds them, and marks the row normalized.
   Runs with the caller's JWT so RLS scopes every read/write to the owner. */

import { createClient } from 'npm:@supabase/supabase-js@2'

interface NormalizedFields {
  title: string | null
  author: string | null
  summary: string | null
  content_md: string | null
}

const TERRA_MODEL = 'gpt-5.6-terra'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const PAGE_TEXT_LIMIT = 60_000

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`normalize-capture is missing required secret ${name}`)
  }
  return value
}

async function fetchPageText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ManorCapture/1.0' }
  })
  if (!response.ok) return null
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/html') && !type.includes('text/plain')) return null
  const html = await response.text()
  // Crude tag strip; terra does the real cleanup from this plus the screenshot.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, PAGE_TEXT_LIMIT)
}

async function normalizeWithTerra(
  openaiKey: string,
  pageUrl: string | null,
  pageText: string | null,
  screenshotUrl: string | null
): Promise<NormalizedFields> {
  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: [
        'Normalize this captured web content into a personal knowledge base entry.',
        'Return strict JSON with keys: title, author, summary, content_md.',
        'title: the piece\'s real title. author: byline or account name, null if unknown.',
        'summary: 2-3 sentences. content_md: the substantive content as clean Markdown,',
        'dropping navigation, ads, and interface chrome. Use null for anything unknowable.',
        pageUrl === null ? '' : `Source URL: ${pageUrl}`,
        pageText === null ? '' : `Extracted page text:\n${pageText}`
      ]
        .filter((line) => line !== '')
        .join('\n\n')
    }
  ]
  if (screenshotUrl !== null) {
    userContent.push({ type: 'image_url', image_url: { url: screenshotUrl } })
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: TERRA_MODEL,
      reasoning_effort: 'medium',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: userContent }]
    })
  })
  if (!response.ok) {
    throw new Error(`terra normalization failed: ${response.status} ${await response.text()}`)
  }
  const payload = await response.json()
  const raw = payload.choices?.[0]?.message?.content
  if (typeof raw !== 'string') {
    throw new Error('terra normalization returned no content')
  }
  const parsed = JSON.parse(raw)
  const field = (key: string): string | null =>
    typeof parsed[key] === 'string' && parsed[key].trim() !== '' ? parsed[key] : null
  return {
    title: field('title'),
    author: field('author'),
    summary: field('summary'),
    content_md: field('content_md')
  }
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

  const { entryId } = await request.json()
  if (typeof entryId !== 'string') {
    return new Response(JSON.stringify({ error: 'entryId is required' }), { status: 400 })
  }

  const { data: entry, error: loadError } = await supabase
    .from('kb_entries')
    .select('id, url, screenshot_path, raw')
    .eq('id', entryId)
    .single()
  if (loadError !== null || entry === null) {
    return new Response(JSON.stringify({ error: `kb entry ${entryId} not found` }), { status: 404 })
  }

  try {
    const pageText = entry.url === null ? null : await fetchPageText(entry.url)

    let screenshotUrl: string | null = null
    if (entry.screenshot_path !== null) {
      const { data: signed, error: signError } = await supabase.storage
        .from('captures')
        .createSignedUrl(entry.screenshot_path, 600)
      if (signError !== null) throw new Error(`could not sign screenshot: ${signError.message}`)
      screenshotUrl = signed.signedUrl
    }

    const fields = await normalizeWithTerra(openaiKey, entry.url, pageText, screenshotUrl)
    const embeddingInput = [fields.title, fields.summary, fields.content_md]
      .filter((part): part is string => part !== null)
      .join('\n\n')
    const embedding = embeddingInput === '' ? null : await embed(openaiKey, embeddingInput)

    const { error: updateError } = await supabase
      .from('kb_entries')
      .update({
        ...fields,
        embedding,
        status: 'normalized',
        error: null,
        normalized_at: new Date().toISOString()
      })
      .eq('id', entryId)
    if (updateError !== null) throw new Error(`could not save normalization: ${updateError.message}`)

    return new Response(JSON.stringify({ ok: true, entryId, title: fields.title }), {
      headers: { 'content-type': 'application/json' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase
      .from('kb_entries')
      .update({ status: 'failed', error: message })
      .eq('id', entryId)
    return new Response(JSON.stringify({ ok: false, entryId, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
})
