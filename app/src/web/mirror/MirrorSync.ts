import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

import { dateInTimezone } from '../../shared/timezone'
import { isManorTable, ManorConnectionError, type JsonObject, type JsonValue, type ManorGateway, type ManorTable } from '../ManorGateway'
import { IDENTITY_BATCH_LIMITS, readIdentityRows } from './identityReads'
import type { DerivedName, MirrorRow, MirrorStatus, MirrorStore } from './MirrorStore'
import {
  HOURLY_TABLES, JOB_ROLE_DEPENDENTS, LAUNCH_REFRESH_TABLES, MIRROR_TABLES,
  needsRebuild, rowKey, rowRevisionOf, standingFilters, touchedWithoutRevision, type MirrorTable
} from './mirrorTables'
import { groupFeedChanges, planTableApply, type TableChanges } from './pullPlan'
import { FEED_PAGE_SIZE, WorkspaceFeed } from './WorkspaceFeed'

/** How often the mirror catches up on its own, so a missed poke costs a minute rather than a session. */
const POKE_INTERVAL_MS = 60_000

/** Feed-less tables change on the server's schedule, so they are replaced on launch and on this cadence. */
const FEEDLESS_INTERVAL_MS = 3_600_000

/** One pull walks at most this many pages. Beyond it the feed is not something a catch-up should chase. */
const MAX_FEED_BATCHES = 100

/** How many tables a bootstrap fills at once: enough to overlap round trips, few enough to leave the
 * connection to the page that is still loading behind it. */
const BOOTSTRAP_CONCURRENCY = 4

/** The derived read `leetcode_problems` feeds, which a refresh of that table has to drop. */
const LEETCODE_SUMMARY: DerivedName = 'manor_leetcode_summary'

/**
 * Raised when `stop()` runs while a pass sits between awaits. The pass then abandons its work instead of
 * writing into a mirror the app has left, which after a sign-out or an account switch is somebody else's.
 */
class MirrorAbandoned extends Error {
  constructor(accountId: string) {
    super(`The local mirror of ${accountId} stopped while it was catching up`)
    this.name = 'MirrorAbandoned'
  }
}

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function toMirrorRow(table: MirrorTable, row: JsonObject): MirrorRow {
  return { key: rowKey(table, row), data: row, revision: rowRevisionOf(row) }
}

/**
 * Keeps this account's local mirror current and answers reads from it.
 *
 * The server stays authoritative: nothing is written locally, and every change arrives as a poke followed
 * by a pull of `manor_workspace_changes`. A pull never trusts the feed's contents, only its ordering: it
 * deletes by key and re-reads inserted or updated rows by identity. The cursor moves only after an apply
 * finishes, so an interrupted pull repeats instead of skipping.
 */
export class MirrorSync {
  private readonly gateway: ManorGateway
  private readonly store: MirrorStore
  private readonly client: SupabaseClient
  private readonly feed: WorkspaceFeed
  private timezone: string
  private opened: Promise<void> | null = null
  /** The shell handed over a mirror file. Without one, pokes fall back to invalidating the query cache. */
  private available = false
  /** The mirror holds a complete copy of every table as of `cursor`. */
  private isReady = false
  /** The copy is current enough to answer reads. A failed pull parks reads on the server until one succeeds. */
  private serving = false
  private stopped = false
  private firstRun = true
  private cursor = 0
  private channel: RealtimeChannel | null = null
  private readonly teardown: (() => void)[] = []
  private chain: Promise<void> = Promise.resolve()
  private queued: Promise<void> | null = null

  constructor(gateway: ManorGateway, store: MirrorStore, client: SupabaseClient, accountTimezone: string) {
    this.gateway = gateway
    this.store = store
    this.client = client
    this.feed = new WorkspaceFeed(client)
    this.timezone = accountTimezone
  }

