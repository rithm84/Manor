import { z } from 'zod'
import type { LeetCodeAttempt, LeetCodeNote } from './leetcode'
import { problemSourceMetadataSchema, problemSourceDateBounds } from './problemSourceMetadata'
import { topicFilterPatterns } from './problemTopics'

export const PROBLEM_KINDS = ['coding', 'system_design', 'behavioral', 'other'] as const
export const PROBLEM_LANGUAGES = ['cpp', 'c', 'python', 'javascript', 'java', 'go'] as const
export const PROBLEM_SOURCE_TYPES = ['stock', 'imported', 'custom'] as const
export const PROBLEM_STATUSES = ['unattempted', 'attempted', 'solved'] as const
export const PROBLEM_COLUMNS = ['difficulty', 'kind', 'topics', 'companies', 'tags', 'collections', 'status', 'lastAsked'] as const

const labelSchema = z.string().trim().min(1).max(100)
const labelsSchema = z.array(labelSchema).max(100).refine(values => new Set(values).size === values.length, 'Labels must be unique')
const idSchema = z.string().min(1).max(200)
const revisionSchema = z.number().int().nonnegative()
export const problemDifficultySchema = z.enum(['Easy', 'Medium', 'Hard']).nullable()
export const problemKindSchema = z.enum(PROBLEM_KINDS)
export const problemLanguageSchema = z.enum(PROBLEM_LANGUAGES)
export type ProblemKind = z.infer<typeof problemKindSchema>
export type ProblemLanguage = z.infer<typeof problemLanguageSchema>
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number]

export const problemExampleSchema = z.object({
  input: z.string().max(100000), output: z.string().max(100000), explanation: z.string().max(100000).nullable()
})
const interfaceParamSchema = z.object({ name: z.string().min(1).max(64), type: z.string().min(1).max(64), shape: z.string().min(1).max(200).optional(), ref: z.string().min(1).max(64).optional() })
const interfaceMethodSchema = z.object({ name: z.string().min(1).max(64), params: z.array(interfaceParamSchema).max(20), returns: z.string().min(1).max(64), output: z.object({ mode: z.literal('prefix'), param: z.string() }).optional() })
/** Hidden parameters, judge-provided APIs and their interactor, and offered languages; see the judge's problemInterface.ts. */
const interfaceExtras = {
  hidden: z.array(interfaceParamSchema).max(20).optional(),
  apis: z.array(z.object({ name: z.string().min(1).max(64), methods: z.array(interfaceMethodSchema).min(1).max(20), global: z.boolean().optional(), pointer: z.boolean().optional() })).max(5).optional(),
  interactor: z.string().max(49152).optional(),
  languages: z.array(problemLanguageSchema).min(1).max(6).optional(),
}
/** A typed solving interface; drivers and type grammar live with the judge (supabase/functions/_shared/problemInterface.ts). */
export const problemInterfaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('function'), name: z.string().min(1).max(64), params: z.array(interfaceParamSchema).max(20), returns: z.string().min(1).max(64),
    output: z.discriminatedUnion('mode', [z.object({ mode: z.literal('return'), ref: z.object({ param: z.string(), by: z.enum(['value', 'index']) }).optional(), shape: z.string().min(1).max(64).optional() }), z.object({ mode: z.literal('param'), param: z.string() }), z.object({ mode: z.literal('prefix'), param: z.string() })]), ...interfaceExtras }),
  z.object({ kind: z.literal('class'), className: z.string().min(1).max(64), constructorParams: z.array(interfaceParamSchema).max(20),
    methods: z.array(interfaceMethodSchema).min(1).max(50), concurrency: z.boolean().optional(), ...interfaceExtras }),
  z.object({ kind: z.literal('codec'), className: z.string().min(1).max(64), sharedInstance: z.boolean(),
    encode: z.object({ name: z.string().min(1).max(64), param: interfaceParamSchema, returns: z.string().min(1).max(64) }),
    decode: z.object({ name: z.string().min(1).max(64), param: interfaceParamSchema, returns: z.string().min(1).max(64) }), languages: z.array(problemLanguageSchema).min(1).max(6).optional() }),
])
export type ProblemInterface = z.infer<typeof problemInterfaceSchema>
const problemContentInputSchema = z.object({
  statementMarkdown: z.string().min(1).max(1000000),
  examples: z.array(problemExampleSchema).max(100),
  hints: z.array(z.string().min(1).max(100000)).max(100),
  solutionMarkdown: z.string().max(1000000).nullable(),
  starterCode: z.partialRecord(problemLanguageSchema, z.string().max(100000)),
  interface: problemInterfaceSchema.nullable().default(null)
})
export const problemContentSchema = problemContentInputSchema.extend({
  problemId: idSchema, version: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true })
})
export type ProblemContent = z.infer<typeof problemContentSchema>

