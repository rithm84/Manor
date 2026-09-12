import { FileUploadSizeError, validateFileUploadSize } from '../_shared/fileUploadPolicy.ts'
import {adminClient,authorizeConnection,corsHeaders,identity,z} from '../_shared/integrationRuntime.ts'
import {fileClient,readAccessibleFile} from '../_shared/fileAccess.ts'
const prepare=z.object({action:z.literal('prepare'),command_id:z.uuid(),id:z.uuid(),purpose:z.enum(['note','resume','avatar','capture']),parent_id:z.string().nullable().optional(),name:z.string().min(1).max(255),label:z.string().min(1).max(120).nullable().optional(),mime_type:z.string().min(1).max(255),size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})
function requiredStorageEndpoint():string {
 const endpoint=Deno.env.get('SUPABASE_URL')
 if(!endpoint)throw new Error('Missing SUPABASE_URL')
 return endpoint.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable'
}
const download=z.object({action:z.literal('download'),id:z.uuid()})
Deno.serve(async(request:Request):Promise<Response>=>{
 let headers:HeadersInit
 try{headers=corsHeaders(request)}catch{return new Response('Origin is not allowed',{status:403})}
 const reply=(status:number,value:object):Response=>new Response(JSON.stringify(value),{status,headers})
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers})
 if(request.method!=='POST') return reply(405,{error:'Use POST'})
 let owner:string
 try{owner=await identity(adminClient(),request)}catch(error){return reply(401,{error:error instanceof Error?error.message:String(error)})}
 try {
  const raw=await request.text();if(raw.length>4096)return reply(413,{error:'Supply file metadata only. Upload bytes to the signed URL.'})
  const input=z.discriminatedUnion('action',[prepare,download]).parse(JSON.parse(raw))
  if(input.action==='prepare') validateFileUploadSize(input.size)
  await authorizeConnection(request,input.action==='prepare')
  const client=fileClient(request.headers.get('authorization')!)
  if(input.action==='prepare') {
   const {action:_action,command_id,...fields}=input
   const receipt=await client.rpc('manor_command',{p_command_id:command_id,p_operation:'allocate_file',p_input:fields})
   if(receipt.error) throw new Error(`Upload preparation failed: ${receipt.error.message}`)
   const file=await readAccessibleFile(client,owner,input.id)
   if(file.status!=='allocated') throw new Error('This upload has already been finalized')
   const signed=await client.storage.from('manor-files').createSignedUploadUrl(file.storage_path,{upsert:false})
   if(signed.error) throw new Error(`Could not authorize the upload: ${signed.error.message}`)
   return reply(200,{id:file.id,bucket:'manor-files',path:signed.data.path,upload_url:signed.data.signedUrl,upload_token:signed.data.token,mime_type:file.mime_type,size:file.size,expires_in_seconds:7200,resumable_endpoint:requiredStorageEndpoint(),resumable_chunk_size:6*1024*1024})
  }
  const file=await readAccessibleFile(client,owner,input.id)
  if(file.status!=='ready') throw new Error('Finalize the upload before downloading it')
  const signed=await client.storage.from('manor-files').createSignedUrl(file.storage_path,60,{download:file.name})
  if(signed.error) throw new Error(`Could not authorize the download: ${signed.error.message}`)
  return reply(200,{id:file.id,name:file.name,mime_type:file.mime_type,size:file.size,download_url:signed.data.signedUrl,expires_in_seconds:60})
 }catch(error){
  if(error instanceof FileUploadSizeError)return reply(error.code==='file_too_large'?413:400,{error:error.message,code:error.code})
  return reply(400,{error:error instanceof Error?error.message:String(error)})
 }
})