  /**
   * Opens the mirror, brings it up to date, and installs the pokes that keep it there. Reads stay on the
   * server until this resolves, so a first launch and a broken mirror behave the same way as before.
   */
  async start(): Promise<MirrorStatus> {
    if (this.opened !== null) throw new Error('This account mirror is already started')
    this.opened = this.store.open(this.gateway.accountId).then(
      (status) => {
        this.available = true
        this.cursor = status.cursor
        this.isReady = status.ready
        this.serving = status.ready
      },
      (cause: unknown) => {
        // The mirror is a copy, not the record: without it Manor still runs, one server round trip at a time.
        console.error('Manor could not open the local mirror, so reads stay on the server', { accountId: this.gateway.accountId, cause: detail(cause) })
      }
    )
    await this.opened
    if (this.stopped) return this.report()
    this.installPokes()
    await this.pull()
    return this.report()
  }

  stop(): void {
    this.stopped = true
    this.serving = false
    for (const undo of this.teardown.splice(0)) undo()
    if (this.channel !== null) {
      void this.client.removeChannel(this.channel)
      this.channel = null
    }
  }

  /** Whether reads are being answered from the mirror right now. */
  isServing(): boolean {
    return this.serving
  }

  /** The profile's time zone decides which day a derived value was computed for; it can change mid-session. */
  setAccountTimezone(timezone: string): void {
    this.timezone = timezone
  }

  /** The mirrored rows of one table, or null when reads belong on the server. */
  async mirroredRows(table: MirrorTable): Promise<JsonObject[] | null> {
    if (this.opened === null) throw new Error('Start the account mirror before reading through it')
    await this.opened
    if (!this.serving) return null
    return (await this.store.rows(this.gateway.accountId, table)).map((row) => row.data)
  }

  /**
   * Serves an account-derived read from the cache while both the cursor and the account-local day still
   * match the ones it was computed under. Both derived reads depend on nothing else, so the rule is exact.
   */
  async derived(name: DerivedName, load: () => Promise<JsonValue>): Promise<JsonValue> {
    if (this.opened === null) throw new Error('Start the account mirror before reading through it')
    await this.opened
    if (!this.serving) return load()
    const day = dateInTimezone(new Date(), this.timezone)
    const cached = await this.store.getDerived(this.gateway.accountId, name)
    if (cached !== null && cached.cursor === this.cursor && cached.day === day) return cached.value
    // Reading the cursor before the RPC means a change that commits while it runs invalidates this value
    // instead of hiding underneath a cursor the value never saw.
    const cursor = this.cursor
    const value = await load()
    // A sign-out during the RPC leaves the answer good for this caller and the cache somebody else's.
    if (this.stopped) return value
    await this.store.putDerived(this.gateway.accountId, name, value, cursor, day)
    return value
  }

  /** Awaited by the gateway after a command commits, so the mirror leads the page's refetch. */
  afterCommand(): Promise<void> {
    return this.pull()
  }

  /** Catches the mirror up. Pokes that arrive while one pull runs collapse into a single follow-up. */
  pull(): Promise<void> {
    if (this.queued !== null) return this.queued
    const run = this.enqueue(() => {
      this.queued = null
      return this.run()
    })
    this.queued = run
    return run
  }

  /** One writer at a time: the store sees pulls and scheduled refreshes in the order they were asked for. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Refuses the next store write once `stop()` has run, which ends the pass before it touches the file. */
  private guardRunning(): void {
    if (this.stopped) throw new MirrorAbandoned(this.gateway.accountId)
  }

