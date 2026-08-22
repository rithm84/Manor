/**
 * Display fixtures for the unlocked journal mock. Journal content never joins
 * data/mock.ts: canonically the journal is sealed and nothing else in the app,
 * Alfred included, can read it. These entries exist only so the unlocked view
 * has something dignified to render.
 */

export interface JournalEntry {
  id: string
  /** Short list label, e.g. "Tue, Aug 19". */
  dateShort: string
  /** Writing-pane heading, e.g. "Tuesday, August 19". */
  dateLong: string
  text: string
}

export const journalEntries: readonly JournalEntry[] = [
  {
    id: 'jr-0819',
    dateShort: 'Tue, Aug 19',
    dateLong: 'Tuesday, August 19',
    text: 'Long day but a quiet one. The practice set went slower than I wanted and I caught myself spiraling a little about the exam. Wrote out what I actually know and the list was longer than the fear. Dinner with the family helped more than I expected.'
  },
  {
    id: 'jr-0818',
    dateShort: 'Mon, Aug 18',
    dateLong: 'Monday, August 18',
    text: 'Resume pass done. It is strange reading two years of work compressed into bullet points. I keep wanting to explain the context behind each line. Maybe the interviews are for that.'
  },
  {
    id: 'jr-0817',
    dateShort: 'Sun, Aug 17',
    dateLong: 'Sunday, August 17',
    text: 'Best focus day in weeks. Two problems before lunch, a long walk after. I want more Sundays shaped like this one.'
  },
  {
    id: 'jr-0816',
    dateShort: 'Sat, Aug 16',
    dateLong: 'Saturday, August 16',
    text: 'Slept in and did not feel guilty about it. Read on the balcony until the light went. Some days the log can just say: rested.'
  },
  {
    id: 'jr-0815',
    dateShort: 'Fri, Aug 15',
    dateLong: 'Friday, August 15',
    text: 'Sent the Airbnb application and closed the laptop before dinner for once. Amma noticed. That felt better than the submit button did.'
  },
  {
    id: 'jr-0814',
    dateShort: 'Thu, Aug 14',
    dateLong: 'Thursday, August 14',
    text: 'Midweek slump. Skipped the gym and regretted it by evening. Writing it down so the pattern is harder to ignore next time.'
  },
  {
    id: 'jr-0813',
    dateShort: 'Wed, Aug 13',
    dateLong: 'Wednesday, August 13',
    text: 'Rough one. The OA went badly and I let it color the whole day. Talked to Arjun at night; he reminded me the funnel is a funnel for everyone. Sleep on it.'
  },
  {
    id: 'jr-0812',
    dateShort: 'Tue, Aug 12',
    dateLong: 'Tuesday, August 12',
    text: 'Started the two pointers unit. The first few problems felt mechanical, which I think is the point. Trust the reps.'
  }
]

export const todayEntryTemplate: Pick<JournalEntry, 'dateShort' | 'dateLong'> = {
  dateShort: 'Wed, Aug 20',
  dateLong: 'Wednesday, August 20'
}
