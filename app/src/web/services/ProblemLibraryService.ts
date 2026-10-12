import { z } from 'zod'
import {
  problemContentSchema, problemRecordSchema, problemSavedViewSchema, problemSavedViewInputSchema, saveProblemInputSchema,
  type ProblemDetail, type ProblemLibraryApi, type ProblemLibraryState, type ProblemRecord, type ProblemSavedView,
  problemCodeDraftSchema, saveProblemDraftInputSchema,
  mergeProblemDuplicatesInputSchema, unmergeProblemDuplicateInputSchema, type MergeProblemDuplicatesInput, type UnmergeProblemDuplicateInput,
  type ProblemCodeDraft, type ProblemLanguage, type SaveProblemDraftInput, type SaveProblemInput, type SaveProblemViewInput
} from '../../shared/problemLibrary'
import { parseLeetCodeAttempt, parseLeetCodeNote } from '../../shared/leetcode'
import { requestFailure, rowSchema, type JsonObject, type ManorGateway } from '../ManorGateway'
import { camelRow, commandRecord, rowRevision } from './rows'
import { recoverableProblemDrafts } from '../problems/codeDraftStore'

const detailSchema = z.object({ problem: rowSchema, content: rowSchema.nullable(), can_execute: z.boolean(), grading_available: z.boolean(), requested_id: z.string(), requested_problem: rowSchema, requested_content: rowSchema.nullable(), source_records: z.array(rowSchema).min(1).max(100) })

function problemRow(row: JsonObject, solved: ReadonlySet<string>): ProblemRecord {
  return problemRecordSchema.parse({ ...camelRow(row), status: solved.has(String(row.id)) ? 'solved' : row.status ?? row.practice_status ?? 'unattempted' })
}

/** Metadata is mirrored locally; full versioned statements are fetched only when opened. */
export class ProblemLibraryService implements ProblemLibraryApi {
  private readonly gateway: ManorGateway
  private solved = new Set<string>()

  constructor(gateway: ManorGateway) { this.gateway = gateway }

  async load(): Promise<ProblemLibraryState> {
    const [problems, views, attemptRows, noteRows] = await Promise.all([
      this.gateway.rows('leetcode_problems'), this.gateway.rows('saved_problem_views'),
      this.gateway.rows('leetcode_attempts'), this.gateway.rows('leetcode_notes')
    ])
    const attempts = attemptRows.map(row => ({ ...parseLeetCodeAttempt(camelRow(row)), revision: rowRevision(row) }))
    this.solved = new Set(attempts.map(attempt => attempt.problemId))
    return {
      problems: problems.map(row => problemRow(row, this.solved)),
      views: views.map(row => problemSavedViewSchema.parse(camelRow(row))), attempts,
      notes: noteRows.map(row => ({ ...parseLeetCodeNote(camelRow(row)), revision: rowRevision(row) }))
    }
  }

  async loadProblem(id: string): Promise<ProblemDetail> {
    const { data, error, status } = await this.gateway.client.rpc('manor_problem_query', { p_query: 'read_problem', p_input: { id } })
    if (error !== null) throw requestFailure('Read problem', error, status)
    const detail = detailSchema.parse(data)
    return {
      problem: problemRecordSchema.parse({ ...camelRow(detail.problem), status: this.solved.has(id) || detail.problem.status === 'solved' ? 'solved' : detail.problem.practice_status ?? detail.problem.status ?? 'unattempted' }),
      content: detail.content === null ? null : problemContentSchema.parse(camelRow(detail.content)),
      canExecute: detail.can_execute,
      gradingAvailable: detail.grading_available,
      requestedId: detail.requested_id, requestedProblem: problemRow(detail.requested_problem, this.solved),
      requestedContent: detail.requested_content === null ? null : problemContentSchema.parse(camelRow(detail.requested_content)),
      sourceRecords: detail.source_records.map(row => problemRow(row, this.solved))
    }
  }

  async saveProblem(input: SaveProblemInput): Promise<ProblemDetail> {
    const parsed = saveProblemInputSchema.parse(input)
    const content = parsed.content === null ? null : {
      statement_markdown: parsed.content.statementMarkdown, examples: parsed.content.examples, hints: parsed.content.hints,
      solution_markdown: parsed.content.solutionMarkdown, starter_code: parsed.content.starterCode, interface: parsed.content.interface
    }
    const receipt = await this.gateway.command('save_problem', {
      id: parsed.id, expected_revision: parsed.expectedRevision, name: parsed.name, difficulty: parsed.difficulty,
      kind: parsed.kind, topics: parsed.topics, companies: parsed.companies, tags: parsed.tags, collections: parsed.collections,
      source_url: parsed.sourceUrl, source_type: parsed.sourceType, external_key: parsed.externalKey, ...(parsed.sourceMetadata === undefined ? {} : { source_metadata: parsed.sourceMetadata }), content
    }, crypto.randomUUID())
    return this.loadProblem(z.string().parse(commandRecord(receipt).id))
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

  async mergeDuplicates(input: MergeProblemDuplicatesInput): Promise<ProblemDetail> {
    const parsed = mergeProblemDuplicatesInputSchema.parse(input)
    await navigator.locks.request(`manor-account:${this.gateway.accountId}`, async () => {
      const pending = await recoverableProblemDrafts(this.gateway.accountId, parsed.aliases.map(alias => alias.id))
      if (pending.length > 0) throw new Error(`Source ${pending[0].problemId} has unsaved ${pending[0].language} code on this device. Keep it separate and save that draft before grouping it.`)
      await this.gateway.command('merge_problem_duplicates', { id: parsed.id, expected_revision: parsed.expectedRevision, name: parsed.name, reason: parsed.reason, aliases: parsed.aliases.map(alias => ({ id: alias.id, expected_revision: alias.expectedRevision })) }, parsed.requestId)
    })
    return this.loadProblem(parsed.id)
  }

  async unmergeDuplicate(input: UnmergeProblemDuplicateInput): Promise<ProblemDetail> {
    const parsed = unmergeProblemDuplicateInputSchema.parse(input)
    await this.gateway.command('unmerge_problem_duplicate', { id: parsed.id, expected_revision: parsed.expectedRevision, canonical_expected_revision: parsed.canonicalExpectedRevision }, parsed.requestId)
    return this.loadProblem(parsed.id)
  }
}
