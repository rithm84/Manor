/* Pure camelCase↔snake_case row mappers between the local store shapes and
   the Supabase tables in supabase/migrations. Every *Of(state) builds insert
   rows for a push; every *StateOf(rows) validates pulled rows back through
   the shared parse functions. note_attachments are excluded from sync:
   attachment bytes live on local disk until a storage-backed sync ships. */

import type { HomeState } from '../shared/home'
import {
  parseContextDefinition,
  parseSavedTaskView,
  parseScratchBlock,
  parseTask
} from '../shared/home'
import type { MasterFilterRule } from '../shared/home'
import { parseHabitDefinition, parseHabitEntry, parseHabitLifecycleEvent, parseIsoDate } from '../shared/habits'
import type { MoodFocusEntry } from '../shared/moodFocus'
import { parseMoodFocusEntry } from '../shared/moodFocus'
import { parseLeetCodeAttempt, parseLeetCodeProblem } from '../shared/leetcode'
import { parseJobRole, parseJobTransition } from '../shared/jobs'
import type { NotesState } from '../shared/notes'
import { parseNoteFolder, parseNotePage } from '../shared/notes'
import type { HabitSyncState } from './habitStore'
import type { JobsSyncState } from './jobStore'
import type { LeetCodeSyncState } from './leetCodeStore'

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string
  user_id: string
  title: string
  context: string
  estimate_minutes: number | null
  priority: string | null
  status: string
  due: string
  tags: readonly string[]
  recurrence: string | null
}

export interface ContextRow {
  user_id: string
  name: string
  color: string
  icon: string
}

export interface ScratchBlockRow {
  id: string
  user_id: string
  task_id: string | null
  date: string
  start_time: string
  end_time: string
  portion: string
  created_at: string
  expires_at: string
}

export interface SavedTaskViewRow {
  id: string
  user_id: string
  name: string
  rules: readonly MasterFilterRule[]
}

export interface HomeRows {
  tasks: readonly TaskRow[]
  contexts: readonly ContextRow[]
  scratchBlocks: readonly ScratchBlockRow[]
  savedTaskViews: readonly SavedTaskViewRow[]
}

export function homeRowsOf(state: HomeState, userId: string): HomeRows {
  return {
    tasks: state.tasks.map((task) => ({
      id: task.id,
      user_id: userId,
      title: task.title,
      context: task.context,
      estimate_minutes: task.estimateMinutes,
      priority: task.priority,
      status: task.status,
      due: task.due,
      tags: task.tags,
      recurrence: task.recurrence
    })),
    contexts: state.contexts.map((context) => ({
      user_id: userId,
      name: context.name,
      color: context.color,
      icon: context.icon
    })),
    scratchBlocks: state.scratchBlocks.map((block) => ({
      id: block.id,
      user_id: userId,
      task_id: block.taskId,
      date: block.date,
      start_time: block.start,
      end_time: block.end,
      portion: block.portion,
      created_at: block.createdAt,
      expires_at: block.expiresAt
    })),
    savedTaskViews: state.savedTaskViews.map((view) => ({
      id: view.id,
      user_id: userId,
      name: view.name,
      rules: view.rules
    }))
  }
}

