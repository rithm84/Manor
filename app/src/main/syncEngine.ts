/* PRD §4 sync posture: Supabase is the source of truth, local SQLite is the
   read cache. Push = debounced full-module replace (delete the user's rows,
   re-insert local state); pull = full-module replace of local state, run once
   per session start. Signed out means no cloud calls at all. */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { AccountInfo } from '../shared/account'
import { jobLocalDate } from '../shared/jobs'
import type { BridgeChannelHandler, ManorStores } from './bridgeChannels'
import { accountOf } from './supabaseCore'
import {
  habitRowsOf,
  habitSyncStateOf,
  homeRowsOf,
  homeStateOf,
  jobsRowsOf,
  jobsSyncStateOf,
  leetCodeRowsOf,
  leetCodeSyncStateOf,
  moodFocusEntriesOf,
  moodFocusRowsOf,
  notesRowsOf,
  notesStateOf
} from './syncRows'
import type {
  HabitDateRow,
  HabitEntryRow,
  HabitLifecycleRow,
  HabitMonthPoolRow,
  HabitRow,
  ContextRow,
  JobRoleRow,
  JobTransitionRow,
  LeetCodeAttemptRow,
  LeetCodeProblemRow,
  MoodFocusRow,
  NoteFolderRow,
  NotePageRow,
  SavedTaskViewRow,
  ScratchBlockRow,
  TaskRow,
  UserDateRow
} from './syncRows'

export type SyncModule = 'home' | 'habits' | 'moodFocus' | 'leetcode' | 'jobs' | 'notes'

export const SYNC_MODULES: readonly SyncModule[] = [
  'home',
  'habits',
  'moodFocus',
  'leetcode',
  'jobs',
  'notes'
]

const PUSH_DEBOUNCE_MS = 1500
const MAX_ATTEMPTS = 3

const MODULE_BY_CHANNEL_PREFIX: Readonly<Record<string, SyncModule>> = {
  home: 'home',
  habits: 'habits',
  'mood-focus': 'moodFocus',
  leetcode: 'leetcode',
  jobs: 'jobs',
  notes: 'notes'
}

/* load channels only read (their seeding happens once, before any account
   exists); resolve/upload-attachment only touch the local-only attachment
   store, which is excluded from sync. */
const UNSYNCED_CHANNELS: ReadonlySet<string> = new Set([
  'home:load',
  'habits:load',
  'mood-focus:load',
  'jobs:load',
  'leetcode:load',
  'notes:load',
  'notes:resolve-attachment',
  'notes:upload-attachment'
])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function deleteUserRows(
  client: SupabaseClient,
  table: string,
  userId: string
): Promise<void> {
  const { error, status } = await client.from(table).delete().eq('user_id', userId)
  if (error !== null) {
    throw new Error(`sync delete from ${table} failed (status ${status}): ${error.message}`)
  }
}

async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: readonly object[]
): Promise<void> {
  if (rows.length === 0) return
  const { error, status } = await client.from(table).insert(rows as object[])
  if (error !== null) {
    throw new Error(
      `sync insert of ${rows.length} rows into ${table} failed (status ${status}): ${error.message}`
    )
  }
}

async function fetchUserRows<Row>(
  client: SupabaseClient,
  table: string,
  columns: string,
  userId: string,
  orderBy: string
): Promise<Row[]> {
  const { data, error, status } = await client
    .from(table)
    .select(columns)
    .eq('user_id', userId)
    .order(orderBy, { ascending: true })
  if (error !== null) {
    throw new Error(`sync fetch from ${table} failed (status ${status}): ${error.message}`)
  }
  return data as Row[]
}

export class SyncEngine {
  private readonly stores: ManorStores
  private readonly clientOf: () => SupabaseClient
  private userId: string | null = null
  private readonly timers = new Map<SyncModule, ReturnType<typeof setTimeout>>()
  private readonly pushChains = new Map<SyncModule, Promise<void>>()

  constructor(stores: ManorStores, clientOf: () => SupabaseClient) {
    this.stores = stores
    this.clientOf = clientOf
  }

  /** Begin scheduling pushes for this account (no pull; see pullAll). */
  start(userId: string): void {
    this.userId = userId
  }

