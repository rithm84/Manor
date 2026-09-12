/* Polls the SimplifyJobs Summer2026 internship list (PRD §7.6: the
   listings.json on the dev branch, ETag-polled, never the README) and
   upserts visible listings into job_listings. Invoked by pg_cron with the
   service role key; an unchanged ETag makes the run a no-op. */

import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { z } from 'npm:zod@4.5.0'

import { hasUnitedStatesLocation, isHardwareCategory } from './usLocations.ts'

const LISTINGS_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json'
const listingSchema = z.object({
 id: z.string().min(1), company_name: z.string(), title: z.string(), locations: z.array(z.string()).optional(),
 url: z.string().url(), active: z.boolean(), is_visible: z.boolean(), date_posted: z.number().int().nonnegative(),
 terms: z.array(z.string()).optional(), category: z.string().optional()
})
type SimplifyListing = z.infer<typeof listingSchema>
interface ListingRow { id: string; company: string; role: string; locations: string; url: string; posted: string; active: boolean; term: string; category: string; updated_at: string }
function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (value === undefined || value === '') {
    throw new Error(`jobs-ingest is missing required secret ${name}`)
  }
  return value
}

function json(body: Record<string, string | number | boolean | null>, status: number): Response {
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

function rowOf(listing: SimplifyListing): ListingRow {
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

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
 for (let attempt=1;attempt<=3;attempt+=1) {
  try {
   const response=await fetch(url,{headers,signal:AbortSignal.timeout(30000)})
   if (response.status>=500 && attempt<3) { await response.body?.cancel(); console.warn('job_feed_retry',{attempt,status:response.status}) }
   else return response
  } catch (error) {
   if (!(error instanceof TypeError || error instanceof DOMException) || attempt===3) throw error
   console.warn('job_feed_retry',{attempt,reason:error.name})
  }
  await new Promise<void>((resolve)=>setTimeout(resolve,attempt*500))
 }
 throw new Error('Job feed retries exhausted')
}
async function handleRequest(request: Request): Promise<Response> {
 if(request.method!=='POST') return json({error:'jobs-ingest only accepts POST'},405)
 const secret=requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
 if(request.headers.get('x-manor-worker-secret')!==requiredEnv('MANOR_WORKER_SECRET')) return json({error:'Worker authorization required'},401)
 const client=createClient(requiredEnv('SUPABASE_URL'),secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:meta,error:metaError}=await client.from('job_feed_meta').select('etag').eq('id',1).single()
 if(metaError) throw new Error(`Job feed metadata read failed: ${metaError.message}`)
 const parsedMeta=z.object({etag:z.string().nullable()}).parse(meta)
 const headers: Record<string,string>={}
 if(parsedMeta.etag!==null)headers['if-none-match']=parsedMeta.etag
 const response=await fetchWithRetry(LISTINGS_URL,headers)
 if(response.status===304)return json({status:'unchanged'},200)
 if(!response.ok)throw new Error(`GitHub listings fetch failed: HTTP ${response.status}`)
 const listings=z.array(listingSchema).max(100000).parse(await response.json())
 const kept=listings.filter((listing)=>listing.is_visible && listing.active && !isHardwareCategory(listing.category??'') && hasUnitedStatesLocation(listing.locations??[]) && hasCurrentOrFutureTerm(listing.terms??[])).map(rowOf)
 for(let attempt=1;attempt<=3;attempt+=1){
  const {data,error}=await client.rpc('manor_replace_job_feed',{p_etag:response.headers.get('etag'),p_expected_etag:parsedMeta.etag,p_rows:kept})
  if(!error)return Response.json(data)
  if(attempt===3 || !['57014','40001','40P01'].includes(error.code))throw new Error(`Atomic job feed commit failed: ${error.code} ${error.message}`)
  console.warn('job_feed_commit_retry',{attempt,code:error.code})
  await new Promise<void>((resolve)=>setTimeout(resolve,attempt*500))
 }
 throw new Error('Job feed commit retries exhausted')

}
Deno.serve(async (request: Request): Promise<Response> => {
 try { return await handleRequest(request) }
 catch (error) {
  if (!(error instanceof Error)) throw error
  console.error('job_feed_failed',{name:error.name,message:error.message})
  return Response.json({error:error.name,message:error.message},{status:500})
 }
})
