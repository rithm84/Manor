/* Polls the SimplifyJobs Summer2026 internship list (PRD §7.6: the
   listings.json on the dev branch, ETag-polled, never the README) and
   upserts visible listings into job_listings. Invoked by pg_cron with the
   service role key; an unchanged ETag makes the run a no-op. */

import { createClient } from 'npm:@supabase/supabase-js@2'

import { hasUnitedStatesLocation, isHardwareCategory } from './usLocations.ts'

const LISTINGS_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json'
const UPSERT_BATCH = 500
const READ_PAGE = 1000

interface SimplifyListing {
  id: string
  company_name: string
  title: string
  locations?: string[]
  url: string
  active: boolean
  is_visible: boolean
  date_posted: number
  terms?: string[]
  category?: string
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`jobs-ingest is missing required secret ${name}`)
  }
  return value
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Sortable key for a hiring cycle, mirroring the app's termSortKey:
    "Summer 2027" -> 2027.2 (Spring 1, Summer 2, Fall 3, Winter 4). */
function termKey(term: string): number | null {
  const year = Number.parseInt(term.replace(/\D+/g, ''), 10)
  if (Number.isNaN(year)) return null
  const season = /spring/i.test(term) ? 1 : /summer/i.test(term) ? 2 : /fall|autumn/i.test(term) ? 3 : /winter/i.test(term) ? 4 : 0
  return year + season / 10
}

/** Fall 2026 and later cycles only (product decision 2026-08-26). */
const TERM_CUTOFF = 2026.3

/** True when the listing names no parseable cycle, or any cycle it names is
    Fall 2026 or later. */
function hasCurrentOrFutureTerm(terms: readonly string[]): boolean {
  const keys = terms.map(termKey).filter((key): key is number => key !== null)
  if (keys.length === 0) return true
  return keys.some((key) => key >= TERM_CUTOFF)
}

function rowOf(listing: SimplifyListing): Record<string, unknown> {
  const terms = listing.terms ?? []
  // Lead with the first cycle that clears the cutoff so a listing naming both
  // Summer 2026 and Summer 2027 reads as the one still worth applying to.
  // "N/A" and other unparseable markers store as blank so the app treats
  // them as no cycle instead of surfacing a literal "N/A" filter chip.
  const leadTerm = terms.find((term) => {
    const key = termKey(term)
    return key !== null && key >= TERM_CUTOFF
  }) ?? ''
  return {
    id: listing.id,
    company: listing.company_name,
    role: listing.title,
    locations: (listing.locations ?? []).join(', '),
    url: listing.url,
    posted: new Date(listing.date_posted * 1000).toISOString().slice(0, 10),
    active: listing.active,
    term: leadTerm,
    category: listing.category ?? '',
    updated_at: new Date().toISOString()
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'jobs-ingest only accepts POST' }, 405)
  }
  const client = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'))

  const { data: meta, error: metaError } = await client
    .from('job_feed_meta')
    .select('etag')
    .eq('id', 1)
    .single()
  if (metaError !== null) {
    return json({ error: `job_feed_meta read failed: ${metaError.message}` }, 500)
  }

  const headers: Record<string, string> = {}
  if (meta.etag !== null) headers['if-none-match'] = meta.etag as string
  const response = await fetch(LISTINGS_URL, { headers })
  if (response.status === 304) {
    return json({ status: 'unchanged' }, 200)
  }
  if (!response.ok) {
    return json({ error: `listings.json fetch failed with status ${response.status}` }, 502)
  }

  const listings = (await response.json()) as SimplifyListing[]
  /* Manor tracks US, non-hardware internships for Fall 2026 and later cycles
     (listings naming no cycle stay). Filtering here rather than at read time
     keeps the shared table small enough to serve whole. */
  const kept = listings.filter(
    (listing) =>
      listing.is_visible &&
      listing.active &&
      !isHardwareCategory(listing.category ?? '') &&
      hasUnitedStatesLocation(listing.locations ?? []) &&
      hasCurrentOrFutureTerm(listing.terms ?? [])
  )
  for (let index = 0; index < kept.length; index += UPSERT_BATCH) {
    const batch = kept.slice(index, index + UPSERT_BATCH).map(rowOf)
    const { error } = await client.from('job_listings').upsert(batch)
    if (error !== null) {
      return json({ error: `job_listings upsert failed at row ${index}: ${error.message}` }, 500)
    }
  }

  /* Anything the source dropped, deactivated, or that now fails the filters
     must leave, or the table keeps serving rows the feed no longer has. */
  const keptIds = new Set(kept.map((listing) => listing.id))
  // PostgREST caps a response at 1000 rows, so page the read-back.
  const storedIds: string[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await client
      .from('job_listings')
      .select('id')
      .range(from, from + READ_PAGE - 1)
    if (error !== null) {
      return json({ error: `job_listings read-back failed: ${error.message}` }, 500)
    }
    const page = data as { id: string }[]
    storedIds.push(...page.map((row) => row.id))
    if (page.length < READ_PAGE) break
  }
  const stale = storedIds.filter((id) => !keptIds.has(id))
  for (let index = 0; index < stale.length; index += UPSERT_BATCH) {
    const batch = stale.slice(index, index + UPSERT_BATCH)
    const { error } = await client.from('job_listings').delete().in('id', batch)
    if (error !== null) {
      return json({ error: `job_listings prune failed at row ${index}: ${error.message}` }, 500)
    }
  }

  const { error: etagError } = await client
    .from('job_feed_meta')
    .update({ etag: response.headers.get('etag'), fetched_at: new Date().toISOString() })
    .eq('id', 1)
  if (etagError !== null) {
    return json({ error: `job_feed_meta update failed: ${etagError.message}` }, 500)
  }

  return json({ status: 'ok', listings: kept.length, pruned: stale.length }, 200)
})
