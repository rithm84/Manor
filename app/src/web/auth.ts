import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { ManorAccount } from './accountContext'
import { ManorConnectionError, type ManorGateway, type JsonObject } from './ManorGateway'
import { signInOutcome } from './shell/deepLinks'
import type { DesktopShell } from './shell/DesktopShell'

export async function signInWithGoogle(client: SupabaseClient, shell: DesktopShell): Promise<void> {
  const started = await client.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: shell.authRedirectUrl, skipBrowserRedirect: true }
  })
  if (started.error) throw started.error
  await shell.openAuthorization(started.data.url)
}

export async function requestSignup(client: SupabaseClient, shell: DesktopShell, email: string, password: string): Promise<void> {
  const parsedEmail = z.email().parse(email.trim())
  const { data, error } = await client.functions.invoke('signup-gate', { body: { email: parsedEmail, password } })
  if (error) throw new Error(`Account invitation could not be verified: ${error.message}`)
  z.object({ granted: z.literal(true), expiresIn: z.number().positive() }).parse(data)
  const result = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: shell.authRedirectUrl, skipBrowserRedirect: true, queryParams: { login_hint: parsedEmail } }
  })
  if (result.error) throw result.error
  await shell.openAuthorization(result.data.url)
}

/** Finishes a sign-in that came back through a deep link, which supabase-js never sees in the address bar. */
export async function completeSignIn(client: SupabaseClient, route: string): Promise<void> {
  const outcome = signInOutcome(route)
  if (outcome.kind === 'error') throw new Error(outcome.message)
  const { error } = outcome.kind === 'code'
    ? await client.auth.exchangeCodeForSession(outcome.code)
    : await client.auth.setSession({ access_token: outcome.accessToken, refresh_token: outcome.refreshToken })
  if (error) throw error
}

const profileSchema = z.object({
  name: z.string().nullable(), timezone: z.string().nullable(), revision: z.number().int(), settings: z.record(z.string(), z.json())
})

const accountCacheKey = (accountId: string): string => `manor.account:${accountId}`

/**
 * The account as this device last loaded it, so a returning visit renders before the profile round trip.
 * A cache written for another email or a different shape is stale, not an error: the profile round trip replaces it.
 */
export function cachedAccount(accountId: string, email: string): ManorAccount | null {
  const cached = localStorage.getItem(accountCacheKey(accountId))
  if (cached === null) return null
  let value: unknown
  try { value = JSON.parse(cached) } catch { return null }
  const parsed = z.object({ id: z.literal(accountId), email: z.literal(email), name: z.string(), timezone: z.string() }).safeParse(value)
  return parsed.success ? parsed.data : null
}

export async function loadAccount(gateway: ManorGateway, email: string, googleName: string): Promise<ManorAccount> {
  const cacheKey = accountCacheKey(gateway.accountId)
  const readProtectedAccount = (): ManorAccount => {
    const account = cachedAccount(gateway.accountId, email)
    if (account === null) throw new Error('Connect once to open this account before using Notes offline')
    return account
  }
  if (!navigator.onLine) return readProtectedAccount()
  let rows: JsonObject[]
  try { rows = await gateway.rows('profiles') }
  catch (error) {
    if (!(error instanceof ManorConnectionError)) throw error
    return readProtectedAccount()
  }
  const profile = rows.length === 0 ? null : profileSchema.parse(rows[0])
  const timezone = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!profile || !profile.timezone) {
    await gateway.command('save_profile', {
      name: profile?.name || googleName, timezone, settings: profile?.settings ?? {}, expected_revision: profile?.revision ?? 0
    }, crypto.randomUUID())
  }
  const account = { id: gateway.accountId, email, name: profile?.name || googleName, timezone }
  localStorage.setItem(cacheKey, JSON.stringify(account))
  return account
}
