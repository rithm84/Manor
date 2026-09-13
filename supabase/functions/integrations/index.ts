import {adminClient,corsHeaders,identity,authorizeConnection,store,z,credentialsSchema,type Json} from '../_shared/integrationRuntime.ts'
import {beginOAuth,finishOAuth} from '../_shared/integrationOAuth.ts'
import {syncX} from '../_shared/integrationSync.ts'

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
  await authorizeConnection(request,true)
  if(action==='oauth_start') return reply(200,await beginOAuth(client,owner,z.enum(['google','x']).parse(input.provider),z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(input.codeChallenge),z.string().parse(request.headers.get('origin'))))
  if(action==='oauth_complete') {
   await finishOAuth(client,owner,z.string().min(1).max(4096).parse(input.code),z.string().min(32).max(200).parse(input.state),z.string().min(43).max(128).parse(input.verifier))
   return reply(200,{committed:true})
  }
  if(action==='calendar_visibility') {
   return reply(200,await store(client,'visibility',owner,{accountId:z.string().parse(input.accountId),calendarId:z.string().parse(input.calendarId),enabled:z.boolean().parse(input.enabled)}))
  }
  if(action==='calendar_disconnect' || action==='x_disconnect') return reply(200,await store(client,'disconnect',owner,{provider:action==='calendar_disconnect'?'google':'x',accountId:action==='calendar_disconnect'?z.string().parse(input.accountId):null}))
  if(action==='x_sync') {
   const accounts=z.array(credentialsSchema).parse(await store(client,'credentials',owner,{provider:'x'}))
   const account=accounts[0]
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
  return reply(400,{error:'Unsupported connection operation'})
 }catch(error){console.warn('Integration request failed',{owner,error:error instanceof Error?error.message:String(error)});return reply(400,{error:error instanceof Error?error.message:String(error)})}
})
