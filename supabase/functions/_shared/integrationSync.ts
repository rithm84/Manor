import { googleCalendars } from './googleCalendars.ts'
import { z,store,providerJson,accessToken,ProviderError,type Credentials,type IntegrationClient } from './integrationRuntime.ts'
import { kbRowOf } from './xBookmarks.ts'

const eventTime=z.object({date:z.string().optional(),dateTime:z.string().optional(),timeZone:z.string().optional()})
const event=z.object({id:z.string(),status:z.string().optional(),summary:z.string().optional(),start:eventTime.optional(),end:eventTime.optional()})
const eventsPage=z.object({items:z.array(event).optional(),nextPageToken:z.string().optional(),nextSyncToken:z.string().optional()})

/** One page for every connected calendar per minute; calendars beyond the owner's twelve are skipped, never fatal. */
export async function syncGoogle(client:IntegrationClient,credentials:Credentials,cursor:number):Promise<{cursor:number}> {
 const token=await accessToken(client,credentials)
 const headers={Authorization:'Bearer '+token}
 const listing=z.object({skipped:z.number().int()}).parse(await store(client,'calendar_list',credentials.user_id,{accountId:credentials.account_id,calendars:await googleCalendars(token)}))
 if(listing.skipped>0) console.warn('Calendar limit reached; new calendars were not added',{owner:credentials.user_id,accountId:credentials.account_id,skipped:listing.skipped})
 const listed=await client.from('calendars').select('id').eq('user_id',credentials.user_id).eq('account_id',credentials.account_id).order('id')
 if(listed.error) throw listed.error
 const calendars=z.array(z.object({id:z.string()})).parse(listed.data)
 if(calendars.length===0) return {cursor:0}
 const sliceSize=calendars.length
 for(let offset=0;offset<sliceSize;offset++) {
  const calendar=calendars[(cursor+offset)%calendars.length]
  let checkpoint=z.object({sync_token:z.string().nullable().optional(),page_token:z.string().nullable().optional(),window_start:z.string().optional(),window_end:z.string().optional(),refreshed_at:z.string().optional()}).parse(await store(client,'calendar_state',credentials.user_id,{accountId:credentials.account_id,calendarId:calendar.id}))
  if(checkpoint.refreshed_at && Date.now()-Date.parse(checkpoint.refreshed_at)>30*86400000) {
   await store(client,'calendar_reset',credentials.user_id,{accountId:credentials.account_id,calendarId:calendar.id})
   checkpoint={}
  }
  const windowStart=checkpoint.window_start??new Date(Date.now()-90*86400000).toISOString()
  const windowEnd=checkpoint.window_end??new Date(Date.now()+365*86400000).toISOString()
  const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`)
  url.searchParams.set('maxResults','250');url.searchParams.set('singleEvents','true');url.searchParams.set('showDeleted','true')
  if(checkpoint.sync_token) url.searchParams.set('syncToken',checkpoint.sync_token)
  else {url.searchParams.set('timeMin',windowStart);url.searchParams.set('timeMax',windowEnd)}
  if(checkpoint.page_token) url.searchParams.set('pageToken',checkpoint.page_token)
  let page:z.infer<typeof eventsPage>
  try {page=await providerJson(url.toString(),{headers},eventsPage)}
  catch(error) {
   if(error instanceof ProviderError && error.status===410) {
    console.warn('Google requested a full calendar resync',{calendarId:calendar.id})
    await store(client,'calendar_reset',credentials.user_id,{accountId:credentials.account_id,calendarId:calendar.id})
    continue
   }
   throw error
  }
  for(const item of page.items??[]) if(item.status!=='cancelled' && (!item.start || !item.end || (!item.start.date && !item.start.dateTime))) throw new Error(`Google event ${item.id} is missing its date or time`)
  await store(client,'calendar_page',credentials.user_id,{accountId:credentials.account_id,calendarId:calendar.id,windowStart,windowEnd,events:page.items??[],syncToken:page.nextSyncToken??checkpoint.sync_token??null,pageToken:page.nextPageToken??null})
 }
 return {cursor:(cursor+sliceSize)%calendars.length}
}

const xPost=z.object({id:z.string(),text:z.string(),author_id:z.string(),created_at:z.string().optional(),entities:z.object({urls:z.array(z.object({url:z.string(),expanded_url:z.string().optional()})).optional()}).optional()})
const xBookmarks=z.object({data:z.array(xPost).optional(),includes:z.object({users:z.array(z.object({id:z.string(),username:z.string(),name:z.string()})).optional()}).optional(),meta:z.object({next_token:z.string().optional()}).optional()})
export async function syncX(client:IntegrationClient,credentials:Credentials,pageToken:string|null):Promise<{added:number;pageToken:string|null}> {
 const token=await accessToken(client,credentials)
 const url=new URL(`https://api.x.com/2/users/${encodeURIComponent(credentials.account_id)}/bookmarks`)
 url.search=new URLSearchParams({max_results:'100','tweet.fields':'author_id,created_at,entities','expansions':'author_id','user.fields':'name,username'}).toString()
 if(pageToken) url.searchParams.set('pagination_token',pageToken)
 const page=await providerJson(url.toString(),{headers:{Authorization:'Bearer '+token}},xBookmarks)
 const users=new Map((page.includes?.users??[]).map(user=>[user.id,user]))
 const entries=(page.data??[]).map(post=>kbRowOf(credentials.user_id,post,users.get(post.author_id),new Date().toISOString()))
 const result=z.object({added:z.number().int()}).parse(await store(client,'x_page',credentials.user_id,{entries:z.json().parse(entries)}))
 return {added:result.added,pageToken:page.meta?.next_token??null}
}

export const storedEventSchema=z.object({id:z.string(),account_id:z.string(),calendar_id:z.string(),title:z.string(),starts_at:z.string().nullable(),ends_at:z.string().nullable(),start_date:z.string().nullable(),end_date:z.string().nullable(),all_day:z.boolean()})
