export interface StoredCalendarEvent {id:string;account_id:string;calendar_id:string;title:string;starts_at:string|null;ends_at:string|null;start_date:string|null;end_date:string|null;all_day:boolean}
function localDateTime(instant:string,timezone:string):{date:string;time:string} {
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(part=>[part.type,part.value]))
 return {date:`${fields.year}-${fields.month}-${fields.day}`,time:`${fields.hour}:${fields.minute}`}
}
export function calendarDays(event:StoredCalendarEvent,dates:readonly string[],timezone:string,color:string|null) {
 if(event.all_day) {
  if(event.start_date===null || event.end_date===null) throw new Error(`All-day event ${event.id} has no date range`)
  return dates.filter(date=>date>=event.start_date! && date<event.end_date!).map(date=>({id:event.id,accountId:event.account_id,calendarId:event.calendar_id,title:event.title,date,start:'00:00',end:'24:00',allDay:true,color}))
 }
 if(event.starts_at===null || event.ends_at===null) throw new Error(`Event ${event.id} has no time range`)
 const start=localDateTime(event.starts_at,timezone),end=localDateTime(event.ends_at,timezone)
 return dates.filter(date=>date>=start.date && date<=end.date && !(date===end.date && end.time==='00:00')).map(date=>({id:event.id,accountId:event.account_id,calendarId:event.calendar_id,title:event.title,date,start:date===start.date?start.time:'00:00',end:date===end.date?end.time:'24:00',allDay:false,color}))
}
