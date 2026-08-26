import type { SupabaseClient } from '@supabase/supabase-js'

import type { KbEntry } from '../shared/kb'
import type { BridgeChannelHandler } from './bridgeChannels'
import { accountOf } from './supabaseCore'

interface KbRow {
  id: string
  source: KbEntry['source']
  url: string | null
  title: string | null
  author: string | null
  summary: string | null
  content_md: string | null
  status: KbEntry['status']
  error: string | null
  captured_at: string
  normalized_at: string | null
  screenshot_path: string | null
}

function entryOf(row: KbRow): KbEntry {
  return {
    id: row.id,
    source: row.source,
    url: row.url,
    title: row.title,
    author: row.author,
    summary: row.summary,
    contentMd: row.content_md,
    status: row.status,
    error: row.error,
    capturedAt: row.captured_at,
    normalizedAt: row.normalized_at,
    screenshotPath: row.screenshot_path
  }
}

function requireEntryId(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError('A knowledge base entry id is required')
  }
  return value
}

async function requireSignedIn(client: SupabaseClient): Promise<void> {
  if ((await accountOf(client)) === null) {
    throw new Error('Sign in to Manor to use the knowledge base')
  }
}

export function createKbChannels(
  clientOf: () => SupabaseClient
): Record<string, BridgeChannelHandler> {
  return {
    'kb:list': async () => {
      const client = clientOf()
      await requireSignedIn(client)
      const { data, error } = await client
        .from('kb_entries')
        .select(
          'id, source, url, title, author, summary, content_md, status, error, captured_at, normalized_at, screenshot_path'
        )
        .order('captured_at', { ascending: false })
      if (error !== null) throw new Error(`Could not list the knowledge base: ${error.message}`)
      return (data as KbRow[]).map(entryOf)
    },

    'kb:remove': async (args) => {
      const entryId = requireEntryId(args[0])
      const client = clientOf()
      await requireSignedIn(client)
      const { data, error } = await client
        .from('kb_entries')
        .delete()
        .eq('id', entryId)
        .select('screenshot_path')
      if (error !== null) throw new Error(`Could not remove entry ${entryId}: ${error.message}`)
      const screenshotPath = (data as { screenshot_path: string | null }[])[0]?.screenshot_path
      if (screenshotPath !== null && screenshotPath !== undefined) {
        const removed = await client.storage.from('captures').remove([screenshotPath])
        if (removed.error !== null) {
          console.warn('Capture screenshot removal failed', {
            entryId,
            error: removed.error.message
          })
        }
      }
      return null
    },

    'kb:screenshot-url': async (args) => {
      const entryId = requireEntryId(args[0])
      const client = clientOf()
      await requireSignedIn(client)
      const { data, error } = await client
        .from('kb_entries')
        .select('screenshot_path')
        .eq('id', entryId)
        .single()
      if (error !== null) throw new Error(`Could not load entry ${entryId}: ${error.message}`)
      const path = (data as { screenshot_path: string | null }).screenshot_path
      if (path === null) return null
      const signed = await client.storage.from('captures').createSignedUrl(path, 600)
      if (signed.error !== null) {
        throw new Error(`Could not sign the screenshot for ${entryId}: ${signed.error.message}`)
      }
      return signed.data.signedUrl
    },

    'kb:normalize': async (args) => {
      const entryId = requireEntryId(args[0])
      const client = clientOf()
      await requireSignedIn(client)
      const { error } = await client.functions.invoke('normalize-capture', {
        body: { entryId }
      })
      if (error !== null) {
        throw new Error(`Normalization failed for ${entryId}: ${error.message}`)
      }
      return null
    }
  }
}
