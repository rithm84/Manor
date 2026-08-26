/* X (Twitter) OAuth 2.0 + PKCE connection channels. Electron-free (node http
   + crypto only) so the dev browser bridge can serve them, like supabaseCore.
   Runs X as a public client; when X_CLIENT_SECRET is set the token calls
   switch to confidential-client basic auth. */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { XConnectionStatus } from '../shared/xConnection'
import type { BridgeChannelHandler } from './bridgeChannels'
import { accountOf, envValueFrom } from './supabaseCore'

export interface XChannelConfig {
  /** Directory holding .env.local (the repository root in dev). */
  envRoot: string
}

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const ME_URL = 'https://api.x.com/2/users/me'
const CALLBACK_PORT = 17997
const CALLBACK_PATH = '/callback'
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
const SCOPES = ['bookmark.read', 'tweet.read', 'users.read', 'offline.access'] as const
const COMPLETE_TIMEOUT_MS = 120_000
const EXTERNAL_RETRIES = 3

const CALLBACK_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Manor</title>' +
  '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">' +
  '<p style="font-size:15px;color:#1b191d">%MESSAGE%</p></body>'

/** RFC 7636 code verifier: 43 base64url characters from 32 random bytes. */
export function pkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** RFC 7636 S256 challenge: base64url(sha256(verifier)). */
export function pkceChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** The x.com authorize URL for one PKCE flow. */
export function authorizeUrlOf(clientId: string, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

interface PendingFlow {
  verifier: string
  server: Server
  code: Promise<string>
}

interface TokenGrant {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scopes: string[]
}

interface XIdentity {
  id: string
  username: string
}

function callbackPage(message: string): string {
  return CALLBACK_PAGE.replace('%MESSAGE%', message)
}

function requireClientId(envRoot: string): string {
  const clientId = envValueFrom(envRoot, 'X_CLIENT_ID')
  if (clientId === null) {
    throw new Error(
      'X is not set up yet. Add X_CLIENT_ID to .env.local at the repository root, then try again.'
    )
  }
  return clientId
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const account = await accountOf(client)
  if (account === null) {
    throw new Error('Sign in to Manor to connect X')
  }
  return account.userId
}

/**
 * Fetch with retries for transient failures (network errors, 429, 5xx).
 * Definitive 4xx responses raise immediately with status and body.
 */
async function externalFetch(label: string, input: string, init: RequestInit): Promise<Response> {
  let lastError: Error = new Error(`${label} was never attempted`)
  for (let attempt = 1; attempt <= EXTERNAL_RETRIES; attempt += 1) {
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (cause) {
      lastError = new Error(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      console.warn('x api call failed, retrying', { label, attempt, error: lastError.message })
      continue
    }
    if (response.ok) return response
    const body = await response.text()
    lastError = new Error(`${label} failed: ${response.status} ${body}`)
    if (response.status < 500 && response.status !== 429) throw lastError
    console.warn('x api call failed, retrying', { label, attempt, status: response.status })
  }
  throw lastError
}

async function exchangeCode(
  envRoot: string,
  clientId: string,
  code: string,
  verifier: string
): Promise<TokenGrant> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    client_id: clientId
  })
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded'
  }
  const clientSecret = envValueFrom(envRoot, 'X_CLIENT_SECRET')
  if (clientSecret !== null) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }
  const response = await externalFetch('X token exchange', TOKEN_URL, {
    method: 'POST',
    headers,
    body: body.toString()
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (
    typeof payload.access_token !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.expires_in !== 'number'
  ) {
    throw new Error(`X token exchange returned an unexpected shape: ${JSON.stringify(payload)}`)
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [...SCOPES]
  }
}

async function fetchIdentity(accessToken: string): Promise<XIdentity> {
  const response = await externalFetch('X profile lookup', ME_URL, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` }
  })
  const payload = (await response.json()) as { data?: { id?: unknown; username?: unknown } }
  if (typeof payload.data?.id !== 'string' || typeof payload.data.username !== 'string') {
    throw new Error(`X profile lookup returned an unexpected shape: ${JSON.stringify(payload)}`)
  }
  return { id: payload.data.id, username: payload.data.username }
}

/** One-shot loopback server that resolves with the OAuth code for this flow. */
function startCallbackServer(expectedState: string): Promise<PendingFlow> {
  const verifier = pkceVerifier()
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  // Swallow late rejections (for example a timeout already surfaced the error).
  code.catch(() => undefined)

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${CALLBACK_PORT}`)
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end()
      return
    }
    const deniedWith = url.searchParams.get('error')
    const returnedCode = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    if (deniedWith !== null) {
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end(callbackPage('The connection was cancelled. You can close this tab.'))
      rejectCode(new Error(`X did not authorize Manor: ${deniedWith}`))
      return
    }
    if (returnedCode === null || returnedState !== expectedState) {
      response
        .writeHead(400, { 'content-type': 'text/html' })
        .end(callbackPage('Something went wrong. Head back to Manor and try again.'))
      rejectCode(new Error('X callback arrived without a matching state or code'))
      return
    }
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(callbackPage('You can close this tab. Manor is connected.'))
    resolveCode(returnedCode)
  })

  return new Promise<PendingFlow>((resolve, reject) => {
    server.once('error', (cause) => {
      reject(new Error(`The X sign in listener could not start: ${cause.message}`))
    })
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      resolve({ verifier, server, code })
    })
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