  /** Sign-out: drop the account and cancel pending pushes. */
  stop(): void {
    this.userId = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** Debounced full-module upload; a no-op while signed out. */
  schedulePush(module: SyncModule): void {
    if (this.userId === null) return
    const pending = this.timers.get(module)
    if (pending !== undefined) clearTimeout(pending)
    this.timers.set(
      module,
      setTimeout(() => {
        this.timers.delete(module)
        this.enqueuePush(module)
      }, PUSH_DEBOUNCE_MS)
    )
  }

  /** Pending debounces plus in-flight pushes, awaitable (used by tests and
      graceful shutdown; steady-state code never needs to wait on a push). */
  async flush(): Promise<void> {
    for (const [module, timer] of this.timers.entries()) {
      clearTimeout(timer)
      this.enqueuePush(module)
    }
    this.timers.clear()
    await Promise.all(this.pushChains.values())
  }

  /** Session-start hydration: replace local state with the cloud copy for
      every module. A module whose cloud tables are all empty (first session)
      seeds the cloud from local state instead of wiping local data. */
  async pullAll(userId: string): Promise<void> {
    this.start(userId)
    const client = this.clientOf()
    for (const module of SYNC_MODULES) {
      await this.pullWithRetries(client, module, userId)
    }
  }

  private enqueuePush(module: SyncModule): void {
    const chain = this.pushChains.get(module) ?? Promise.resolve()
    this.pushChains.set(
      module,
      chain.then(() => this.pushWithRetries(module))
    )
  }

  /** Retries with structured warnings, then a final structured error. Never
      throws: pushes run detached from the mutation path. */
  private async pushWithRetries(module: SyncModule): Promise<void> {
    const userId = this.userId
    if (userId === null) return
    const client = this.clientOf()
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.pushModule(client, module, userId)
        return
      } catch (error) {
        if (attempt < MAX_ATTEMPTS) {
          console.warn('manor-sync push retrying', {
            module,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            error: errorMessage(error)
          })
        } else {
          console.error('manor-sync push failed', {
            module,
            attempts: MAX_ATTEMPTS,
            error: errorMessage(error)
          })
        }
      }
    }
  }

  private async pullWithRetries(
    client: SupabaseClient,
    module: SyncModule,
    userId: string
  ): Promise<void> {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.pullModule(client, module, userId)
        return
      } catch (error) {
        lastError = error
        console.warn('manor-sync pull retrying', {
          module,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          error: errorMessage(error)
        })
      }
    }
    throw new Error(
      `Cloud pull for ${module} failed after ${MAX_ATTEMPTS} attempts: ${errorMessage(lastError)}`
    )
  }

  /** Delete-then-insert per table; deletes lean on ON DELETE CASCADE for
      child tables, inserts run parents before children. */
  private async pushModule(
    client: SupabaseClient,
    module: SyncModule,
    userId: string
  ): Promise<void> {
    if (module === 'home') {
      const rows = homeRowsOf(this.stores.home.snapshot(), userId)
      await deleteUserRows(client, 'tasks', userId) // cascades scratch_blocks with a task
      await deleteUserRows(client, 'scratch_blocks', userId) // freestanding notes
      await deleteUserRows(client, 'contexts', userId)
      await deleteUserRows(client, 'saved_task_views', userId)
      await insertRows(client, 'tasks', rows.tasks)
      await insertRows(client, 'scratch_blocks', rows.scratchBlocks)
      await insertRows(client, 'contexts', rows.contexts)
      await insertRows(client, 'saved_task_views', rows.savedTaskViews)
      return
    }
    if (module === 'habits') {
      const rows = habitRowsOf(this.stores.habits.snapshot(), userId)
      await deleteUserRows(client, 'habits', userId) // cascades lifecycle, entries, freeze usage
      await deleteUserRows(client, 'habit_freeze_grants', userId)
      await deleteUserRows(client, 'habit_finalized_days', userId)
      await deleteUserRows(client, 'habit_month_pools', userId)
      await insertRows(client, 'habits', rows.habits)
      await insertRows(client, 'habit_lifecycle', rows.lifecycle)
      await insertRows(client, 'habit_entries', rows.entries)
      await insertRows(client, 'habit_freeze_usage', rows.freezeUsage)
      await insertRows(client, 'habit_freeze_grants', rows.freezeGrants)
      await insertRows(client, 'habit_finalized_days', rows.finalizedDays)
      await insertRows(client, 'habit_month_pools', rows.monthPools)
      return
    }
    if (module === 'moodFocus') {
      const rows = moodFocusRowsOf(this.stores.moodFocus.snapshot(), userId)
      await deleteUserRows(client, 'mood_focus_entries', userId)
      await insertRows(client, 'mood_focus_entries', rows)
      return
    }
    if (module === 'leetcode') {
      const rows = leetCodeRowsOf(this.stores.leetCode.snapshot(), userId)
      await deleteUserRows(client, 'leetcode_problems', userId) // cascades attempts
      await insertRows(client, 'leetcode_problems', rows.problems)
      await insertRows(client, 'leetcode_attempts', rows.attempts)
      return
    }
    if (module === 'jobs') {
      const rows = jobsRowsOf(this.stores.jobs.snapshot(), userId)
      await deleteUserRows(client, 'job_roles', userId) // cascades stage transitions
      await insertRows(client, 'job_roles', rows.roles)
      await insertRows(client, 'job_stage_transitions', rows.transitions)
      return
    }
    // notes: attachments are local-only for now (binary files live on disk;
    // storage-backed attachment sync is later work), so only folders + pages.
    const rows = notesRowsOf(this.stores.notes.snapshot(), userId)
    await deleteUserRows(client, 'note_pages', userId)
    await deleteUserRows(client, 'note_folders', userId)
    await insertRows(client, 'note_folders', rows.folders)
    await insertRows(client, 'note_pages', rows.pages)
  }

  private async pullModule(
    client: SupabaseClient,
    module: SyncModule,
    userId: string
  ): Promise<void> {
    const today = jobLocalDate(new Date())
    if (module === 'home') {
      const [tasks, contexts, scratchBlocks, savedTaskViews] = await Promise.all([
        fetchUserRows<TaskRow>(client, 'tasks', 'id, user_id, title, context, estimate_minutes, priority, status, due, tags, recurrence', userId, 'created_at'),
        fetchUserRows<ContextRow>(client, 'contexts', 'user_id, name, color, icon', userId, 'name'),
        fetchUserRows<ScratchBlockRow>(client, 'scratch_blocks', 'id, user_id, task_id, date, start_time, end_time, portion, created_at, expires_at', userId, 'created_at'),
        fetchUserRows<SavedTaskViewRow>(client, 'saved_task_views', 'id, user_id, name, rules', userId, 'name')
      ])
      const total = tasks.length + contexts.length + scratchBlocks.length + savedTaskViews.length
      if (total === 0) {
        this.seedCloudFromLocal(module)
        return
      }
      this.stores.home.replaceAll(
        homeStateOf({ tasks, contexts, scratchBlocks, savedTaskViews }),
        new Date().toISOString()
      )
      return
    }
    if (module === 'habits') {
      const [habits, lifecycle, entries, freezeUsage, freezeGrants, finalizedDays, monthPools] =
        await Promise.all([
          fetchUserRows<HabitRow>(client, 'habits', 'id, user_id, name, kind, target_label, created_on, created_at', userId, 'created_at'),
          fetchUserRows<HabitLifecycleRow>(client, 'habit_lifecycle', 'user_id, habit_id, date, status, created_at', userId, 'date'),
          fetchUserRows<HabitEntryRow>(client, 'habit_entries', 'user_id, habit_id, date, value, created_at, updated_at', userId, 'date'),
          fetchUserRows<HabitDateRow>(client, 'habit_freeze_usage', 'user_id, habit_id, date', userId, 'date'),
          fetchUserRows<UserDateRow>(client, 'habit_freeze_grants', 'user_id, date', userId, 'date'),
          fetchUserRows<UserDateRow>(client, 'habit_finalized_days', 'user_id, date', userId, 'date'),
          fetchUserRows<HabitMonthPoolRow>(client, 'habit_month_pools', 'user_id, month, capacity', userId, 'month')
        ])
      const total =
        habits.length + lifecycle.length + entries.length + freezeUsage.length +
        freezeGrants.length + finalizedDays.length + monthPools.length
      if (total === 0) {
        this.seedCloudFromLocal(module)
        return
      }
      this.stores.habits.replaceAll(
        habitSyncStateOf({ habits, lifecycle, entries, freezeUsage, freezeGrants, finalizedDays, monthPools }),
        today
      )
      return
    }
    if (module === 'moodFocus') {
      const rows = await fetchUserRows<MoodFocusRow>(
        client,
        'mood_focus_entries',
        'user_id, date, mood, focus, note, note_source, created_at, updated_at',
        userId,
        'date'
      )
      if (rows.length === 0) {
        this.seedCloudFromLocal(module)
        return
      }
      this.stores.moodFocus.replaceAll(moodFocusEntriesOf(rows), today)
      return
    }
    if (module === 'leetcode') {
      const [problems, attempts] = await Promise.all([
        fetchUserRows<LeetCodeProblemRow>(client, 'leetcode_problems', 'user_id, id, topic, name, difficulty, curriculum_order', userId, 'curriculum_order'),
        fetchUserRows<LeetCodeAttemptRow>(client, 'leetcode_attempts', 'id, user_id, problem_id, date, solution, created_at, updated_at', userId, 'created_at')
      ])
      if (problems.length + attempts.length === 0) {
        this.seedCloudFromLocal(module)
        return
      }
      this.stores.leetCode.replaceAll(leetCodeSyncStateOf({ problems, attempts }), today)
      return
    }
    if (module === 'jobs') {
      const [roles, transitions] = await Promise.all([
        fetchUserRows<JobRoleRow>(client, 'job_roles', 'id, user_id, company, role, location, link, posted, stage, applied, oa_due, interview1, interview2, interview3, decision, resume_id, created_at, updated_at', userId, 'created_at'),
        fetchUserRows<JobTransitionRow>(client, 'job_stage_transitions', 'id, user_id, role_id, from_stage, to_stage, at', userId, 'at')
      ])
      if (roles.length + transitions.length === 0) {
        this.seedCloudFromLocal(module)
        return
      }
      this.stores.jobs.replaceAll(jobsSyncStateOf({ roles, transitions }), today)
      return
    }
    const [folders, pages] = await Promise.all([
      fetchUserRows<NoteFolderRow>(client, 'note_folders', 'id, user_id, name, parent_folder_id, created_at, updated_at', userId, 'created_at'),
      fetchUserRows<NotePageRow>(client, 'note_pages', 'id, user_id, title, folder_id, parent_page_id, content_json, favorite, status, created_at, updated_at, last_opened_at, archived_at, deleted_at', userId, 'created_at')
    ])
    if (folders.length + pages.length === 0) {
      this.seedCloudFromLocal(module)
      return
    }
    this.stores.notes.replaceAll(notesStateOf({ folders, pages }))
  }

  private seedCloudFromLocal(module: SyncModule): void {
    // An uninitialized store has nothing to seed and its snapshot() would
    // throw (no today/summary metadata yet); the first real mutation after
    // the store loads will schedule the seeding push instead.
    if (!this.moduleStore(module).initialized()) {
      console.log('manor-sync cloud and local both empty, nothing to seed', { module })
      return
    }
    console.log('manor-sync cloud empty, seeding from local state', { module })
    this.schedulePush(module)
  }

  private moduleStore(module: SyncModule): { initialized: () => boolean } {
    if (module === 'home') return this.stores.home
    if (module === 'habits') return this.stores.habits
    if (module === 'moodFocus') return this.stores.moodFocus
    if (module === 'leetcode') return this.stores.leetCode
    if (module === 'jobs') return this.stores.jobs
    return this.stores.notes
  }
}

