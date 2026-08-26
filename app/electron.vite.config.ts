import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

import { browserBridgePlugin } from './src/main/devBridgePlugin'

/* Client-safe configuration baked into packaged builds so a shared Manor.app
   works without a local .env.local. ONLY publishable values belong here: the
   Supabase URL + anon key are public by design (RLS is the boundary), and
   Google treats desktop-client OAuth credentials as non-confidential.
   Server keys, the X client secret, and OPENAI keys must never join. */
const BAKED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
] as const

function bakedEnv(): Record<string, string> {
  const envPath = join(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return {}
  const values: Record<string, string> = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if ((BAKED_KEYS as readonly string[]).includes(key) && value !== '') {
      values[key] = value
    }
  }
  return values
}

export default defineConfig({
  main: {
    define: {
      __MANOR_BAKED_ENV__: JSON.stringify(bakedEnv())
    }
  },
  preload: {},
  renderer: {
    server:
      process.env.PORT === undefined
        ? undefined
        : { port: Number(process.env.PORT), strictPort: true },
    plugins: [react(), browserBridgePlugin()]
  }
})