async function statusOf(client: SupabaseClient): Promise<XConnectionStatus> {
  const account = await accountOf(client)
  if (account === null) {
    return { connected: false, username: null, connectedAt: null }
  }
  const { data, error } = await client
    .from('x_connections')
    .select('x_username, connected_at')
    .maybeSingle()
  if (error !== null) {
    throw new Error(`Could not read the X connection: ${error.message}`)
  }
  if (data === null) {
    return { connected: false, username: null, connectedAt: null }
  }
  const row = data as { x_username: string; connected_at: string }
  return { connected: true, username: row.x_username, connectedAt: row.connected_at }
}

function invokeErrorDetail(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createXChannels(
  config: XChannelConfig,
  clientOf: () => SupabaseClient
): Record<string, BridgeChannelHandler> {
  let pending: PendingFlow | null = null

  /** Drains keep-alive sockets and frees the port for the next flow. */
  const closeFlow = (flow: PendingFlow): Promise<void> => {
    if (pending === flow) pending = null
    flow.server.closeAllConnections()
    return new Promise((resolve) => {
      flow.server.close(() => resolve())
    })
  }

  const closePending = (): Promise<void> => (pending === null ? Promise.resolve() : closeFlow(pending))

  return {
    'x:begin-connect': async () => {
      await requireUserId(clientOf())
      const clientId = requireClientId(config.envRoot)
      await closePending()
      const state = randomBytes(16).toString('base64url')
      pending = await startCallbackServer(state)
      return { authorizeUrl: authorizeUrlOf(clientId, state, pkceChallengeOf(pending.verifier)) }
    },

    'x:complete-connect': async () => {
      if (pending === null) {
        throw new Error('Start connecting from Settings first.')
      }
      const flow = pending
      try {
        const code = await withTimeout(
          flow.code,
          COMPLETE_TIMEOUT_MS,
          'The X sign in timed out. Try connecting again.'
        )
        const client = clientOf()
        const userId = await requireUserId(client)
        const clientId = requireClientId(config.envRoot)
        const grant = await exchangeCode(config.envRoot, clientId, code, flow.verifier)
        const identity = await fetchIdentity(grant.accessToken)
        const { error } = await client.from('x_connections').upsert({
          user_id: userId,
          x_user_id: identity.id,
          x_username: identity.username,
          access_token: grant.accessToken,
          refresh_token: grant.refreshToken,
          token_expires_at: grant.expiresAt,
          scopes: grant.scopes,
          connected_at: new Date().toISOString()
        })
        if (error !== null) {
          throw new Error(`Could not save the X connection: ${error.message}`)
        }
        return await statusOf(client)
      } finally {
        await closeFlow(flow)
      }
    },

    'x:status': () => statusOf(clientOf()),

    'x:disconnect': async () => {
      const client = clientOf()
      const userId = await requireUserId(client)
      const { error } = await client.from('x_connections').delete().eq('user_id', userId)
      if (error !== null) {
        throw new Error(`Could not disconnect X: ${error.message}`)
      }
      return null
    },

    'x:ingest-now': async () => {
      const client = clientOf()
      await requireUserId(client)
      const { data, error } = await client.functions.invoke('x-ingest', { body: {} })
      if (error !== null) {
        const context = (error as { context?: unknown }).context
        let detail = invokeErrorDetail(error)
        if (context instanceof Response) {
          const body = await context.text().catch(() => '')
          if (body !== '') detail = `${context.status} ${body}`
        }
        throw new Error(`The X sync did not run: ${detail}`)
      }
      const added = (data as { added?: unknown } | null)?.added
      if (typeof added !== 'number') {
        throw new Error(`The X sync returned an unexpected shape: ${JSON.stringify(data)}`)
      }
      return { added }
    }
  }
}
