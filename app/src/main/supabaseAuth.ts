import { join } from 'node:path'
import { app } from 'electron'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { AccountInfo } from '../shared/account'
import type { BridgeChannelHandler } from './bridgeChannels'
import { accountOf, createAccountChannels, createCloudClient } from './supabaseCore'
import type { ManorCloudConfig } from './supabaseCore'

/** Packaged builds must provide SUPABASE_* via process.env; dev reads the
    repository root .env.local (app.getAppPath() is <repo>/app in dev). */
function cloudConfig(): ManorCloudConfig {
  return {
    envRoot: app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), '..'),
    sessionFile: join(app.getPath('userData'), 'supabase-session.json')
  }
}

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (client === null) {
    client = createCloudClient(cloudConfig())
  }
  return client
}

export async function currentAccount(): Promise<AccountInfo | null> {
  return accountOf(supabase())
}

export function electronAccountChannels(): Record<string, BridgeChannelHandler> {
  return createAccountChannels(cloudConfig(), supabase)
}
