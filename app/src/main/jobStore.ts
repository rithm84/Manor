import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  parseJobRole,
  parseJobDate,
  parseJobRoleFields,
  parseJobRoleId,
  parseJobRoleUpdate,
  parseJobsSeed,
  parseJobStageMutation,
  parseJobTransition
} from '../shared/jobs'
import type {
  JobRole,
  JobRoleFields,
  JobRoleUpdate,
  JobsSeed,
  JobsState,
  JobStage,
  JobStageMutation,
  JobStageTransition
} from '../shared/jobs'

interface PayloadRow {
  payload: string
}

interface TransitionRow {
  id: string
  role_id: string
  from_stage: string | null
  to_stage: string
  changed_at: string
}

interface MetadataRow {
  value: string
}

export class JobStore {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS jobs_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_roles (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_stage_transitions (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        from_stage TEXT CHECK (from_stage IS NULL OR from_stage IN ('to_apply', 'applied', 'oa', 'interview_1', 'interview_2', 'interview_3', 'offer', 'rejected')),
        to_stage TEXT NOT NULL CHECK (to_stage IN ('to_apply', 'applied', 'oa', 'interview_1', 'interview_2', 'interview_3', 'offer', 'rejected')),
        changed_at TEXT NOT NULL,
        FOREIGN KEY (role_id) REFERENCES job_roles(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS job_stage_transitions_role_time
        ON job_stage_transitions(role_id, changed_at);
    `)
  }

  close(): void {
    this.database.close()
  }

  load(seedValue: JobsSeed, todayValue: string): JobsState {
    const seed = parseJobsSeed(seedValue)
    const today = parseJobDate(todayValue, 'current local date')
    this.transaction(() => {
      const initialized = this.database
        .prepare("SELECT value FROM jobs_metadata WHERE key = 'initialized'")
        .get()
      if (initialized === undefined) {
        this.seed(seed, today)
      } else {
        this.database
          .prepare("UPDATE jobs_metadata SET value = ? WHERE key = 'today'")
          .run(today)
      }
    })
    return this.readState()
  }

  createRole(fieldsValue: JobRoleFields, nowIso: string): JobsState {
    const fields = parseJobRoleFields(fieldsValue)
    this.transaction(() => {
      const role: JobRole = parseJobRole({
        id: `job-${randomUUID()}`,
        ...fields,
        createdAt: nowIso,
        updatedAt: nowIso
      })
      this.insertRole(role)
      this.appendTransition(role.id, null, role.stage, nowIso)
    })
    return this.readState()
  }

  updateRole(mutationValue: JobRoleUpdate, nowIso: string): JobsState {
    const mutation = parseJobRoleUpdate(mutationValue)
    this.transaction(() => {
      const previous = this.readRole(mutation.id)
      const next = parseJobRole({
        id: previous.id,
        ...mutation.fields,
        createdAt: previous.createdAt,
        updatedAt: nowIso
      })
      this.database
        .prepare('UPDATE job_roles SET payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(next), nowIso, next.id)
      if (previous.stage !== next.stage) {
        this.appendTransition(next.id, previous.stage, next.stage, nowIso)
      }
    })
    return this.readState()
  }

  setStage(mutationValue: JobStageMutation, nowIso: string): JobsState {
    const mutation = parseJobStageMutation(mutationValue)
    this.transaction(() => {
      const previous = this.readRole(mutation.id)
      if (previous.stage === mutation.stage) {
        return
      }
      const next = parseJobRole({ ...previous, stage: mutation.stage, updatedAt: nowIso })
      this.database
        .prepare('UPDATE job_roles SET payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(next), nowIso, next.id)
      this.appendTransition(next.id, previous.stage, next.stage, nowIso)
    })
    return this.readState()
  }

  deleteRole(roleIdValue: string): JobsState {
    const roleId = parseJobRoleId(roleIdValue)
    const result = this.database.prepare('DELETE FROM job_roles WHERE id = ?').run(roleId)
    if (result.changes !== 1) {
      throw new Error(`Cannot delete role ${roleId}: no persisted role has that id`)
    }
    return this.readState()
  }

  private seed(seed: JobsSeed, today: string): void {
    seed.roles.forEach((role) => this.insertRole(role))
    const insertTransition = this.database.prepare(`
      INSERT INTO job_stage_transitions (id, role_id, from_stage, to_stage, changed_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    seed.transitions.forEach((transition) =>
      insertTransition.run(
        transition.id,
        transition.roleId,
        transition.fromStage,
        transition.toStage,
        transition.changedAt
      )
    )
    const initializedAt = new Date().toISOString()
    this.database
      .prepare("INSERT INTO jobs_metadata (key, value) VALUES ('initialized', ?)")
      .run(initializedAt)
    this.database
      .prepare("INSERT INTO jobs_metadata (key, value) VALUES ('today', ?)")
      .run(today)
  }

  private insertRole(role: JobRole): void {
    this.database
      .prepare(`
        INSERT INTO job_roles (id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(role.id, JSON.stringify(role), role.createdAt, role.updatedAt)
  }

  private appendTransition(
    roleId: string,
    fromStage: JobStage | null,
    toStage: JobStage,
    changedAt: string
  ): void {
    const transition: JobStageTransition = parseJobTransition({
      id: `job-transition-${randomUUID()}`,
      roleId,
      fromStage,
      toStage,
      changedAt
    })
    this.database
      .prepare(`
        INSERT INTO job_stage_transitions (id, role_id, from_stage, to_stage, changed_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        transition.id,
        transition.roleId,
        transition.fromStage,
        transition.toStage,
        transition.changedAt
      )
  }

  private readRole(roleId: string): JobRole {
    const row = this.database
      .prepare('SELECT payload FROM job_roles WHERE id = ?')
      .get(roleId) as PayloadRow | undefined
    if (row === undefined) {
      throw new Error(`Cannot update role ${roleId}: no persisted role has that id`)
    }
    return parseJobRole(JSON.parse(row.payload))
  }

  private readToday(): string {
    const row = this.database
      .prepare("SELECT value FROM jobs_metadata WHERE key = 'today'")
      .get() as MetadataRow | undefined
    if (row === undefined) {
      throw new Error('Jobs store is missing its today metadata')
    }
    return row.value
  }

  private readState(): JobsState {
    const roleRows = this.database
      .prepare('SELECT payload FROM job_roles ORDER BY created_at DESC, id')
      .all() as unknown as PayloadRow[]
    const transitionRows = this.database
      .prepare(`
        SELECT id, role_id, from_stage, to_stage, changed_at
        FROM job_stage_transitions
        ORDER BY changed_at, rowid
      `)
      .all() as unknown as TransitionRow[]
    return {
      today: this.readToday(),
      roles: roleRows.map((row) => parseJobRole(JSON.parse(row.payload))),
      transitions: transitionRows.map((row) =>
        parseJobTransition({
          id: row.id,
          roleId: row.role_id,
          fromStage: row.from_stage,
          toStage: row.to_stage,
          changedAt: row.changed_at
        })
      )
    }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      operation()
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}
