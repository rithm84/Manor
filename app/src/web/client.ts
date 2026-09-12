import { createClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'
import { readConfiguration } from './config'

export function createManorClient(): ReturnType<typeof createClient> {
  const config = readConfiguration()
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
  })
}

export function createManorQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false }
  } })
}
