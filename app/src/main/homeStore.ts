import { DatabaseSync } from 'node:sqlite'

import {
  parseContext,
  parseContextDefinition,
  parseHomeSeed,
  parseSavedTaskView,
  parseScratchBlock,
  parseTask
} from '../shared/home'
import type {
  ContextDefinition,
  ContextDraft,
  HomeSeed,
  HomeState,
  SavedTaskView,
  ScratchBlock,
  Task
} from '../shared/home'

interface JsonRow {
  payload: string
}

interface ContextRow {
  name: string
  payload: string | null
}

const LEGACY_CONTEXT_COLOR = 'plum'
const LEGACY_CONTEXT_ICON = 'target'

export class HomeStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS home_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contexts (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        payload TEXT
      );
      CREATE TABLE IF NOT EXISTS scratch_blocks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS saved_task_views (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const contextColumns = this.database.prepare('PRAGMA table_info(contexts)').all() as unknown as Array<{ name: string }>
    if (!contextColumns.some((column) => column.name === 'payload')) {
      this.database.exec('ALTER TABLE contexts ADD COLUMN payload TEXT')
    }
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: HomeSeed, nowIso: string): HomeState {
    const seed = parseHomeSeed(seedValue)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const initialized = this.database
        .prepare("SELECT value FROM home_metadata WHERE key = 'initialized'")
        .get()
      if (initialized === undefined) {
        const insertTask = this.database.prepare(
          'INSERT INTO tasks (id, payload, updated_at) VALUES (?, ?, ?)'
        )
        const insertContext = this.database.prepare(
          'INSERT INTO contexts (name, payload) VALUES (?, ?)'
        )
        const insertBlock = this.database.prepare(
          'INSERT INTO scratch_blocks (id, task_id, payload, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        const insertView = this.database.prepare(
          'INSERT INTO saved_task_views (id, payload, updated_at) VALUES (?, ?, ?)'
        )
        seed.tasks.forEach((task) => insertTask.run(task.id, JSON.stringify(task), nowIso))
        seed.contexts.forEach((context) =>
          insertContext.run(context.name, JSON.stringify(context))
        )
        seed.scratchBlocks.forEach((block) =>
          insertBlock.run(block.id, block.taskId, JSON.stringify(block), block.expiresAt, nowIso)
        )
        seed.savedTaskViews.forEach((view) =>
          insertView.run(view.id, JSON.stringify(view), nowIso)
        )
        this.database
          .prepare("INSERT INTO home_metadata (key, value) VALUES ('initialized', ?)")
          .run(nowIso)
      }
      this.migrateLegacyContexts(seed.contexts)
      this.database.prepare('DELETE FROM scratch_blocks WHERE expires_at <= ?').run(nowIso)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.readState()
  }

  upsertTask(value: Task, nowIso: string): Task {
    const task = parseTask(value)
    this.database
      .prepare(`
        INSERT INTO tasks (id, payload, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .run(task.id, JSON.stringify(task), nowIso)
    return task
  }

  deleteTask(taskIdValue: string): void {
    const taskId = parseContext(taskIdValue)
    const result = this.database.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    if (result.changes === 0) {
      throw new Error(`Cannot delete task ${taskId}: no persisted task has that id`)
    }
  }

  addContext(value: ContextDraft): ContextDefinition {
    const context = parseContextDefinition(value)
    this.database
      .prepare('INSERT OR IGNORE INTO contexts (name, payload) VALUES (?, ?)')
      .run(context.name, JSON.stringify(context))
    const row = this.database
      .prepare('SELECT name, payload FROM contexts WHERE name = ? COLLATE NOCASE')
      .get(context.name) as unknown as ContextRow | undefined
    if (row === undefined) {
      throw new Error(`Context ${context.name} was not persisted`)
    }
    if (row.payload === null) {
      throw new Error(`Context ${context.name} has no persisted presentation metadata`)
    }
    return parseContextDefinition(JSON.parse(row.payload))
  }

  upsertScratchBlock(value: ScratchBlock, nowIso: string): ScratchBlock {
    const block = parseScratchBlock(value)
    this.database
      .prepare(`
        INSERT INTO scratch_blocks (id, task_id, payload, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          payload = excluded.payload,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `)
      .run(block.id, block.taskId, JSON.stringify(block), block.expiresAt, nowIso)
    return block
  }

  deleteScratchBlock(blockIdValue: string): void {
    const blockId = parseContext(blockIdValue)
    const result = this.database.prepare('DELETE FROM scratch_blocks WHERE id = ?').run(blockId)
    if (result.changes === 0) {
      throw new Error(`Cannot delete scratch block ${blockId}: no persisted block has that id`)
    }
  }

  upsertSavedTaskView(value: SavedTaskView, nowIso: string): SavedTaskView {
    const view = parseSavedTaskView(value)
    this.database
      .prepare(`
        INSERT INTO saved_task_views (id, payload, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .run(view.id, JSON.stringify(view), nowIso)
    return view
  }

  deleteSavedTaskView(viewIdValue: string): void {
    const viewId = parseContext(viewIdValue)
    const result = this.database.prepare('DELETE FROM saved_task_views WHERE id = ?').run(viewId)
    if (result.changes === 0) {
      throw new Error(`Cannot delete saved task view ${viewId}: no persisted view has that id`)
    }
  }

  private readState(): HomeState {
    const taskRows = this.database
      .prepare('SELECT payload FROM tasks ORDER BY rowid')
      .all() as unknown as JsonRow[]
    const contextRows = this.database
      .prepare('SELECT name, payload FROM contexts ORDER BY name COLLATE NOCASE')
      .all() as unknown as ContextRow[]
    const blockRows = this.database
      .prepare('SELECT payload FROM scratch_blocks ORDER BY updated_at')
      .all() as unknown as JsonRow[]
    const viewRows = this.database
      .prepare('SELECT payload FROM saved_task_views ORDER BY updated_at DESC')
      .all() as unknown as JsonRow[]
    return {
      tasks: taskRows.map((row) => parseTask(JSON.parse(row.payload))),
      contexts: contextRows.map((row) => {
        if (row.payload === null) {
          throw new Error(`Context ${row.name} has no persisted presentation metadata`)
        }
        return parseContextDefinition(JSON.parse(row.payload))
      }),
      scratchBlocks: blockRows.map((row) => parseScratchBlock(JSON.parse(row.payload))),
      savedTaskViews: viewRows.map((row) => parseSavedTaskView(JSON.parse(row.payload)))
    }
  }

  private migrateLegacyContexts(seedContexts: readonly ContextDefinition[]): void {
    const seedByName = new Map(
      seedContexts.map((context) => [context.name.toLocaleLowerCase(), context])
    )
    const rows = this.database
      .prepare('SELECT name, payload FROM contexts WHERE payload IS NULL')
      .all() as unknown as ContextRow[]
    const update = this.database.prepare('UPDATE contexts SET payload = ? WHERE name = ?')
    rows.forEach((row) => {
      const definition = seedByName.get(row.name.toLocaleLowerCase()) ?? {
        name: parseContext(row.name),
        color: LEGACY_CONTEXT_COLOR,
        icon: LEGACY_CONTEXT_ICON
      }
      update.run(JSON.stringify(parseContextDefinition(definition)), row.name)
    })
  }
}
