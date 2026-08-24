import { HomeStore } from './homeStore'
import { CalendarStore } from './calendarStore'
import { HabitStore } from './habitStore'
import { JobStore } from './jobStore'
import { LeetCodeStore } from './leetCodeStore'
import { MoodFocusStore } from './moodFocusStore'
import { NotesStore } from './notesStore'
import {
  parseCalendarDefinition,
  parseCalendarEvent,
  parseCalendarId,
  parseCalendarOccurrenceMutation,
  parseCalendarSeed,
  parseCalendarSettings
} from '../shared/calendar'
import {
  parseContext,
  parseContextDefinition,
  parseHomeSeed,
  parseSavedTaskView,
  parseScratchBlock,
  parseTask
} from '../shared/home'
import {
  parseHabitDraft,
  parseHabitLogMutation,
  parseHabitSeed,
  parseHabitStatusMutation
} from '../shared/habits'
import {
  parseFocusMutation,
  parseMoodFocusNoteMutation,
  parseMoodFocusSeed,
  parseMoodMutation
} from '../shared/moodFocus'
import {
  jobLocalDate,
  parseJobRoleFields,
  parseJobRoleId,
  parseJobRoleUpdate,
  parseJobsSeed,
  parseJobStageMutation
} from '../shared/jobs'
import {
  leetCodeLocalDate,
  parseAddLeetCodeAttemptMutation,
  parseLeetCodeId,
  parseLeetCodeSeed,
  parseUpdateLeetCodeAttemptMutation
} from '../shared/leetcode'
import {
  parseNoteAttachmentUpload,
  parseNoteFolderDraft,
  parseNoteFolderRename,
  parseNoteId,
  parseNotePageContentUpdate,
  parseNotePageDraft,
  parseNotePageFavoriteMutation,
  parseNotePageMove,
  parseNotesSeed
} from '../shared/notes'

export type BridgeChannelHandler = (args: readonly unknown[]) => unknown

export interface ManorStores {
  home: HomeStore
  calendar: CalendarStore
  habits: HabitStore
  jobs: JobStore
  leetCode: LeetCodeStore
  moodFocus: MoodFocusStore
  notes: NotesStore
}

export function createManorStores(databasePath: string, attachmentRoot: string): ManorStores {
  return {
    home: new HomeStore(databasePath),
    calendar: new CalendarStore(databasePath),
    habits: new HabitStore(databasePath),
    jobs: new JobStore(databasePath),
    leetCode: new LeetCodeStore(databasePath),
    moodFocus: new MoodFocusStore(databasePath),
    notes: new NotesStore(databasePath, attachmentRoot)
  }
}

export function closeManorStores(stores: ManorStores): void {
  stores.leetCode.close()
  stores.notes.close()
  stores.jobs.close()
  stores.moodFocus.close()
  stores.habits.close()
  stores.home.close()
  stores.calendar.close()
}

function parseHabitId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('habit id must be a non-empty string')
  }
  return value
}

