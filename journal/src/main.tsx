import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import '@fontsource-variable/outfit'
import '@fontsource-variable/dm-sans'
import './styles.css'
import { App } from './App'

const config = z.object({ url: z.url(), key: z.string().min(20), journalOrigin: z.url(), manorOrigin: z.url() }).parse({
  url: import.meta.env.VITE_JOURNAL_SUPABASE_URL, key: import.meta.env.VITE_JOURNAL_SUPABASE_PUBLISHABLE_KEY,
  journalOrigin: import.meta.env.VITE_JOURNAL_ORIGIN, manorOrigin: import.meta.env.VITE_MANOR_ORIGIN
})
if (new URL(config.journalOrigin).origin !== window.location.origin || new URL(config.manorOrigin).origin === window.location.origin) throw new Error('Journal must be served on its configured separate browser origin')
if (window.top !== window.self) throw new Error('Journal cannot be embedded in another application')
const client = createClient(config.url, config.key, { auth: { flowType: 'pkce', storageKey: 'manor-journal-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
const container = document.getElementById('root')
if (container === null) throw new Error('Journal root element is missing')
createRoot(container).render(<StrictMode><App client={client} /></StrictMode>)
