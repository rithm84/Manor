import { z } from 'zod'
import {
  problemContentSchema, problemRecordSchema, problemSavedViewSchema, problemSavedViewInputSchema,
  type ProblemDetail, type ProblemLibraryApi, type ProblemLibraryState, type ProblemSavedView,
  problemCodeDraftSchema, saveProblemDraftInputSchema,
  type ProblemCodeDraft, type ProblemLanguage, type SaveProblemDraftInput, type SaveProblemViewInput
} from '../../shared/problemLibrary'
import { parseLeetCodeAttempt, parseLeetCodeNote } from '../../shared/leetcode'
import { requestFailure, rowSchema, type JsonObject, type ManorGateway } from '../ManorGateway'
import { joinCatalogDetail } from '../mirror/catalogRows'
import { CATALOG_DETAIL_TABLE, rowKey, type StoredTable } from '../mirror/mirrorTables'
import { canonicalIdOf, libraryRecords, practiceState, problemDetail, problemStatus, type PracticeState } from './problemCatalogFold'
import { camelRow, commandRecord, rowRevision } from './rows'

const detailSchema = z.object({ problem: rowSchema, content: rowSchema.nullable(), can_execute: z.boolean(), grading_available: z.boolean(), requested_id: z.string(), requested_problem: rowSchema, requested_content: rowSchema.nullable(), source_records: z.array(rowSchema).min(1).max(100) })

/** Thrown inside a mirror composition when the mirror cannot answer, which sends the open to the server. */
class MirrorCannotAnswer extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'MirrorCannotAnswer'
  }
}

/**
 * The problem library: the shared Manor catalog, the account's custom problems, and the account's practice.
 * The library reads mirrored rows, and opening a problem composes it from mirrored rows too, so neither waits
 * for the network once the mirror serves them. Problems are read-only here; custom problems change only
 * through Codex.
 */
export class ProblemLibraryService implements ProblemLibraryApi {
  private readonly gateway: ManorGateway

  constructor(gateway: ManorGateway) { this.gateway = gateway }

  async load(): Promise<ProblemLibraryState> {
    const [catalog, custom, practice, views, attemptRows, noteRows] = await Promise.all([
      this.gateway.rows('problem_catalog'), this.gateway.rows('leetcode_problems'), this.gateway.rows('problem_practice'),
      this.gateway.rows('saved_problem_views'), this.gateway.rows('leetcode_attempts'), this.gateway.rows('leetcode_notes')
    ])
    const attempts = attemptRows.map(row => ({ ...parseLeetCodeAttempt(camelRow(row)), revision: rowRevision(row) }))
    return {
      problems: libraryRecords(catalog, custom, practiceState(attempts, practice)),
      views: views.map(row => problemSavedViewSchema.parse(camelRow(row))), attempts,
      notes: noteRows.map(row => ({ ...parseLeetCodeNote(camelRow(row)), revision: rowRevision(row) }))
    }
  }

  /** Composes the problem from the mirror, and asks the server only while the mirror cannot answer for it. */
  async loadProblem(id: string): Promise<ProblemDetail> {
    try { return await this.composeFromMirror(id) }
    catch (cause: unknown) {
      if (!(cause instanceof MirrorCannotAnswer)) throw cause
      return this.readFromServer(id)
    }
  }

  /** One stored row, or a `MirrorCannotAnswer` when the mirror is not serving that table. */
  private async stored(table: StoredTable, key: string): Promise<JsonObject | null> {
    const lookup = await this.gateway.mirroredRow(table, key)
    if (!lookup.serving) throw new MirrorCannotAnswer(`The mirror is not serving ${table}`)
    return lookup.row
  }

  /** A whole problem row: catalog rows get their source evidence back, custom rows are stored whole. */
  private async wholeRow(row: JsonObject): Promise<JsonObject> {
    if (row.user_id !== null && row.user_id !== undefined) return row
    return joinCatalogDetail(row, await this.stored(CATALOG_DETAIL_TABLE, rowKey('problem_catalog', row)))
  }

  /** The current statement of a problem row, from the catalog's statements or the account's custom ones. */
  private async currentContent(row: JsonObject): Promise<JsonObject | null> {
    const version = z.number().int().nonnegative().parse(row.content_version)
    if (row.content_available !== true || version === 0) return null
    const id = z.string().parse(row.id)
    const custom = row.user_id !== null && row.user_id !== undefined
    const content = custom
      ? await this.stored('problem_content_versions', rowKey('problem_content_versions', { problem_id: id, version }))
      : await this.stored('problem_catalog_content', id)
    // A pull that has applied the problem but not yet its new statement leaves the copy briefly behind.
    if (content === null || content.version !== version) throw new MirrorCannotAnswer(`The mirror does not yet hold version ${version} of the statement of ${id}`)
    return content
  }

