/* Electron-free Supabase plumbing, shared by the main process and the dev
   browser bridge so sign-in works identically in both runtimes. */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { AccountInfo } from '../shared/account'
import { parseSignInMutation } from '../shared/account'
import type { BridgeChannelHandler } from './bridgeChannels'

export interface ManorCloudConfig {
  /** Directory holding .env.local (the repository root in dev). */
  envRoot: string
  /** JSON file the auth session persists to. */
  sessionFile: string
}

export interface SupabaseEnv {
  url: string
  anonKey: string
}

function parseEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (value !== '') values.set(key, value)
  }
  return values
}

export function envValueFrom(envRoot: string, name: string): string | null {
  const fromProcess = process.env[name]
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  const envPath = join(envRoot, '.env.local')
  if (existsSync(envPath)) return parseEnvFile(envPath).get(name) ?? null
  return null
}

export function loadSupabaseEnvFrom(envRoot: string): SupabaseEnv {
  const url = envValueFrom(envRoot, 'SUPABASE_URL')
  const anonKey = envValueFrom(envRoot, 'SUPABASE_ANON_KEY')
  const missing = [url === null ? 'SUPABASE_URL' : null, anonKey === null ? 'SUPABASE_ANON_KEY' : null]
    .filter((name): name is string => name !== null)
  if (url === null || anonKey === null) {
    throw new Error(
      `Supabase configuration is missing ${missing.join(' and ')}. ` +
        'Fill them in .env.local at the repository root.'
    )
  }
  return { url, anonKey }
}

function fileStorage(path: string): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
} {
  const read = (): Record<string, string> => {
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>
  }
  const write = (data: Record<string, string>): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data))
  }
  return {
    getItem: (key) => read()[key] ?? null,
    setItem: (key, value) => write({ ...read(), [key]: value }),
    removeItem: (key) => {
      const data = read()
      delete data[key]
      write(data)
    }
  }
}

export function createCloudClient(config: ManorCloudConfig): SupabaseClient {
  const env = loadSupabaseEnvFrom(config.envRoot)
  return createClient(env.url, env.anonKey, {
    auth: {
      storage: fileStorage(config.sessionFile),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  })
}

export async function signInWith(
  client: SupabaseClient,
  email: string,
  password: string
): Promise<AccountInfo> {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error !== null) {
    throw new Error(`Sign in failed for ${email}: ${error.message}`)
  }
  if (data.user.email === undefined) {
    throw new Error(`Sign in for ${email} returned a user without an email`)
  }
  return { userId: data.user.id, email: data.user.email }
}

export async function signUpWith(
  client: SupabaseClient,
  email: string,
  password: string
): Promise<AccountInfo> {
  const { data, error } = await client.auth.signUp({ email, password })
  if (error !== null) {
    throw new Error(`Account creation failed for ${email}: ${error.message}`)
  }
  // Supabase obfuscates existing emails: the response carries a user but no
  // session. Auto-confirm is on, so a real new account always has a session.
  if (data.session === null || data.user === null || data.user.email === undefined) {
    throw new Error(`An account for ${email} may already exist. Sign in instead.`)
  }
  return { userId: data.user.id, email: data.user.email }
}

export async function signOutWith(client: SupabaseClient, sessionFile: string): Promise<void> {
  const { error } = await client.auth.signOut()
  if (error !== null) {
    throw new Error(`Sign out failed: ${error.message}`)
  }
  rmSync(sessionFile, { force: true })
}

export async function accountOf(client: SupabaseClient): Promise<AccountInfo | null> {
  const { data, error } = await client.auth.getSession()
  if (error !== null) {
    throw new Error(`Could not read the current session: ${error.message}`)
  }
  const user = data.session?.user
  if (user === undefined || user.email === undefined) return null
  return { userId: user.id, email: user.email }
}

/** Account bridge channels, servable over Electron IPC or the dev bridge. */
export function createAccountChannels(
  config: ManorCloudConfig,
  clientOf: () => SupabaseClient
): Record<string, BridgeChannelHandler> {
  return {
    'account:sign-in': (args) => {
      const mutation = parseSignInMutation(args[0])
      return signInWith(clientOf(), mutation.email, mutation.password)
    },
    'account:sign-up': (args) => {
      const mutation = parseSignInMutation(args[0])
      return signUpWith(clientOf(), mutation.email, mutation.password)
    },
    'account:sign-out': () => signOutWith(clientOf(), config.sessionFile),
    'account:current': () => accountOf(clientOf())
  }
}
