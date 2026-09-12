import type { ManorServices } from '../../ui/services/ManorServices'
import type { ManorGateway } from '../ManorGateway'
import type { NoteDraftStore } from '../notes/NoteDraftStore'
import { AccountService } from './AccountService'
import { HomeService } from './HomeService'
import { HabitsService } from './HabitsService'
import { MoodFocusService } from './MoodFocusService'
import { JobsService } from './JobsService'
import { LeetCodeService } from './LeetCodeService'
import { NotesService } from './NotesService'
import { KnowledgeService } from './KnowledgeService'
import { ResumesService } from './ResumesService'
import { CalendarService, XService } from './IntegrationService'
import { ReviewsService } from './ReviewsService'

export function createServices(gateway: ManorGateway, drafts: NoteDraftStore): ManorServices {
  return {
    account: new AccountService(gateway, drafts), home: new HomeService(gateway), habits: new HabitsService(gateway),
    moodFocus: new MoodFocusService(gateway), jobs: new JobsService(gateway), leetcode: new LeetCodeService(gateway),
    notes: new NotesService(gateway, drafts), kb: new KnowledgeService(gateway), resumes: new ResumesService(gateway),
    gcal: new CalendarService(gateway), x: new XService(gateway), reviews: new ReviewsService(gateway)
  }
}