function moduleOfChannel(channel: string): SyncModule | null {
  const separator = channel.indexOf(':')
  if (separator === -1) return null
  return MODULE_BY_CHANNEL_PREFIX[channel.slice(0, separator)] ?? null
}

/** Wrap module bridge channels so every successful mutation schedules a
    debounced push. Used by both the Electron IPC registration and the dev
    browser bridge, so both runtimes exercise the same pipeline. */
export function withPushScheduling(
  channels: Record<string, BridgeChannelHandler>,
  engine: SyncEngine
): Record<string, BridgeChannelHandler> {
  const wrapped: Record<string, BridgeChannelHandler> = {}
  for (const [channel, handler] of Object.entries(channels)) {
    const module = moduleOfChannel(channel)
    if (module === null || UNSYNCED_CHANNELS.has(channel)) {
      wrapped[channel] = handler
      continue
    }
    wrapped[channel] = (args) => {
      const result = handler(args)
      if (result instanceof Promise) {
        return result.then((value: unknown) => {
          engine.schedulePush(module)
          return value
        })
      }
      engine.schedulePush(module)
      return result
    }
  }
  return wrapped
}

/** Wrap the account channels: sign-in hydrates from the cloud before it
    resolves, sign-out stops all cloud scheduling. */
export function withAccountSync(
  channels: Record<string, BridgeChannelHandler>,
  engine: SyncEngine
): Record<string, BridgeChannelHandler> {
  const signIn = channels['account:sign-in']
  const signUp = channels['account:sign-up']
  const signOut = channels['account:sign-out']
  return {
    ...channels,
    'account:sign-in': async (args) => {
      const account = (await signIn(args)) as AccountInfo
      await engine.pullAll(account.userId)
      return account
    },
    'account:sign-up': async (args) => {
      const account = (await signUp(args)) as AccountInfo
      await engine.pullAll(account.userId)
      return account
    },
    'account:sign-out': (args) => {
      engine.stop()
      return signOut(args)
    }
  }
}

/** Boot-with-session hydration; call once per process start after the stores
    and client exist. Resolves quietly when no session is persisted. */
export async function pullOnBoot(
  engine: SyncEngine,
  clientOf: () => SupabaseClient
): Promise<void> {
  const account = await accountOf(clientOf())
  if (account === null) return
  await engine.pullAll(account.userId)
}