  private async run(): Promise<void> {
    if (this.stopped || !this.available) return
    try {
      // The launch pass ends only when it succeeds, so a launch that failed offline still checks the head
      // cursor and refreshes the feed-less tables the next time a poke arrives.
      if (!this.isReady || this.firstRun) {
        const head = await this.feed.cursor()
        if (needsRebuild({ ready: this.isReady, cursor: this.cursor }, head)) {
          // The feed walk below then applies whatever committed while the fill ran, including this tab's
          // own commands, which skip their after-commit pull until the mirror is serving.
          await this.bootstrap(head)
        } else {
          await this.refreshTables(LAUNCH_REFRESH_TABLES)
        }
        this.firstRun = false
      }
      await this.applyFeed()
      this.serving = this.isReady
    } catch (cause: unknown) {
      // The account this pass belonged to is gone, so its failure is the teardown working, not a fault.
      if (cause instanceof MirrorAbandoned) return
      const offline = cause instanceof ManorConnectionError
      // Offline is what a local copy is for, so it keeps serving. Any other failure means the copy may be
      // wrong, so reads return to the server until a pull succeeds and proves it current again.
      if (!offline) this.serving = false
      console.error('Manor could not refresh the local mirror', {
        accountId: this.gateway.accountId, cursor: this.cursor, ready: this.isReady, offline, cause: detail(cause)
      })
    }
  }

