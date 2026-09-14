// Course calendar feed: saves the Canvas feed link for an account and reads what is due on demand. Nothing from the feed is stored.
import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {adminClient,authorizeConnection,corsHeaders,identity,required,z,type Json} from '../_shared/integrationRuntime.ts'
import {courseItems,itemsBetween,localDate,parseIcs,type CourseFeedItem} from '../_shared/icsFeed.ts'

const MAX_FEED_BYTES=5*1024*1024
const DEFAULT_WINDOW_DAYS=14
const MAX_WINDOW_DAYS=60
const MAX_ITEMS=200
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

async function feedRow(client:ReturnType<typeof adminClient>,action:string,owner:string,input:Record<string,Json>):Promise<Json>{
 const result=await client.rpc('manor_course_feed',{p_action:action,p_owner:owner,p_input:input})
 if(result.error) throw new Error(`Course feed storage ${action}: ${result.error.message}`)
 return z.json().parse(result.data)
}

/** Only a person's own session manages the link; agents read through the events action. */
async function requirePersonSession(request:Request):Promise<void>{
 const token=request.headers.get('authorization')!.slice(7)
 const client=createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}})
 const claims=await client.auth.getClaims(token)
 if(claims.error) throw claims.error
 if(claims.data?.claims.client_id) throw new Error('Manage the course calendar link from Manor Settings')
}

function feedUrl(value:string):URL{
 let url:URL
 try{url=new URL(value.trim())}catch{throw new Error('Paste the full calendar feed link, starting with https://')}
 if(url.protocol!=='https:') throw new Error('The calendar feed link must use https')
 if(!url.pathname.endsWith('.ics')) throw new Error('The link should end in .ics; copy it from Calendar, then Calendar feed, in Canvas')
 return url
}

async function fetchItems(url:string,timeZone:string):Promise<CourseFeedItem[]>{
 const response=await fetch(url,{headers:{accept:'text/calendar, text/plain;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(15000)})
 if(!response.ok) throw new Error(`The calendar feed returned ${response.status}. Copy a fresh link from Canvas if it stopped working.`)
 const text=await response.text()
 if(text.length>MAX_FEED_BYTES) throw new Error('The calendar feed is larger than 5 MB')
 return courseItems(parseIcs(text),timeZone)
}

async function accountTimeZone(client:ReturnType<typeof adminClient>,owner:string):Promise<string>{
 const profile=await client.from('profiles').select('timezone').eq('user_id',owner).maybeSingle()
 if(profile.error) throw new Error(`Reading the account time zone: ${profile.error.message}`)
 return z.object({timezone:z.string().nullable()}).parse(profile.data??{timezone:null}).timezone??'UTC'
}

function window(timeZone:string,from:string|undefined,to:string|undefined):{from:string;to:string}{
 const start=from??localDate(new Date(),timeZone)
 const end=to??localDate(new Date(Date.parse(start+'T00:00:00Z')+DEFAULT_WINDOW_DAYS*86_400_000),'UTC')
 if(end<start) throw new Error('The end date is before the start date')
 if((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86_400_000>MAX_WINDOW_DAYS) throw new Error(`Read at most ${MAX_WINDOW_DAYS} days at a time`)
 return {from:start,to:end}
}

Deno.serve(async(request:Request):Promise<Response>=>{
 let headers:HeadersInit
 try{headers=corsHeaders(request)}catch{return new Response('Origin is not allowed',{status:403})}
 const reply=(status:number,value:Json):Response=>new Response(JSON.stringify(value),{status,headers})
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers})
 if(request.method!=='POST') return reply(405,{error:'Use POST'})
 const client=adminClient()
 let owner:string
 try{owner=await identity(client,request)}catch(error){return reply(401,{error:error instanceof Error?error.message:String(error)})}
 try {
  const raw=await request.text()
  if(raw.length>10000) return reply(413,{error:'Request is too large'})
  const input=z.object({action:z.enum(['connect','disconnect','events']),url:z.string().max(2048).optional(),from:dateSchema.optional(),to:dateSchema.optional()}).parse(JSON.parse(raw))
  if(input.action==='connect'){
   await requirePersonSession(request)
   const url=feedUrl(z.string().parse(input.url))
   const timeZone=await accountTimeZone(client,owner)
   const {from,to}=window(timeZone,undefined,undefined)
   const count=itemsBetween(await fetchItems(url.toString(),timeZone),from,to).length
   await feedRow(client,'connect',owner,{url:url.toString(),host:url.host,count})
   return reply(200,{connected:true,host:url.host,count})
  }
  if(input.action==='disconnect'){
   await requirePersonSession(request)
   await feedRow(client,'disconnect',owner,{})
   return reply(200,{connected:false})
  }
  await authorizeConnection(request,false)
  const saved=z.object({url:z.string(),host:z.string()}).nullable().parse(await feedRow(client,'read',owner,{}))
  if(saved===null) return reply(400,{error:'No course calendar is connected. Paste the Canvas feed link in Manor Settings, under Connections.'})
  const timeZone=await accountTimeZone(client,owner)
  const {from,to}=window(timeZone,input.from,input.to)
  let items:CourseFeedItem[]
  try{items=itemsBetween(await fetchItems(saved.url,timeZone),from,to)}
  catch(error){
   await feedRow(client,'checked',owner,{count:null,error:error instanceof Error?error.message:String(error)})
   throw error
  }
  await feedRow(client,'checked',owner,{count:items.length,error:null})
  return reply(200,{from,to,timezone:timeZone,host:saved.host,total:items.length,items:items.slice(0,MAX_ITEMS).map((item)=>({...item}))})
 }catch(error){console.warn('Course feed request failed',{owner,error:error instanceof Error?error.message:String(error)});return reply(400,{error:error instanceof Error?error.message:String(error)})}
})