export function createBridgeChannels(stores: ManorStores): Record<string, BridgeChannelHandler> {
  return {
    'home:load': ([seed]) => stores.home.load(parseHomeSeed(seed), new Date().toISOString()),
    'home:upsert-task': ([task]) => stores.home.upsertTask(parseTask(task), new Date().toISOString()),
    'home:delete-task': ([taskId]) => stores.home.deleteTask(parseContext(taskId)),
    'home:add-context': ([context]) => stores.home.addContext(parseContextDefinition(context)),
    'home:upsert-scratch-block': ([block]) =>
      stores.home.upsertScratchBlock(parseScratchBlock(block), new Date().toISOString()),
    'home:delete-scratch-block': ([blockId]) => stores.home.deleteScratchBlock(parseContext(blockId)),
    'home:upsert-saved-task-view': ([view]) =>
      stores.home.upsertSavedTaskView(parseSavedTaskView(view), new Date().toISOString()),
    'home:delete-saved-task-view': ([viewId]) =>
      stores.home.deleteSavedTaskView(parseContext(viewId)),

    'calendar:load': ([seed]) => stores.calendar.load(parseCalendarSeed(seed)),
    'calendar:upsert-calendar': ([calendar]) =>
      stores.calendar.upsertCalendar(parseCalendarDefinition(calendar)),
    'calendar:delete-calendar': ([calendarId]) =>
      stores.calendar.deleteCalendar(parseCalendarId(calendarId, 'calendar id')),
    'calendar:upsert-event': ([event]) => stores.calendar.upsertEvent(parseCalendarEvent(event)),
    'calendar:replace-occurrence': ([mutation]) =>
      stores.calendar.replaceOccurrence(parseCalendarOccurrenceMutation(mutation)),
    'calendar:delete-event': ([eventId]) =>
      stores.calendar.deleteEvent(parseCalendarId(eventId, 'calendar event id')),
    'calendar:update-settings': ([settings]) =>
      stores.calendar.updateSettings(parseCalendarSettings(settings)),

    'habits:load': ([seed]) => stores.habits.load(parseHabitSeed(seed)),
    'habits:create': ([draft]) =>
      stores.habits.createHabit(parseHabitDraft(draft), new Date().toISOString()),
    'habits:update': ([habitId, draft]) =>
      stores.habits.updateHabit(parseHabitId(habitId), parseHabitDraft(draft), new Date().toISOString()),
    'habits:set-entry': ([mutation]) =>
      stores.habits.setEntry(parseHabitLogMutation(mutation), new Date().toISOString()),
    'habits:set-status': ([mutation]) =>
      stores.habits.setStatus(parseHabitStatusMutation(mutation), new Date().toISOString()),
    'habits:delete': ([habitId]) => stores.habits.deleteHabit(parseHabitId(habitId)),

    'mood-focus:load': ([seed]) => stores.moodFocus.load(parseMoodFocusSeed(seed)),
    'mood-focus:set-mood': ([mutation]) =>
      stores.moodFocus.setMood(parseMoodMutation(mutation), new Date().toISOString()),
    'mood-focus:set-focus': ([mutation]) =>
      stores.moodFocus.setFocus(parseFocusMutation(mutation), new Date().toISOString()),
    'mood-focus:set-note': ([mutation]) =>
      stores.moodFocus.setNote(parseMoodFocusNoteMutation(mutation), new Date().toISOString()),

    'jobs:load': ([seed]) => stores.jobs.load(parseJobsSeed(seed), jobLocalDate(new Date())),
    'jobs:create-role': ([fields]) =>
      stores.jobs.createRole(parseJobRoleFields(fields), new Date().toISOString()),
    'jobs:update-role': ([mutation]) =>
      stores.jobs.updateRole(parseJobRoleUpdate(mutation), new Date().toISOString()),
    'jobs:set-stage': ([mutation]) =>
      stores.jobs.setStage(parseJobStageMutation(mutation), new Date().toISOString()),
    'jobs:delete-role': ([roleId]) => stores.jobs.deleteRole(parseJobRoleId(roleId)),

    'leetcode:load': ([seed]) =>
      stores.leetCode.load(parseLeetCodeSeed(seed), leetCodeLocalDate(new Date())),
    'leetcode:add-attempt': ([mutation]) =>
      stores.leetCode.addAttempt(parseAddLeetCodeAttemptMutation(mutation), new Date().toISOString()),
    'leetcode:update-attempt': ([mutation]) =>
      stores.leetCode.updateAttempt(
        parseUpdateLeetCodeAttemptMutation(mutation),
        new Date().toISOString()
      ),
    'leetcode:delete-attempt': ([attemptId]) =>
      stores.leetCode.deleteAttempt(parseLeetCodeId(attemptId, 'attempt id')),

    'notes:load': ([seed]) => stores.notes.load(parseNotesSeed(seed)),
    'notes:create-folder': ([draft]) =>
      stores.notes.createFolder(parseNoteFolderDraft(draft), new Date().toISOString()),
    'notes:rename-folder': ([mutation]) =>
      stores.notes.renameFolder(parseNoteFolderRename(mutation), new Date().toISOString()),
    'notes:delete-folder': ([folderId]) =>
      stores.notes.deleteFolder(parseNoteId(folderId, 'folder id'), new Date().toISOString()),
    'notes:create-page': ([draft]) =>
      stores.notes.createPage(parseNotePageDraft(draft), new Date().toISOString()),
    'notes:update-page': ([mutation]) =>
      stores.notes.updatePage(parseNotePageContentUpdate(mutation), new Date().toISOString()),
    'notes:touch-page': ([pageId]) =>
      stores.notes.touchPage(parseNoteId(pageId, 'note id'), new Date().toISOString()),
    'notes:move-page': ([mutation]) =>
      stores.notes.movePage(parseNotePageMove(mutation), new Date().toISOString()),
    'notes:duplicate-page': ([pageId]) =>
      stores.notes.duplicatePage(parseNoteId(pageId, 'note id'), new Date().toISOString()),
    'notes:set-favorite': ([mutation]) =>
      stores.notes.setFavorite(parseNotePageFavoriteMutation(mutation), new Date().toISOString()),
    'notes:archive-page': ([pageId]) =>
      stores.notes.archivePage(parseNoteId(pageId, 'note id'), new Date().toISOString()),
    'notes:trash-page': ([pageId]) =>
      stores.notes.trashPage(parseNoteId(pageId, 'note id'), new Date().toISOString()),
    'notes:restore-page': ([pageId]) =>
      stores.notes.restorePage(parseNoteId(pageId, 'note id'), new Date().toISOString()),
    'notes:permanently-delete-page': ([pageId]) =>
      stores.notes.permanentlyDeletePage(parseNoteId(pageId, 'note id')),
    'notes:upload-attachment': ([upload]) =>
      stores.notes.uploadAttachment(parseNoteAttachmentUpload(upload), new Date().toISOString()),
    'notes:resolve-attachment': ([attachmentId]) =>
      stores.notes.resolveAttachment(parseNoteId(attachmentId, 'attachment id'))
  }
}
