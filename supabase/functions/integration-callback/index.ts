import { adminClient,digest,required,store,z } from '../_shared/integrationRuntime.ts'
import { assertAllowedOrigin } from '../_shared/origins.ts'

// Return only the short-lived code to its original browser. Token exchange requires
// the original authenticated owner plus that browser's PKCE verifier.
Deno.serve(async(request:Request):Promise<Response>=>{
 const url=new URL(request.url)
 let target=new URL('/settings',required('MANOR_ORIGIN'))
 try {
  const state=z.string().min(32).max(200).parse(url.searchParams.get('state'))
  const saved=z.object({provider:z.enum(['google','x']),return_origin:z.string()}).parse(await store(adminClient(),'oauth_lookup',null,{stateHash:await digest(state)}))
  target=new URL('/settings',assertAllowedOrigin(saved.return_origin))
  const denied=url.searchParams.get('error')
  if(denied) {target.searchParams.set('connection_error',denied)}
  else {
   const code=z.string().min(1).max(4096).parse(url.searchParams.get('code'))
   target.searchParams.set('connection_provider',saved.provider)
   target.searchParams.set('connection_code',code)
   target.searchParams.set('connection_state',state)
  }
 }catch(error){console.warn('Integration callback rejected',{error:error instanceof Error?error.message:String(error)});target.searchParams.set('connection_error','The connection request expired. Try connecting again.')}
 return new Response(null,{status:302,headers:{Location:target.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
})
