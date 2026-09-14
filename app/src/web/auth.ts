import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { ManorAccount } from './accountContext'
import { ManorConnectionError, type ManorGateway, type JsonObject } from './ManorGateway'

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  if (location.pathname === '/oauth/consent') sessionStorage.setItem('manor.auth.return', location.pathname + location.search)
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: `${location.origin}/auth/callback` }
  })
  if (error) throw error
}

export async function requestSignup(client: SupabaseClient, email: string, password: string): Promise<void> {
  const parsedEmail = z.email().parse(email.trim())
  const { data, error } = await client.functions.invoke('signup-gate', { body: { email: parsedEmail, password } })
  if (error) throw new Error(`Account invitation could not be verified: ${error.message}`)
  z.object({ granted: z.literal(true), expiresIn: z.number().positive() }).parse(data)
  const result = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { login_hint: parsedEmail } }
  })
  if (result.error) throw result.error
}

const profileSchema = z.object({
  name: z.string().nullable(), timezone: z.string().nullable(), revision: z.number().int(), settings: z.record(z.string(), z.json())
})

const accountCacheKey = (accountId: string): string => `manor.account:${accountId}`

/** The account as this device last loaded it, so a returning visit renders before the profile round trip. */
export function cachedAccount(accountId: string, email: string): ManorAccount | null {
  const cached = localStorage.getItem(accountCacheKey(accountId))
  if (cached === null) return null
  return z.object({ id: z.literal(accountId), email: z.literal(email), name: z.string(), timezone: z.string() }).parse(JSON.parse(cached))
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
