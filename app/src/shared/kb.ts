/** Knowledge base entries: X bookmarks and Alfred screen captures, normalized
    by terra server-side (see supabase/functions/normalize-capture). */

export type KbSource = 'x_bookmark' | 'capture'
export type KbStatus = 'pending' | 'normalized' | 'failed'

export interface KbEntry {
  id: string
  source: KbSource
  url: string | null
  title: string | null
  author: string | null
  summary: string | null
  contentMd: string | null
  status: KbStatus
  error: string | null
  capturedAt: string
  normalizedAt: string | null
  screenshotPath: string | null
}

export interface KbApi {
  list: () => Promise<readonly KbEntry[]>
  remove: (entryId: string) => Promise<void>
  /** Short-lived signed URL for the entry's screenshot; null when it has none. */
  screenshotUrl: (entryId: string) => Promise<string | null>
  /** Re-runs normalization for a pending or failed entry. */
  normalize: (entryId: string) => Promise<void>
}
