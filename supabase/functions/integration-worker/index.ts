import {adminClient,required,store,z,credentialsSchema} from '../_shared/integrationRuntime.ts'
import {syncGoogle,syncX} from '../_shared/integrationSync.ts'

Deno.serve(async(request:Request):Promise<Response>=>{
 if(request.method!=='POST' || request.headers.get('x-manor-worker-secret')!==required('MANOR_WORKER_SECRET')) return new Response('Unauthorized',{status:401})
 const client=adminClient()
 const jobs=z.array(z.object({user_id:z.uuid(),provider:z.enum(['google','x']),account_id:z.string(),cursor:z.number().int(),page_token:z.string().nullable()})).parse(await store(client,'claim_jobs',null,{}))
 let completed=0;let failed=0
 for(const job of jobs) {
  try {
   const credentials=z.array(credentialsSchema).parse(await store(client,'credentials',job.user_id,{provider:job.provider,accountId:job.account_id}))[0]
   if(credentials===undefined) throw new Error('The connection no longer exists')
   const result=job.provider==='google'?await syncGoogle(client,credentials,job.cursor):await syncX(client,credentials,job.page_token)
   await store(client,'job_result',job.user_id,{provider:job.provider,accountId:job.account_id,...result,error:null})
   completed++
  }catch(error){
   const detail=error instanceof Error?error.message:String(error)
   console.warn('Integration sync failed',{owner:job.user_id,provider:job.provider,error:detail})
   await store(client,'job_result',job.user_id,{provider:job.provider,accountId:job.account_id,error:detail})
   failed++
  }
 }
 return Response.json({completed,failed})
})
