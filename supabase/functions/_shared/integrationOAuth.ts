import { googleCalendars } from './googleCalendars.ts'
import { z, required, randomToken, digest, store, providerJson, type IntegrationClient } from './integrationRuntime.ts'
import { assertAllowedOrigin } from './origins.ts'

const tokenSchema=z.object({access_token:z.string(),refresh_token:z.string(),expires_in:z.number()})
export async function beginOAuth(client:IntegrationClient,owner:string,provider:'google'|'x',challenge:string,returnOrigin:string):Promise<{url:string;state:string}> {
 const state=randomToken()
 await store(client,'oauth_start',owner,{provider,stateHash:await digest(state),verifier:challenge,returnOrigin:assertAllowedOrigin(returnOrigin)})
 const google=provider==='google'
 const url=new URL(google?'https://accounts.google.com/o/oauth2/v2/auth':'https://x.com/i/oauth2/authorize')
 url.search=new URLSearchParams({client_id:required(google?'GOOGLE_CLIENT_ID':'X_CLIENT_ID'),redirect_uri:required('SUPABASE_URL')+'/functions/v1/integration-callback',response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256',scope:google?'openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly':'tweet.read users.read bookmark.read offline.access'}).toString()
 if(google){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent')}
 return {url:url.toString(),state}
}
export async function finishOAuth(client:IntegrationClient,owner:string,code:string,state:string,verifier:string):Promise<void> {
 const saved=z.object({provider:z.enum(['google','x'])}).parse(await store(client,'oauth_consume',owner,{stateHash:await digest(state),challenge:await digest(verifier)}))
 const google=saved.provider==='google'
 const body=new URLSearchParams({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:required('SUPABASE_URL')+'/functions/v1/integration-callback',client_id:required(google?'GOOGLE_CLIENT_ID':'X_CLIENT_ID')})
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'}
 if(google) body.set('client_secret',required('GOOGLE_CLIENT_SECRET'))
 else headers.Authorization='Basic '+btoa(required('X_CLIENT_ID')+':'+required('X_CLIENT_SECRET'))
 const tokens=await providerJson(google?'https://oauth2.googleapis.com/token':'https://api.x.com/2/oauth2/token',{method:'POST',body,headers},tokenSchema)
 let accountId:string;let username:string
 if(google) {
  const account=await providerJson('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}},z.object({sub:z.string(),email:z.email(),email_verified:z.literal(true)}))
  accountId=account.sub;username=account.email
 } else {
  const account=await providerJson('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+tokens.access_token}},z.object({data:z.object({id:z.string(),username:z.string()})}))
  accountId=account.data.id;username=account.data.username
 }
 await store(client,'connect',owner,{provider:saved.provider,accountId,username,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:new Date(Date.now()+tokens.expires_in*1000).toISOString(),...(google?{calendars:await googleCalendars(tokens.access_token)}:{})})
}