export const problemRecordSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(500), difficulty: problemDifficultySchema,
  kind: problemKindSchema, topics: labelsSchema, companies: z.array(labelSchema).max(1000).refine(values => new Set(values).size === values.length, 'Company labels must be unique'), tags: labelsSchema, collections: labelsSchema,
  sourceUrl: z.url().max(2000).refine(value => /^https?:\/\//.test(value), 'Source links must use HTTP or HTTPS').nullable(), sourceType: z.enum(PROBLEM_SOURCE_TYPES), externalKey: idSchema.nullable(),
  sourceMetadata: problemSourceMetadataSchema.optional(),
  canonicalProblemId: idSchema.nullable().optional(), sourceName: z.string().min(1).max(500).nullable().optional(), duplicateReason: z.string().min(1).max(2000).nullable().optional(),
  contentAvailable: z.boolean(), contentVersion: z.number().int().nonnegative(), revision: z.number().int().positive(),
  status: z.enum(PROBLEM_STATUSES), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true })
})
export type ProblemRecord = z.infer<typeof problemRecordSchema>
export interface ProblemDetail {
  readonly problem: ProblemRecord; readonly content: ProblemContent | null; readonly canExecute: boolean; readonly gradingAvailable: boolean
  readonly requestedId: string; readonly requestedProblem: ProblemRecord; readonly requestedContent: ProblemContent | null; readonly sourceRecords: readonly ProblemRecord[]
}

export const problemFiltersSchema = z.object({
  search: z.string().max(500), kinds: z.array(problemKindSchema).max(4),
  difficulties: z.array(z.enum(['Easy', 'Medium', 'Hard'])).max(3),
  topics: labelsSchema, companies: labelsSchema, tags: labelsSchema, collections: labelsSchema,
  sourceTypes: z.array(z.enum(PROBLEM_SOURCE_TYPES)).max(3), hasContent: z.boolean().nullable(),
  statuses: z.array(z.enum(PROBLEM_STATUSES)).max(3), lastAskedSince: z.iso.date().nullable().optional(), lastAskedUntil: z.iso.date().nullable().optional()
})
export const problemSortSchema = z.object({
  field: z.enum(['name', 'difficulty', 'kind', 'createdAt', 'updatedAt', 'lastAsked']), direction: z.enum(['asc', 'desc'])
})
export const problemSavedViewInputSchema = z.object({
  id: idSchema, expectedRevision: revisionSchema, name: z.string().trim().min(1).max(120),
  filters: problemFiltersSchema, sort: z.array(problemSortSchema).min(1).max(5),
  groupBy: z.enum(['topic', 'company', 'difficulty', 'kind', 'collection']).nullable(),
  visibleColumns: z.array(z.enum(PROBLEM_COLUMNS)).min(1).max(8)
})
export const problemSavedViewSchema = problemSavedViewInputSchema.omit({ expectedRevision: true }).extend({ revision: z.number().int().positive() })
export type ProblemFilters = z.infer<typeof problemFiltersSchema>
export type ProblemSort = z.infer<typeof problemSortSchema>
export type ProblemSavedView = z.infer<typeof problemSavedViewSchema>
export type SaveProblemViewInput = z.infer<typeof problemSavedViewInputSchema>

export const saveProblemDraftInputSchema = z.object({
  id: idSchema, problemId: idSchema, language: problemLanguageSchema, contentVersion: z.number().int().positive(),
  source: z.string().max(262144).refine(value => new TextEncoder().encode(value).byteLength <= 262144, 'Code drafts must contain at most 256 KiB of UTF-8 source'), expectedRevision: revisionSchema, requestId: z.uuid()
})
export const problemCodeDraftSchema = saveProblemDraftInputSchema.omit({ expectedRevision: true, requestId: true }).extend({
  revision: z.number().int().positive(), updatedAt: z.iso.datetime({ offset: true })
})
export type SaveProblemDraftInput = z.infer<typeof saveProblemDraftInputSchema>
export type ProblemCodeDraft = z.infer<typeof problemCodeDraftSchema>
export interface ProblemLibraryState {
  readonly problems: readonly ProblemRecord[]
  readonly views: readonly ProblemSavedView[]
  readonly attempts: readonly LeetCodeAttempt[]
  readonly notes: readonly LeetCodeNote[]
}
/** The library as the app uses it. Problems are read-only in the app; custom problems change only through Codex. */
export interface ProblemLibraryApi {
  load(): Promise<ProblemLibraryState>
  loadProblem(id: string): Promise<ProblemDetail>
  saveView(input: SaveProblemViewInput): Promise<ProblemSavedView>
  deleteView(input: { id: string; expectedRevision: number }): Promise<void>
  loadDraft(problemId: string, language: ProblemLanguage): Promise<ProblemCodeDraft | null>
  saveDraft(input: SaveProblemDraftInput): Promise<ProblemCodeDraft>
}