export function homeStateOf(rows: HomeRows): HomeState {
  return {
    tasks: rows.tasks.map((row) =>
      parseTask({
        id: row.id,
        title: row.title,
        context: row.context,
        estimateMinutes: row.estimate_minutes,
        priority: row.priority,
        status: row.status,
        due: row.due,
        tags: row.tags,
        recurrence: row.recurrence
      })
    ),
    contexts: rows.contexts.map((row) =>
      parseContextDefinition({ name: row.name, color: row.color, icon: row.icon })
    ),
    scratchBlocks: rows.scratchBlocks.map((row) =>
      parseScratchBlock({
        id: row.id,
        taskId: row.task_id,
        date: row.date,
        start: row.start_time,
        end: row.end_time,
        portion: row.portion,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      })
    ),
    savedTaskViews: rows.savedTaskViews.map((row) =>
      parseSavedTaskView({ id: row.id, name: row.name, rules: row.rules })
    )
  }
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export interface HabitRow {
  id: string
  user_id: string
  name: string
  kind: string
  target_label: string | null
  created_on: string
  created_at: string
}

export interface HabitLifecycleRow {
  user_id: string
  habit_id: string
  date: string
  status: string
  created_at: string
}

export interface HabitEntryRow {
  user_id: string
  habit_id: string
  date: string
  value: number
  created_at: string
  updated_at: string
}

export interface HabitDateRow {
  user_id: string
  habit_id: string
  date: string
}

export interface UserDateRow {
  user_id: string
  date: string
}

export interface HabitMonthPoolRow {
  user_id: string
  month: string
  capacity: number
}

export interface HabitRows {
  habits: readonly HabitRow[]
  lifecycle: readonly HabitLifecycleRow[]
  entries: readonly HabitEntryRow[]
  freezeUsage: readonly HabitDateRow[]
  freezeGrants: readonly UserDateRow[]
  finalizedDays: readonly UserDateRow[]
  monthPools: readonly HabitMonthPoolRow[]
}

export function habitRowsOf(state: HabitSyncState, userId: string): HabitRows {
  return {
    habits: state.habits.map((habit) => ({
      id: habit.id,
      user_id: userId,
      name: habit.name,
      kind: habit.kind,
      target_label: habit.targetLabel,
      created_on: habit.createdOn,
      created_at: habit.createdAt
    })),
    lifecycle: state.lifecycle.map((event) => ({
      user_id: userId,
      habit_id: event.habitId,
      date: event.date,
      status: event.status,
      created_at: event.createdAt
    })),
    entries: state.entries.map((entry) => ({
      user_id: userId,
      habit_id: entry.habitId,
      date: entry.date,
      value: entry.value,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt
    })),
    freezeUsage: state.freezes.map((freeze) => ({
      user_id: userId,
      habit_id: freeze.habitId,
      date: freeze.date
    })),
    freezeGrants: state.grants.map((grant) => ({ user_id: userId, date: grant.date })),
    finalizedDays: state.finalizedDays.map((date) => ({ user_id: userId, date })),
    monthPools: Object.entries(state.monthCapacities).map(([month, capacity]) => ({
      user_id: userId,
      month,
      capacity
    }))
  }
}

export function habitSyncStateOf(rows: HabitRows): HabitSyncState {
  const monthCapacities: Record<string, number> = {}
  rows.monthPools.forEach((row) => {
    monthCapacities[row.month] = row.capacity
  })
  return {
    habits: rows.habits.map((row) =>
      parseHabitDefinition({
        id: row.id,
        name: row.name,
        kind: row.kind,
        targetLabel: row.target_label,
        createdOn: row.created_on,
        createdAt: row.created_at
      })
    ),
    lifecycle: rows.lifecycle.map((row) =>
      parseHabitLifecycleEvent({
        habitId: row.habit_id,
        date: row.date,
        status: row.status,
        createdAt: row.created_at
      })
    ),
    entries: rows.entries.map((row) =>
      parseHabitEntry({
        habitId: row.habit_id,
        date: row.date,
        value: row.value,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    ),
    freezes: rows.freezeUsage.map((row) => ({
      habitId: row.habit_id,
      date: parseIsoDate(row.date, 'freeze usage date')
    })),
    grants: rows.freezeGrants.map((row) => ({ date: parseIsoDate(row.date, 'freeze grant date') })),
    finalizedDays: rows.finalizedDays.map((row) => parseIsoDate(row.date, 'finalized day')),
    monthCapacities
  }
}

// ---------------------------------------------------------------------------
// Mood and focus
// ---------------------------------------------------------------------------

export interface MoodFocusRow {
  user_id: string
  date: string
  mood: string | null
  focus: string | null
  note: string | null
  note_source: string | null
  created_at: string
  updated_at: string
}

export function moodFocusRowsOf(
  entries: readonly MoodFocusEntry[],
  userId: string
): readonly MoodFocusRow[] {
  return entries.map((entry) => ({
    user_id: userId,
    date: entry.date,
    mood: entry.mood,
    focus: entry.focus,
    note: entry.note,
    note_source: entry.noteSource,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt
  }))
}

export function moodFocusEntriesOf(rows: readonly MoodFocusRow[]): readonly MoodFocusEntry[] {
  return rows.map((row) =>
    parseMoodFocusEntry({
      date: row.date,
      mood: row.mood,
      focus: row.focus,
      note: row.note,
      noteSource: row.note_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  )
}

// ---------------------------------------------------------------------------
// LeetCode
// ---------------------------------------------------------------------------

export interface LeetCodeProblemRow {
  user_id: string
  id: string
  topic: string
  name: string
  difficulty: string
  curriculum_order: number
}

export interface LeetCodeAttemptRow {
  id: string
  user_id: string
  problem_id: string
  date: string
  solution: string
  created_at: string
  updated_at: string
}

export interface LeetCodeRows {
  problems: readonly LeetCodeProblemRow[]
  attempts: readonly LeetCodeAttemptRow[]
}

export function leetCodeRowsOf(state: LeetCodeSyncState, userId: string): LeetCodeRows {
  return {
    problems: state.problems.map((problem) => ({
      user_id: userId,
      id: problem.id,
      topic: problem.topic,
      name: problem.name,
      difficulty: problem.difficulty,
      curriculum_order: problem.curriculumOrder
    })),
    attempts: state.attempts.map((attempt) => ({
      id: attempt.id,
      user_id: userId,
      problem_id: attempt.problemId,
      date: attempt.date,
      solution: attempt.solution,
      created_at: attempt.createdAt,
      updated_at: attempt.updatedAt
    }))
  }
}

export function leetCodeSyncStateOf(rows: LeetCodeRows): LeetCodeSyncState {
  return {
    problems: rows.problems.map((row) =>
      parseLeetCodeProblem({
        id: row.id,
        topic: row.topic,
        name: row.name,
        difficulty: row.difficulty,
        curriculumOrder: row.curriculum_order
      })
    ),
    attempts: rows.attempts.map((row) =>
      parseLeetCodeAttempt({
        id: row.id,
        problemId: row.problem_id,
        date: row.date,
        solution: row.solution,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    )
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobRoleRow {
  id: string
  user_id: string
  company: string
  role: string
  location: string
  link: string
  posted: string | null
  stage: string
  applied: string | null
  oa_due: string | null
  interview1: string | null
  interview2: string | null
  interview3: string | null
  decision: string | null
  resume_id: string | null
  created_at: string
  updated_at: string
}

export interface JobTransitionRow {
  id: string
  user_id: string
  role_id: string
  from_stage: string | null
  to_stage: string
  at: string
}

export interface JobsRows {
  roles: readonly JobRoleRow[]
  transitions: readonly JobTransitionRow[]
}

export function jobsRowsOf(state: JobsSyncState, userId: string): JobsRows {
  return {
    roles: state.roles.map((role) => ({
      id: role.id,
      user_id: userId,
      company: role.company,
      role: role.role,
      location: role.location,
      link: role.postingLink,
      posted: role.datePosted,
      stage: role.stage,
      applied: role.appliedDate,
      oa_due: role.oaDueDate,
      interview1: role.interview1Date,
      interview2: role.interview2Date,
      interview3: role.interview3Date,
      decision: role.decisionDate,
      resume_id: role.resumeId ?? null,
      created_at: role.createdAt,
      updated_at: role.updatedAt
    })),
    transitions: state.transitions.map((transition) => ({
      id: transition.id,
      user_id: userId,
      role_id: transition.roleId,
      from_stage: transition.fromStage,
      to_stage: transition.toStage,
      at: transition.changedAt
    }))
  }
}

export function jobsSyncStateOf(rows: JobsRows): JobsSyncState {
  return {
    roles: rows.roles.map((row) =>
      parseJobRole({
        id: row.id,
        company: row.company,
        role: row.role,
        location: row.location,
        postingLink: row.link,
        datePosted: row.posted,
        stage: row.stage,
        appliedDate: row.applied,
        oaDueDate: row.oa_due,
        interview1Date: row.interview1,
        interview2Date: row.interview2,
        interview3Date: row.interview3,
        decisionDate: row.decision,
        resumeId: row.resume_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    ),
    transitions: rows.transitions.map((row) =>
      parseJobTransition({
        id: row.id,
        roleId: row.role_id,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        changedAt: row.at
      })
    )
  }
}

// ---------------------------------------------------------------------------
// Notes (note_attachments intentionally absent: local-only for now)
// ---------------------------------------------------------------------------

export interface NoteFolderRow {
  id: string
  user_id: string
  name: string
  parent_folder_id: string | null
  created_at: string
  updated_at: string
}

export interface NotePageRow {
  id: string
  user_id: string
  title: string
  folder_id: string | null
  parent_page_id: string | null
  /** jsonb in the cloud; the local store keeps the serialized string. */
  content_json: unknown
  favorite: boolean
  status: string
  created_at: string
  updated_at: string
  last_opened_at: string
  archived_at: string | null
  deleted_at: string | null
}

export interface NotesRows {
  folders: readonly NoteFolderRow[]
  pages: readonly NotePageRow[]
}

export function notesRowsOf(state: NotesState, userId: string): NotesRows {
  return {
    folders: state.folders.map((folder) => ({
      id: folder.id,
      user_id: userId,
      name: folder.name,
      parent_folder_id: folder.parentFolderId,
      created_at: folder.createdAt,
      updated_at: folder.updatedAt
    })),
    pages: state.pages.map((page) => ({
      id: page.id,
      user_id: userId,
      title: page.title,
      folder_id: page.folderId,
      parent_page_id: page.parentPageId,
      content_json: JSON.parse(page.contentJson) as unknown,
      favorite: page.favorite,
      status: page.status,
      created_at: page.createdAt,
      updated_at: page.updatedAt,
      last_opened_at: page.lastOpenedAt,
      archived_at: page.archivedAt,
      deleted_at: page.deletedAt
    }))
  }
}

export function notesStateOf(rows: NotesRows): NotesState {
  return {
    folders: rows.folders.map((row) =>
      parseNoteFolder({
        id: row.id,
        name: row.name,
        parentFolderId: row.parent_folder_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    ),
    pages: rows.pages.map((row) =>
      parseNotePage({
        id: row.id,
        title: row.title,
        folderId: row.folder_id,
        parentPageId: row.parent_page_id,
        contentJson: JSON.stringify(row.content_json),
        favorite: row.favorite,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastOpenedAt: row.last_opened_at,
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at
      })
    )
  }
}
