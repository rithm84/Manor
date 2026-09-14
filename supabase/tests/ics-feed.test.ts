import {courseItems,itemsBetween,parseIcs} from '../functions/_shared/icsFeed.ts'

const feed=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Instructure//Canvas//EN','BEGIN:VEVENT','UID:event-assignment-1@bruinlearn.ucla.edu','DTSTAMP:20260901T000000Z','DTSTART;TZID=America/Los_Angeles:20260915T235900','DTEND;TZID=America/Los_Angeles:20260915T235900',
 'SUMMARY:Homework 3 [CS 180]','DESCRIPTION:Submit on Gradescope\\, not here.\\nSee the syllabus for the late policy which is quite long and continues','  on a folded line.','URL:https://bruinlearn.ucla.edu/courses/1/assignments/9','END:VEVENT',
 'BEGIN:VEVENT','UID:event-quiz-2@bruinlearn.ucla.edu','DTSTART;VALUE=DATE:20260918','SUMMARY:Quiz 2 [MATH 33A]','END:VEVENT',
 'BEGIN:VEVENT','UID:event-exam@bruinlearn.ucla.edu','DTSTART:20261001T070000Z','SUMMARY:Midterm [CS 180]','END:VEVENT',
 'BEGIN:VEVENT','UID:event-assignment-1@bruinlearn.ucla.edu','DTSTART;TZID=America/Los_Angeles:20260915T235900','SUMMARY:Homework 3 [CS 180]','END:VEVENT','END:VCALENDAR'].join('\r\n')

Deno.test('parses Canvas events with zones, all-day dates, UTC instants, folding, and duplicate UIDs',()=>{
 const items=courseItems(parseIcs(feed),'America/Los_Angeles')
 if(items.length!==3) throw new Error(`Expected 3 items, got ${items.length}`)
 const [homework,quiz,exam]=items
 if(homework?.title!=='Homework 3' || homework.course!=='CS 180' || homework.due_at!=='2026-09-16T06:59:00.000Z' || homework.due_date!=='2026-09-15' || homework.all_day) throw new Error('Zoned deadline parsed wrong: '+JSON.stringify(homework))
 if(!homework.description?.startsWith('Submit on Gradescope, not here.\nSee the syllabus') || !homework.description.endsWith('continues on a folded line.')) throw new Error('Description unescaping or folding failed: '+homework.description)
 if(quiz?.due_date!=='2026-09-18' || !quiz.all_day || quiz.course!=='MATH 33A') throw new Error('All-day item parsed wrong: '+JSON.stringify(quiz))
 if(exam?.due_at!=='2026-10-01T07:00:00.000Z' || exam.due_date!=='2026-10-01') throw new Error('UTC instant parsed wrong: '+JSON.stringify(exam))
 if(itemsBetween(items,'2026-09-15','2026-09-18').length!==2) throw new Error('Date range filter failed')
})

Deno.test('rejects responses that are not calendars',()=>{
 let failed=false
 try{parseIcs('<html>sign in</html>')}catch{failed=true}
 if(!failed) throw new Error('Non-calendar text was accepted')
})
