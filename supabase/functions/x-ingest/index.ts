/* Ingests X bookmarks into kb_entries. Two callers: the app invokes it with
   the user's JWT (scoped to that one connection), and the pg_cron job invokes
   it with the service role key (iterates every connection). Per connection:
   refresh the OAuth token when close to expiry (X rotates refresh tokens),
   page the newest 25 bookmarks, and insert anything not already present by
   (user_id, source_ref). The list is reverse-chronological, so ingestion
   stops at the first known post, which keeps pay-per-use X reads at cents. */

import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { kbRowOf, needsRefresh } from './mapping.ts'
import type { XPost, XUser } from './mapping.ts'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const BOOKMARK_PAGE_SIZE = 25
const EXTERNAL_RETRIES = 3

interface XConnection {
  user_id: string
  x_user_id: string
  x_username: string
  access_token: string
  refresh_token: string
  token_expires_at: string
}

interface IngestTotals {
  added: number
  skipped: number
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`x-ingest is missing required secret ${name}`)
  }
  return value
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Fetch with retries for transient failures (network, 429, 5xx); 4xx raises. */
async function externalFetch(label: string, input: string, init: RequestInit): Promise<Response> {
  let lastError: Error = new Error(`${label} was never attempted`)
  for (let attempt = 1; attempt <= EXTERNAL_RETRIES; attempt += 1) {
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (cause) {
      lastError = new Error(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      console.warn('external call failed, retrying', { label, attempt, error: lastError.message })
      continue
    }
    if (response.ok) return response
    const body = await response.text()
    lastError = new Error(`${label} failed: ${response.status} ${body}`)
    if (response.status < 500 && response.status !== 429) throw lastError
    console.warn('external call failed, retrying', { label, attempt, status: response.status })
  }
  throw lastError
}

/** Refreshes the connection's access token and persists the rotated pair. */
async function refreshTokens(admin: SupabaseClient, connection: XConnection): Promise<XConnection> {
  const clientId = requiredEnv('X_CLIENT_ID')
  const clientSecret = Deno.env.get('X_CLIENT_SECRET')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
    client_id: clientId
  })
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded'
  }
  if (clientSecret !== undefined && clientSecret !== '') {
    headers.authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`
  }
  const response = await externalFetch('X token refresh', TOKEN_URL, {
    method: 'POST',
    headers,
    body: body.toString()
  })
  const payload = await response.json()
  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.expires_in !== 'number'
  ) {
    throw new Error(`X token refresh returned an unexpected shape: ${JSON.stringify(payload)}`)
  }
  const refreshed: XConnection = {
    ...connection,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_expires_at: new Date(Date.now() + payload.expires_in * 1000).toISOString()
  }
  const { error } = await admin
    .from('x_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: refreshed.token_expires_at
    })
    .eq('user_id', connection.user_id)
  if (error !== null) {
    throw new Error(`could not persist rotated X tokens for ${connection.user_id}: ${error.message}`)
  }
  return refreshed
}

interface BookmarkPage {
  posts: XPost[]
  users: Map<string, XUser>
}

async function fetchBookmarks(connection: XConnection): Promise<BookmarkPage> {
  const url = new URL(`https://api.x.com/2/users/${connection.x_user_id}/bookmarks`)
  url.searchParams.set('max_results', String(BOOKMARK_PAGE_SIZE))
  url.searchParams.set('tweet.fields', 'created_at,entities,author_id')
  url.searchParams.set('expansions', 'author_id')
  url.searchParams.set('user.fields', 'username,name')
  const response = await externalFetch('X bookmarks read', url.toString(), {
    method: 'GET',
    headers: { authorization: `Bearer ${connection.access_token}` }
  })
  const payload = await response.json()
  const posts = Array.isArray(payload.data) ? (payload.data as XPost[]) : []
  const users = new Map<string, XUser>()
  for (const user of Array.isArray(payload.includes?.users) ? (payload.includes.users as XUser[]) : []) {
    users.set(user.id, user)
  }
  return { posts, users }
}

async function embed(openaiKey: string, text: string): Promise<number[]> {
  const response = await externalFetch('embedding', 'https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 24_000) })
  })
  const payload = await response.json()
  const vector = payload.data?.[0]?.embedding
  if (!Array.isArray(vector)) {
    throw new Error('embedding response had no vector')
  }
  return vector
}

