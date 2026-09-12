import { calendarDays, type StoredCalendarEvent } from '../functions/_shared/calendarDays.ts'
function event(starts_at:string,ends_at:string):StoredCalendarEvent {
 return {id:'event',account_id:'account',calendar_id:'calendar',title:'Appointment',starts_at,ends_at,start_date:null,end_date:null,all_day:false}
}
function equal(actual:object,expected:object):void {
 if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}
Deno.test('calendar projection preserves local spring DST times',()=>{
 const days=calendarDays(event('2026-03-08T09:30:00Z','2026-03-08T10:30:00Z'),['2026-03-08'],'America/Los_Angeles',null)
 equal(days.map(day=>[day.date,day.start,day.end]),[['2026-03-08','01:30','03:30']])
})
Deno.test('calendar projection clips midnight exclusively and splits multi-day events',()=>{
 const days=calendarDays(event('2026-09-09T06:00:00Z','2026-09-11T07:00:00Z'),['2026-09-08','2026-09-09','2026-09-10','2026-09-11'],'America/Los_Angeles',null)
 equal(days.map(day=>[day.date,day.start,day.end]),[['2026-09-08','23:00','24:00'],['2026-09-09','00:00','24:00'],['2026-09-10','00:00','24:00']])
})
Deno.test('all-day events retain dates independently of timezone',()=>{
 const row={...event('2026-09-09T00:00:00Z','2026-09-11T00:00:00Z'),starts_at:null,ends_at:null,all_day:true,start_date:'2026-09-09',end_date:'2026-09-11'}
 equal(calendarDays(row,['2026-09-08','2026-09-09','2026-09-10','2026-09-11'],'Pacific/Auckland',null).map(day=>day.date),['2026-09-09','2026-09-10'])
})
