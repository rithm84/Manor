import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {required,z,type IntegrationClient} from './integrationRuntime.ts'
export function fileClient(authorization:string):IntegrationClient {
 return createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
}
export const accessibleFileSchema=z.object({id:z.uuid(),user_id:z.uuid(),purpose:z.enum(['note','resume','avatar','capture']),parent_id:z.string().nullable(),name:z.string(),storage_path:z.string(),status:z.enum(['allocated','ready','purging']),mime_type:z.string(),size:z.number().int(),sha256:z.string()})
export type AccessibleFile=z.infer<typeof accessibleFileSchema>
/** Check current source lifecycle before issuing a bearer URL or verifying uploaded bytes. */
export async function readAccessibleFile(client:IntegrationClient,owner:string,id:string):Promise<AccessibleFile> {
 const result=await client.from('file_objects').select('id,user_id,purpose,parent_id,name,storage_path,status,mime_type,size,sha256').eq('user_id',owner).eq('id',id).single()
 if(result.error) throw new Error('This file is not available to your account')
 const file=accessibleFileSchema.parse(result.data)
 if(file.status==='purging') throw new Error('This file is being removed')
 if(file.purpose==='note' || file.purpose==='capture') {
  if(file.parent_id===null) throw new Error('The file has no source record')
  const table=file.purpose==='note'?'note_pages':'kb_entries'
  let query=client.from(table).select('id').eq('user_id',owner).eq('id',file.parent_id)
  query=file.purpose==='note'?query.neq('status','trash'):query.is('deleted_at',null)
  const parent=await query.single()
  if(parent.error) throw new Error('The file source is no longer available')
 }
 if(file.purpose==='resume' && file.status==='ready') {
  const resume=await client.from('resumes').select('id').eq('user_id',owner).eq('id',file.id).single()
  if(resume.error) throw new Error('This resume is no longer available')
 }
 return file
}