/** Hands a pending entry to normalize-capture so its linked article is pulled in. */
async function requestNormalization(
  supabaseUrl: string,
  authorization: string,
  entryId: string
): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/normalize-capture`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ entryId })
  })
  if (!response.ok) {
    // The entry stays pending; the Bookmarks page offers a retry.
    console.warn('normalize-capture invocation failed', {
      entryId,
      status: response.status,
      body: await response.text()
    })
  }
}

async function ingestConnection(
  admin: SupabaseClient,
  connection: XConnection,
  supabaseUrl: string,
  authorization: string,
  openaiKey: string
): Promise<IngestTotals> {
  let live = connection
  if (needsRefresh(live.token_expires_at, Date.now())) {
    live = await refreshTokens(admin, live)
  }

  const page = await fetchBookmarks(live)
  if (page.posts.length === 0) return { added: 0, skipped: 0 }

  const { data: existingRows, error: existingError } = await admin
    .from('kb_entries')
    .select('source_ref')
    .eq('user_id', live.user_id)
    .eq('source', 'x_bookmark')
    .in('source_ref', page.posts.map((post) => post.id))
  if (existingError !== null) {
    throw new Error(`could not read existing bookmarks for ${live.user_id}: ${existingError.message}`)
  }
  const existing = new Set((existingRows as { source_ref: string }[]).map((row) => row.source_ref))

  let added = 0
  for (const post of page.posts) {
    // Reverse-chronological page: the first known post means the rest are known too.
    if (existing.has(post.id)) break
    const row = kbRowOf(live.user_id, post, page.users.get(post.author_id), new Date().toISOString())
    const { data: inserted, error: insertError } = await admin
      .from('kb_entries')
      .insert(row)
      .select('id')
      .single()
    if (insertError !== null) {
      throw new Error(`could not insert bookmark ${post.id} for ${live.user_id}: ${insertError.message}`)
    }
    added += 1
    const entryId = (inserted as { id: string }).id
    if (row.status === 'normalized') {
      const embedding = await embed(openaiKey, `${row.title}\n\n${row.content_md}`)
      const { error: embedError } = await admin
        .from('kb_entries')
        .update({ embedding, normalized_at: new Date().toISOString() })
        .eq('id', entryId)
      if (embedError !== null) {
        throw new Error(`could not save embedding for ${entryId}: ${embedError.message}`)
      }
    } else {
      await requestNormalization(supabaseUrl, authorization, entryId)
    }
  }
  return { added, skipped: page.posts.length - added }
}

Deno.serve(async (request) => {
  const authorization = request.headers.get('Authorization')
  if (authorization === null) {
    return json({ error: 'Missing Authorization header' }, 401)
  }
  const supabaseUrl = requiredEnv('SUPABASE_URL')
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const openaiKey = requiredEnv('OPENAI_API_KEY')
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const bearer = authorization.replace(/^Bearer\s+/i, '')
  let scopedUserId: string | null = null
  if (bearer !== serviceKey) {
    const caller = createClient(supabaseUrl, requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    })
    const { data, error } = await caller.auth.getUser()
    if (error !== null || data.user === null) {
      return json({ error: 'The caller token is not valid' }, 401)
    }
    scopedUserId = data.user.id
  }

  let query = admin
    .from('x_connections')
    .select('user_id, x_user_id, x_username, access_token, refresh_token, token_expires_at')
  if (scopedUserId !== null) {
    query = query.eq('user_id', scopedUserId)
  }
  const { data: connections, error: connectionsError } = await query
  if (connectionsError !== null) {
    return json({ error: `could not list X connections: ${connectionsError.message}` }, 500)
  }
  if (scopedUserId !== null && connections.length === 0) {
    return json({ error: 'No X connection for this account. Connect X in Settings first.' }, 400)
  }

  const totals: IngestTotals = { added: 0, skipped: 0 }
  for (const connection of connections as XConnection[]) {
    try {
      const result = await ingestConnection(admin, connection, supabaseUrl, authorization, openaiKey)
      totals.added += result.added
      totals.skipped += result.skipped
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (scopedUserId !== null) {
        return json({ error: message }, 500)
      }
      // Cron mode: one broken connection must not stall the rest.
      console.error('x-ingest connection failed', { userId: connection.user_id, error: message })
    }
  }
  return json({ added: totals.added, skipped: totals.skipped }, 200)
})
