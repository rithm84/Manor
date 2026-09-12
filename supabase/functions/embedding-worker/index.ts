import {adminClient,required,z,type Json} from '../_shared/integrationRuntime.ts'
import {textChunkBatch} from '../_shared/embeddingText.ts'
import {embed} from '../_shared/embeddings.ts'
const jobSchema=z.object({user_id:z.uuid(),source:z.enum(['note','kb']),source_id:z.string(),revision:z.number().int(),next_chunk:z.number().int(),next_offset:z.number().int(),content:z.string()})
Deno.serve(async(request:Request):Promise<Response>=>{
 if(request.method!=='POST') return new Response('Use POST',{status:405})
 if(request.headers.get('x-manor-worker-secret')!==required('MANOR_WORKER_SECRET')) return new Response('Unauthorized',{status:401})
 const client=adminClient()
 const work=async(action:string,p:Record<string,Json>):Promise<Json>=>{
  const result=await client.rpc('manor_embedding_work',{action,p});if(result.error) throw result.error;return z.json().parse(result.data)
 }
 const claimed=await work('claim',{})
 if(claimed===null) return Response.json({processed:0})
 const job=jobSchema.parse(claimed)
 const key={user_id:job.user_id,source:job.source,source_id:job.source_id,revision:job.revision}
 try {
  const {chunks:batch,nextOffset}=textChunkBatch(job.content,job.next_offset,8)
  const embedded=batch.length===0?{vectors:[],totalTokens:0}:await embed(batch)
  if(batch.length>0) await work('usage',{...key,id:crypto.randomUUID(),total_tokens:embedded.totalTokens})
  const vectors=embedded.vectors
  const next=job.next_chunk+batch.length
  const result=await work('commit',{...key,next_chunk:next,next_offset:nextOffset,complete:nextOffset===job.content.length,chunks:batch.map((content,index)=>({index:job.next_chunk+index,content,embedding:JSON.stringify(vectors[index])}))})
  return Response.json({processed:batch.length,result})
 }catch(error){
  const message=error instanceof Error?error.message:String(error)
  console.warn('Embedding job failed',{source:job.source,sourceId:job.source_id,revision:job.revision,error:message})
  await work('fail',{...key,error:message})
  return Response.json({error:message},{status:502})
 }
})