export function emptyProblemFilters(): ProblemFilters {
  return { search: '', kinds: [], difficulties: [], topics: [], companies: [], tags: [], collections: [], sourceTypes: [], hasContent: null, statuses: [], lastAskedSince: null, lastAskedUntil: null }
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true })

/** Tag facets are the evidence prefix before ': ' (Round, Role, Technology, Employment); unprefixed tags form their own facet. */
function tagFacet(tag: string): string { const at = tag.indexOf(': '); return at < 0 ? '' : tag.slice(0, at) }

/** Search relevance: a LeetCode number or exact title first (the LeetCode problem ahead of same-titled imports), then title prefixes, title words, title text, and finally other labels. */
export function searchRank(problem: ProblemRecord, search: string): number {
  const name = problem.name.toLocaleLowerCase()
  if (problem.externalKey === `leetcode:${search}`) return 0
  if (name === search) return problem.sourceType === 'stock' ? 0 : 1
  if (name.startsWith(search)) return 2
  if (name.includes(' ' + search)) return 3
  return name.includes(search) ? 4 : 5
}

/** Filters combine with AND; values within one property, or within one tag facet such as Round, combine with OR. A topic category matches any of its patterns. While searching, relevance orders results before the chosen sort. */
export function filterProblems(problems: readonly ProblemRecord[], filters: ProblemFilters, sort: readonly ProblemSort[]): ProblemRecord[] {
  const search = filters.search.trim().toLocaleLowerCase()
  const overlaps = (actual: readonly string[], selected: readonly string[]): boolean => selected.length === 0 || selected.some(value => actual.includes(value))
  const tagGroups = [...new Set(filters.tags.map(tagFacet))].map(facet => filters.tags.filter(tag => tagFacet(tag) === facet))
  const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 }
  return problems.filter(problem =>
    (search === '' || problem.externalKey === `leetcode:${search}` || [problem.name, ...problem.topics, ...problem.companies, ...problem.tags].join(' ').toLocaleLowerCase().includes(search)) &&
    overlaps([problem.kind], filters.kinds) && overlaps(problem.difficulty === null ? [] : [problem.difficulty], filters.difficulties) &&
    (filters.topics.length === 0 || filters.topics.some(value => topicFilterPatterns(value).some(topic => problem.topics.includes(topic)))) && overlaps(problem.companies, filters.companies) && tagGroups.every(group => overlaps(problem.tags, group)) &&
    overlaps(problem.collections, filters.collections) && overlaps([problem.sourceType], filters.sourceTypes) &&
    overlaps([problem.status], filters.statuses) && (filters.hasContent === null || problem.contentAvailable === filters.hasContent) &&
    ((!filters.lastAskedSince && !filters.lastAskedUntil) || (problem.sourceMetadata?.lastAsked !== undefined &&
      (!filters.lastAskedSince || problemSourceDateBounds(problem.sourceMetadata.lastAsked)[1] >= filters.lastAskedSince) &&
      (!filters.lastAskedUntil || problemSourceDateBounds(problem.sourceMetadata.lastAsked)[0] <= filters.lastAskedUntil)))
  ).sort((left, right) => {
    if (search !== '') { const ranked = searchRank(left, search) - searchRank(right, search); if (ranked !== 0) return ranked }
    for (const rule of sort) {
      if (rule.field === 'lastAsked') {
        const leftDate = left.sourceMetadata?.lastAsked; const rightDate = right.sourceMetadata?.lastAsked
        if (leftDate === undefined || rightDate === undefined) { if (leftDate !== rightDate) return leftDate === undefined ? 1 : -1; continue }
        const compared = problemSourceDateBounds(leftDate)[0].localeCompare(problemSourceDateBounds(rightDate)[0])
        if (compared !== 0) return rule.direction === 'asc' ? compared : -compared
        continue
      }
      const compared = rule.field === 'difficulty'
        ? (left.difficulty === null ? 3 : difficultyOrder[left.difficulty]) - (right.difficulty === null ? 3 : difficultyOrder[right.difficulty])
        : naturalOrder.compare(String(left[rule.field]), String(right[rule.field]))
      if (compared !== 0) return rule.direction === 'asc' ? compared : -compared
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}