  /**
   * Fills an empty or stale mirror from the server, a few tables at a time. The head cursor is read first,
   * so any change committed during the fill lands after it and the feed walk that follows the fill applies it.
   */
  private async bootstrap(head: number): Promise<void> {
    for (let offset = 0; offset < MIRROR_TABLES.length; offset += BOOTSTRAP_CONCURRENCY) {
      const group = MIRROR_TABLES.slice(offset, offset + BOOTSTRAP_CONCURRENCY)
      // Settled rather than raced, so one table's failure does not leave its neighbours rejecting unheard.
      const results = await Promise.allSettled(group.map((table) => this.replaceTable(table)))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    this.guardRunning()
    await this.store.commit(this.gateway.accountId, head, true)
    this.cursor = head
    this.isReady = true
    // Reads move to the mirror before the refetches below are asked for, so the pages that reload read the
    // copy this pass just filled instead of going back to the server for it.
    this.serving = true
    await this.gateway.invalidate()
  }

  private async replaceTable(table: MirrorTable): Promise<void> {
    const rows = await this.gateway.readRowsFromServer(table, standingFilters(table))
    this.guardRunning()
    await this.store.replaceTable(this.gateway.accountId, table, rows.map((row) => toMirrorRow(table, row)))
  }

  private async applyFeed(): Promise<void> {
    const touched = new Set<MirrorTable>()
    // Tables with a feed trigger that the mirror does not hold. Their rows still reach pages through the
    // query cache and the committed event, so a change to one of them invalidates and announces as before.
    const ignored = new Set<ManorTable>()
    let applied = false
    for (let page = 0; ; page += 1) {
      if (page === MAX_FEED_BATCHES) {
        // The next pass bootstraps rather than walking this feed again from the same place.
        this.isReady = false
        throw new RangeError(`The change feed offered more than ${MAX_FEED_BATCHES * FEED_PAGE_SIZE} changes at once; rebuild the mirror instead of chasing it`)
      }
      const changes = await this.feed.changes(this.cursor, FEED_PAGE_SIZE)
      this.guardRunning()
      if (changes.length === 0) break
      applied = true
      const batch = groupFeedChanges(changes, this.cursor)
      for (const objectType of batch.ignored) if (isManorTable(objectType)) ignored.add(objectType)
      for (const [table, tableChanges] of batch.tables) {
        await this.applyTable(table, tableChanges)
        touched.add(table)
      }
      this.guardRunning()
      await this.store.commit(this.gateway.accountId, batch.lastCursor, true)
      this.cursor = batch.lastCursor
      if (changes.length < FEED_PAGE_SIZE) break
    }
    if (!applied) return
    if (touched.has('job_roles')) {
      for (const table of JOB_ROLE_DEPENDENTS) {
        await this.replaceTable(table)
        touched.add(table)
      }
    }
    const invalidated: ManorTable[] = [...touched, ...ignored]
    if (invalidated.length > 0) await this.gateway.invalidateTables(invalidated)
    this.announce()
  }

  private async applyTable(table: MirrorTable, changes: TableChanges): Promise<void> {
    this.guardRunning()
    if (changes.fullRefresh) {
      await this.replaceTable(table)
      return
    }
    // Local revisions are worth a read only when the feed offers a revision to compare them to; tables
    // without a revision column (calendar rows, listings) and recreated rows are always re-read, and so is
    // every row of a table an update can touch without moving its revision.
    const comparable = !touchedWithoutRevision(table)
      && [...changes.byKey.values()].some((change) => change.action === 'reread' && change.revision !== null && !change.recreated)
    const local = new Map<string, number | null>(
      comparable ? (await this.store.revisions(this.gateway.accountId, table)).map((row) => [row.key, row.revision]) : []
    )
    const plan = planTableApply(changes, local)
    const fetched = plan.lookups.length === 0
      ? []
      : await readIdentityRows(this.client, this.gateway.accountId, table, plan.lookups, IDENTITY_BATCH_LIMITS)
    const found = new Map(fetched.map((row) => [rowKey(table, row), row] as const))
    // A row that does not come back is gone or hidden by row-level security, which is a local delete either way.
    const vanished = plan.lookups.filter((change) => !found.has(change.key)).map((change) => change.key)
    const removals = [...plan.removals, ...vanished]
    if (removals.length > 0) {
      this.guardRunning()
      await this.store.deleteRows(this.gateway.accountId, table, removals)
    }
    if (found.size > 0) {
      this.guardRunning()
      await this.store.upsertRows(this.gateway.accountId, table, [...found].map(([key, row]) => ({ key, data: row, revision: rowRevisionOf(row) })))
    }
  }

  private async refreshTables(tables: readonly MirrorTable[]): Promise<void> {
    for (const table of tables) await this.replaceTable(table)
    // `leetcode_problems` carries no feed trigger, so a change to it never moves the cursor the summary was
    // cached under and the cached value would outlive the rows it summarises. Dropping it recomputes once.
    if (tables.includes('leetcode_problems')) {
      this.guardRunning()
      await this.store.deleteDerived(this.gateway.accountId, LEETCODE_SUMMARY)
    }
    await this.gateway.invalidateTables([...tables])
  }

  private async refreshFeedless(): Promise<void> {
    if (this.stopped || !this.available || !this.isReady) return
    await this.enqueue(() => this.refreshTables(HOURLY_TABLES)).catch((cause: unknown) => {
      if (cause instanceof MirrorAbandoned) return
      console.error('Manor could not refresh the shared tables in the local mirror', { accountId: this.gateway.accountId, cause: detail(cause) })
    })
  }

  private announce(): void {
    window.dispatchEvent(new CustomEvent('manor:committed', { detail: { operation: 'remote_change' } }))
  }

  private async report(): Promise<MirrorStatus> {
    return this.available ? this.store.status() : { ready: false, cursor: 0, rowCounts: {} }
  }

  private installPokes(): void {
    const poke = (): void => { void this.pull() }
    const onVisible = (): void => { if (document.visibilityState === 'visible') poke() }
    window.addEventListener('focus', poke)
    window.addEventListener('online', poke)
    document.addEventListener('visibilitychange', onVisible)
    const catchUp = window.setInterval(poke, POKE_INTERVAL_MS)
    const shared = window.setInterval(() => { void this.refreshFeedless() }, FEEDLESS_INTERVAL_MS)
    this.teardown.push(
      () => window.removeEventListener('focus', poke),
      () => window.removeEventListener('online', poke),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => window.clearInterval(catchUp),
      () => window.clearInterval(shared)
    )
    this.channel = this.client
      .channel(`manor:${this.gateway.accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_events', filter: `user_id=eq.${this.gateway.accountId}` }, (payload) => {
        // This tab's own commands pulled before their receipt returned, so their echo carries nothing new.
        if ('command_id' in payload.new && typeof payload.new.command_id === 'string' && this.gateway.issuedCommand(payload.new.command_id)) return
        if (!this.available) {
          void this.gateway.invalidate().then(() => this.announce())
          return
        }
        void this.pull()
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('Manor realtime subscription failed', { accountId: this.gateway.accountId })
      })
  }
}
