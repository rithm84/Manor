import { z,providerJson } from './integrationRuntime.ts'

const calendarItem=z.object({id:z.string(),summary:z.string().optional(),backgroundColor:z.string().optional(),deleted:z.boolean().optional()})
const calendarList=z.object({items:z.array(calendarItem).optional(),nextPageToken:z.string().optional()})

/** Read the full calendar inventory before applying the account-wide connection limit. */
export async function googleCalendars(token:string):Promise<{id:string;name:string;color:string|null;deleted:boolean}[]> {
 const headers={Authorization:'Bearer '+token}
 const calendars:{id:string;name:string;color:string|null;deleted:boolean}[]=[]
 let pageToken:string|undefined
 let pages=0
 do {
  const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
  url.searchParams.set('maxResults','250');url.searchParams.set('showDeleted','true')
  if(pageToken) url.searchParams.set('pageToken',pageToken)
  const page=await providerJson(url.toString(),{headers},calendarList)
  calendars.push(...(page.items??[]).map(item=>({id:item.id,name:item.summary??item.id,color:item.backgroundColor??null,deleted:item.deleted??false})))
  pageToken=page.nextPageToken;pages++
 }while(pageToken && pages<4)
 if(pageToken) throw new Error('This account has more than 1,000 calendars; sync could not finish its calendar list')
 return calendars.sort((a,b)=>Number(b.deleted)-Number(a.deleted))
}