  private async composeFromMirror(id: string): Promise<ProblemDetail> {
    const requestedIndex = await this.stored('problem_catalog', id) ?? await this.stored('leetcode_problems', id)
    // A problem the mirror has not pulled yet may still exist; the server says whether it does.
    if (requestedIndex === null) throw new MirrorCannotAnswer(`The mirror does not hold problem ${id}`)
    const canonicalId = canonicalIdOf(requestedIndex)
    const [catalog, custom, practice, attemptRows] = await Promise.all([
      this.gateway.rows('problem_catalog'), this.gateway.rows('leetcode_problems'), this.gateway.rows('problem_practice'), this.gateway.rows('leetcode_attempts')
    ])
    const members = await Promise.all([...catalog, ...custom]
      .filter(row => row.id === canonicalId || row.canonical_problem_id === canonicalId)
      .map(row => this.wholeRow(row)))
    const requested = members.find(row => row.id === id)
    if (requested === undefined) throw new MirrorCannotAnswer(`The library index does not yet list problem ${id}`)
    const canonical = members.find(row => row.id === canonicalId)
    if (canonical === undefined) throw new MirrorCannotAnswer(`The library index does not yet list the canonical problem ${canonicalId}`)
    const [content, requestedContent] = await Promise.all([this.currentContent(canonical), id === canonicalId ? null : this.currentContent(requested)])
    const state = practiceState(attemptRows.map(row => parseLeetCodeAttempt(camelRow(row))), practice)
    return problemDetail({ requested, members, content, requestedContent: id === canonicalId ? content : requestedContent }, state)
  }

  /** `manor_problem_query('read_problem')`, which answers while the mirror is still filling or behind. */
  private async readFromServer(id: string): Promise<ProblemDetail> {
    const { data, error, status } = await this.gateway.client.rpc('manor_problem_query', { p_query: 'read_problem', p_input: { id } })
    if (error !== null) throw requestFailure('Read problem', error, status)
    const detail = detailSchema.parse(data)
    const attempts = await this.gateway.rows('leetcode_attempts')
    const solved = new Set(attempts.map(row => z.string().parse(row.problem_id)))
    const state: PracticeState = { solved, recorded: new Map() }
    const record = (row: JsonObject): ProblemDetail['problem'] => {
      const own = problemStatus(z.string().parse(row.id), state)
      return problemRecordSchema.parse({ ...camelRow(row), status: own === 'solved' ? own : row.status ?? 'unattempted' })
    }
    return {
      problem: record(detail.problem),
      content: detail.content === null ? null : problemContentSchema.parse(camelRow(detail.content)),
      canExecute: detail.can_execute,
      gradingAvailable: detail.grading_available,
      requestedId: detail.requested_id, requestedProblem: record(detail.requested_problem),
      requestedContent: detail.requested_content === null ? null : problemContentSchema.parse(camelRow(detail.requested_content)),
      sourceRecords: detail.source_records.map(record)
    }
  }

  async saveView(input: SaveProblemViewInput): Promise<ProblemSavedView> {
    const parsed = problemSavedViewInputSchema.parse(input)
    const receipt = await this.gateway.command('save_problem_view', {
      id: parsed.id, expected_revision: parsed.expectedRevision, name: parsed.name, filters: parsed.filters,
      sort: parsed.sort, group_by: parsed.groupBy, visible_columns: parsed.visibleColumns
    }, crypto.randomUUID())
    return problemSavedViewSchema.parse(camelRow(commandRecord(receipt)))
  }

  async deleteView(input: { id: string; expectedRevision: number }): Promise<void> {
    await this.gateway.command('delete_problem_view', {
      id: z.string().min(1).max(200).parse(input.id), expected_revision: z.number().int().positive().parse(input.expectedRevision)
    }, crypto.randomUUID())
  }

  async loadDraft(problemId: string, language: ProblemLanguage): Promise<ProblemCodeDraft | null> {
    const { data, error, status } = await this.gateway.client.rpc('manor_problem_query', {
      p_query: 'read_problem_draft', p_input: { problem_id: problemId, language }
    })
    if (error !== null) throw requestFailure('Read problem code draft', error, status)
    return data === null ? null : problemCodeDraftSchema.parse(camelRow(rowSchema.parse(data)))
  }

  async saveDraft(input: SaveProblemDraftInput): Promise<ProblemCodeDraft> {
    const parsed = saveProblemDraftInputSchema.parse(input)
    const receipt = await this.gateway.command('save_problem_draft', {
      id: parsed.id, expected_revision: parsed.expectedRevision, problem_id: parsed.problemId, language: parsed.language,
      content_version: parsed.contentVersion, source: parsed.source
    }, parsed.requestId)
    return problemCodeDraftSchema.parse(camelRow(commandRecord(receipt)))
  }
}
