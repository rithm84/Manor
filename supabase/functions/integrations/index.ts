import { calendarDays } from '../_shared/calendarDays.ts'
import {adminClient,corsHeaders,identity,authorizeConnection,store,z,credentialsSchema,type Json} from '../_shared/integrationRuntime.ts'
import {beginOAuth,finishOAuth} from '../_shared/integrationOAuth.ts'
import {syncX,storedEventSchema} from '../_shared/integrationSync.ts'

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
  if(raw.length>10000) return reply(413,{error:'Connection request is too large'})
  const input=z.record(z.string(),z.json()).parse(JSON.parse(raw))
  const action=z.string().parse(input.action)
  await authorizeConnection(request,!['calendar_accounts','calendars','calendar_events','x_status'].includes(action))
  if(action==='oauth_start') return reply(200,await beginOAuth(client,owner,z.enum(['google','x']).parse(input.provider),z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(input.codeChallenge),z.string().parse(request.headers.get('origin'))))
  if(action==='oauth_complete') {
   await finishOAuth(client,owner,z.string().min(1).max(4096).parse(input.code),z.string().min(32).max(200).parse(input.state),z.string().min(43).max(128).parse(input.verifier))
   return reply(200,{committed:true})
  }
  if(action==='calendar_accounts') {
   const result=await client.from('calendar_accounts').select('id,email,connected_at').eq('user_id',owner).order('connected_at')
   if(result.error) throw result.error
   return reply(200,z.array(z.object({id:z.string(),email:z.string(),connected_at:z.string()})).parse(result.data).map(account=>({id:account.id,email:account.email,connectedAt:account.connected_at})))
  }
  if(action==='calendars') {
   const result=await client.from('calendars').select('id,account_id,name,color,enabled').eq('user_id',owner).order('name')
   if(result.error) throw result.error
   return reply(200,z.array(z.object({id:z.string(),account_id:z.string(),name:z.string(),color:z.string().nullable(),enabled:z.boolean()})).parse(result.data).map(calendar=>({id:calendar.id,accountId:calendar.account_id,name:calendar.name,colorId:calendar.color,enabled:calendar.enabled})))
  }
  if(action==='calendar_visibility') {
   return reply(200,await store(client,'visibility',owner,{accountId:z.string().parse(input.accountId),calendarId:z.string().parse(input.calendarId),enabled:z.boolean().parse(input.enabled)}))
  }
  if(action==='calendar_disconnect' || action==='x_disconnect') return reply(200,await store(client,'disconnect',owner,{provider:action==='calendar_disconnect'?'google':'x',accountId:action==='calendar_disconnect'?z.string().parse(input.accountId):null}))
  if(action==='x_status' || action==='x_sync') {
   const accounts=z.array(credentialsSchema).parse(await store(client,'credentials',owner,{provider:'x'}))
   const account=accounts[0]
   if(action==='x_status') return reply(200,{connected:account!==undefined,username:account?.username??null,connectedAt:account?.connected_at??null})
   if(account===undefined) throw new Error('Connect your X account before syncing bookmarks')
   const checkpoint=z.object({page_token:z.string().nullable().optional()}).parse(await store(client,'claim_job',owner,{provider:'x',accountId:account.account_id}))
   try {
    const result=await syncX(client,account,checkpoint.page_token??null)
    await store(client,'job_result',owner,{provider:'x',accountId:account.account_id,pageToken:result.pageToken,error:null})
    return reply(200,{added:result.added})
   } catch(error) {
    await store(client,'job_result',owner,{provider:'x',accountId:account.account_id,error:error instanceof Error?error.message:String(error)})
    throw error
   }
  }
  if(action==='calendar_events') {
   const dates=z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(14).parse(input.dates)
   const ordered=[...dates].sort()
   const earliest=new Date(ordered[0]+'T00:00:00Z');earliest.setUTCDate(earliest.getUTCDate()-1)
   const latest=new Date(ordered[ordered.length-1]+'T00:00:00Z');latest.setUTCDate(latest.getUTCDate()+2)
   const [profile,calendars,events]=await Promise.all([
    client.from('profiles').select('timezone').eq('user_id',owner).single(),
    client.from('calendars').select('id,account_id,color').eq('user_id',owner).eq('enabled',true),
    client.from('calendar_events').select('*').eq('user_id',owner).or(`and(all_day.eq.true,start_date.lte.${ordered[ordered.length-1]},end_date.gt.${ordered[0]}),and(all_day.eq.false,starts_at.lt.${latest.toISOString()},ends_at.gt.${earliest.toISOString()})`).limit(5001)
   ])
   if(profile.error) throw profile.error
   if(calendars.error) throw calendars.error
   if(events.error) throw events.error
   const timezone=z.object({timezone:z.string()}).parse(profile.data).timezone
   const enabled=z.array(z.object({id:z.string(),account_id:z.string(),color:z.string().nullable()})).parse(calendars.data)
   const records=z.array(storedEventSchema).parse(events.data)
   if(records.length>5000) throw new Error('This date range contains more than 5,000 events. Choose fewer dates.')
   return reply(200,records.flatMap(event=>{
    const calendar=enabled.find(item=>item.id===event.calendar_id && item.account_id===event.account_id)
    return calendar===undefined?[]:calendarDays(event,dates,timezone,calendar.color)
   }))
  }
  return reply(400,{error:'Unsupported connection operation'})
 }catch(error){console.warn('Integration request failed',{owner,error:error instanceof Error?error.message:String(error)});return reply(400,{error:error instanceof Error?error.message:String(error)})}
})
