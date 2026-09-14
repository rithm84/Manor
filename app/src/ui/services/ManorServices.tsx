import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { AccountApi } from '../../shared/account'
import type { HomeApi } from '../../shared/home'
import type { HabitsApi } from '../../shared/habits'
import type { JobsApi } from '../../shared/jobs'
import type { LeetCodeApi } from '../../shared/leetcode'
import type { MoodFocusApi } from '../../shared/moodFocus'
import type { NotesApi } from '../../shared/notes'
import type { KbApi } from '../../shared/kb'
import type { ResumesApi } from '../../shared/resumes'
import type { CalendarApi } from '../../shared/calendar'
import type { ReviewsApi } from '../../shared/reviews'
import type { XApi } from '../../shared/xConnection'
import type { CourseFeedApi } from '../../shared/courseFeed'

/** Typed view services backed by the shared transactional command boundary. */
export interface ManorServices {
  reviews: ReviewsApi
  account: AccountApi
  home: HomeApi
  habits: HabitsApi
  jobs: JobsApi
  leetcode: LeetCodeApi
  moodFocus: MoodFocusApi
  notes: NotesApi
  kb: KbApi
  resumes: ResumesApi
  gcal: CalendarApi
  x: XApi
  courseFeed: CourseFeedApi
}

const ServicesContext = createContext<Partial<ManorServices> | null>(null)

export function ManorServicesProvider({ services, children }: { services: Partial<ManorServices>; children: ReactNode }): ReactNode {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useManorService<Key extends keyof ManorServices>(key: Key): ManorServices[Key] {
  const services = useContext(ServicesContext)
  const service = services?.[key]
  if (service === undefined) throw new Error(`Manor UI requires an implemented ${key} service`)
  return service
}
