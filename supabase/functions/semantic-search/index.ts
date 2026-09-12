import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {adminClient,corsHeaders,identity,required,z} from '../_shared/integrationRuntime.ts'
import {tokenCount} from '../_shared/embeddingText.ts'
import {embed} from '../_shared/embeddings.ts'
Deno.serve(async(request:Request):Promise<Response>=>{
 let headers:HeadersInit
 try{headers=corsHeaders(request)}catch{return new Response('Origin is not allowed',{status:403})}
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers})
 if(request.method!=='POST') return new Response('Use POST',{status:405,headers})
 const reply=(value:object,status:number):Response=>new Response(JSON.stringify(value),{status,headers})
 let owner:string
 try{owner=await identity(adminClient(),request)}catch(error){return reply({error:error instanceof Error?error.message:String(error)},401)}
 try {
  const raw=await request.text();if(raw.length>16000) throw new Error('Search query is too long')
  const input=z.object({query:z.string().trim().min(1),limit:z.number().int().min(1).max(30),modules:z.array(z.enum(['notes','knowledge'])).min(1).optional()}).parse(JSON.parse(raw))
  if(tokenCount(input.query)>1500) throw new Error('Search query exceeds 1,500 tokens. Use a shorter query.')
  const client=createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:request.headers.get('authorization')!}},auth:{persistSession:false,autoRefreshToken:false}})
  const claims=await client.auth.getClaims(request.headers.get('authorization')!.slice(7))
  if(claims.error) throw claims.error
  if(claims.data?.claims.client_id) {
   const permission=await client.rpc('manor_mcp_access')
   if(permission.error) throw permission.error
   if(!z.object({read:z.boolean()}).parse(permission.data).read) return reply({error:'This agent is not authorized to search'},403)
  }
  const embedded=await embed([input.query])
  const usage=await adminClient().rpc('manor_embedding_work',{action:'usage',p:{id:crypto.randomUUID(),user_id:owner,source:'query',total_tokens:embedded.totalTokens}})
  if(usage.error) throw usage.error
  const vector=embedded.vectors[0]
  const result=await client.rpc('manor_semantic_search',{query_vector:JSON.stringify(vector),result_limit:input.limit,source_modules:input.modules?.map(module=>module==='notes'?'note':'kb')??['note','kb']})
  if(result.error) throw result.error
  return reply(z.array(z.record(z.string(),z.json())).parse(result.data),200)
 }catch(error){return reply({error:error instanceof Error?error.message:String(error)},400)}
})
