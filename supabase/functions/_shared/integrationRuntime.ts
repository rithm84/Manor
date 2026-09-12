import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { z } from 'npm:zod@4.1.12'
import { originHeaders, requestOrigin } from './origins.ts'

export { z }
export function required(name: string): string {
 const value = Deno.env.get(name)
 if (!value) throw new Error(`Missing server configuration ${name}`)
 return value
}
export function adminClient() {
 return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false,autoRefreshToken:false}})
}
export type IntegrationClient = ReturnType<typeof adminClient>
export type Json = z.infer<ReturnType<typeof z.json>>
export type Input = Record<string, Json>
export async function store(client: IntegrationClient, action: string, owner: string | null, input: Input): Promise<Json> {
 const result = await client.rpc('manor_integration_store', {p_action:action,p_owner:owner,p_input:input})
 if (result.error) throw new Error(`Integration storage ${action}: ${result.error.message}`)
 return z.json().parse(result.data)
}
export class ProviderError extends Error {
 readonly status: number
 constructor(provider: string, status: number, detail: string) { super(`${provider} returned ${status}: ${detail}`); this.status=status }
}
export async function providerJson<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
 for(let attempt=0; attempt<3; attempt++) {
  let response: Response
  try { response=await fetch(url,{...init,signal:AbortSignal.timeout(5000)}) }
  catch(error) {
   if(attempt===2) throw error
   console.warn('Retrying provider transport',{provider:new URL(url).hostname,attempt:attempt+1})
   await new Promise(resolve=>setTimeout(resolve,250*2**attempt)); continue
  }
  if(response.ok) return schema.parse(await response.json())
  const detail=(await response.text()).slice(0,1500)
  const error=new ProviderError(new URL(url).hostname,response.status,detail)
  if(attempt===2 || (response.status!==429 && response.status<500)) throw error
  console.warn('Retrying provider request',{provider:new URL(url).hostname,status:response.status,attempt:attempt+1})
  await new Promise(resolve=>setTimeout(resolve,500*2**attempt))
 }
 throw new Error('Provider retries were exhausted')
}
export const credentialsSchema=z.object({user_id:z.uuid(),provider:z.enum(['google','x']),account_id:z.string(),access_token:z.string(),refresh_token:z.string(),expires_at:z.string(),username:z.string(),connected_at:z.string()})
export type Credentials=z.infer<typeof credentialsSchema>
const tokenSchema=z.object({access_token:z.string(),refresh_token:z.string().optional(),expires_in:z.number()})
export async function accessToken(client: IntegrationClient, credentials: Credentials): Promise<string> {
 if(Date.parse(credentials.expires_at)>Date.now()+60000) return credentials.access_token
 const google=credentials.provider==='google'
 const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refresh_token})
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'}
 if(google) { body.set('client_id',required('GOOGLE_CLIENT_ID'));body.set('client_secret',required('GOOGLE_CLIENT_SECRET')) }
 else headers.Authorization='Basic '+btoa(required('X_CLIENT_ID')+':'+required('X_CLIENT_SECRET'))
 const token=await providerJson(google?'https://oauth2.googleapis.com/token':'https://api.x.com/2/oauth2/token',{method:'POST',headers,body},tokenSchema)
 await store(client,'refresh',credentials.user_id,{provider:credentials.provider,accountId:credentials.account_id,accessToken:token.access_token,refreshToken:token.refresh_token??credentials.refresh_token,expiresAt:new Date(Date.now()+token.expires_in*1000).toISOString()})
 return token.access_token
}
export function corsHeaders(request: Request): HeadersInit {
 return {'Content-Type':'application/json',...originHeaders(requestOrigin(request)),'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
}
export async function identity(client: IntegrationClient, request: Request): Promise<string> {
 const authorization=request.headers.get('authorization')
 if(!authorization?.startsWith('Bearer ')) throw new Error('Sign in before managing connections')
 const result=await client.auth.getUser(authorization.slice(7))
 if(result.error || !result.data.user) throw new Error('Your session expired. Sign in again.')
 return result.data.user.id
}
export function randomToken(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))) }
export function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') }
export async function digest(value: string): Promise<string> { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))) }
export async function authorizeConnection(request:Request,write:boolean):Promise<void> {
 const token=request.headers.get('authorization')!.slice(7)
 const client=createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}})
 const claims=await client.auth.getClaims(token)
 if(claims.error) throw claims.error
 if(!claims.data) throw new Error('Your session could not be verified')
 if(claims.data.claims.client_id) {
  const permission=await client.rpc('manor_mcp_access')
  if(permission.error) throw permission.error
  const access=z.object({read:z.boolean(),write:z.boolean()}).parse(permission.data)
  if(!access.read || (write && !access.write)) throw new Error('This agent is not authorized for this operation')
 }
}
