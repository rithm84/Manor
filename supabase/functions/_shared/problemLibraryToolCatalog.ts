import { command, domainQuery, edit, id, object, paging, type ManorTool, type ToolSchema } from './toolDefinitions.ts'

const labels: ToolSchema = { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 100 } }
const kind: ToolSchema = { type: 'string', enum: ['coding', 'system_design', 'behavioral', 'other'] }
const sourceType: ToolSchema = { type: 'string', enum: ['stock', 'imported', 'custom'] }
const language: ToolSchema = { type: 'string', enum: ['cpp', 'c', 'python', 'javascript', 'java', 'go'] }
const sourceDate: ToolSchema = object({ value: { type: 'string', minLength: 4, maxLength: 40 }, precision: { type: 'string', enum: ['day', 'month', 'year', 'instant'] } }, ['value', 'precision'])
const sourceMetadata: ToolSchema = object({
  lastAsked: sourceDate, reportedFrom: sourceDate, reportedTo: sourceDate,
  frequency: { type: 'string', minLength: 1, maxLength: 100 }, reportCount: { type: 'integer', minimum: 0, maximum: 2147483647 },
  isNew: { type: 'boolean' }, durationMinutes: { type: 'integer', minimum: 0, maximum: 1000000 }, status: { type: 'string', minLength: 1, maxLength: 100 },
  snapshots: { type: 'array', maxItems: 100, items: object({ sourceUrl: { type: 'string', maxLength: 2000 }, snapshotDate: { type: 'string', maxLength: 10 }, revision: { type: 'string', minLength: 1, maxLength: 200 } }, ['sourceUrl', 'snapshotDate']) },
  companyReports: { type: 'array', maxItems: 5000, items: object({
    company: { type: 'string', minLength: 1, maxLength: 100 }, window: { type: 'string', enum: ['30d', '3m', '6m', '1y', 'all', 'older_than_6m'] },
    frequency: { type: ['number', 'null'], minimum: 0, maximum: 100 }, acceptance: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    snapshotDate: { type: 'string', maxLength: 10 }, sourceUrl: { type: 'string', maxLength: 2000 }, sourceRevision: { type: 'string', minLength: 1, maxLength: 200 }
  }, ['company', 'window', 'frequency', 'acceptance', 'snapshotDate', 'sourceUrl', 'sourceRevision']) }
}, [])
const content: ToolSchema = {
  type: ['object', 'null'], additionalProperties: false,
  properties: {
    statement_markdown: { type: 'string', minLength: 1, maxLength: 1000000 },
    examples: { type: 'array', maxItems: 100, items: object({ input: { type: 'string', maxLength: 100000 }, output: { type: 'string', maxLength: 100000 }, explanation: { type: ['string', 'null'], maxLength: 100000 } }, ['input', 'output', 'explanation']) },
    hints: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 100000 } },
    solution_markdown: { type: ['string', 'null'], maxLength: 1000000 },
    starter_code: object(Object.fromEntries(['cpp', 'c', 'python', 'javascript', 'java', 'go'].map(key => [key, { type: 'string', maxLength: 100000 } as ToolSchema])), []),
    interface: { type: ['object', 'null'], description: 'Typed solving interface. Omit to keep the current one; null removes it. Function: {kind:"function",name,params:[{name,type}],returns,output:{mode:"return"|"param"|"prefix",param?}}. Class: {kind:"class",className,constructorParams,methods:[{name,params,returns}]}. Codec round trip: {kind:"codec",className,encode:{name,param:{name,type},returns},decode:{name,param:{name,type},returns},sharedInstance}. Types: int, long, double, bool, string, char, ListNode, TreeNode, RandomListNode, GraphNode, NaryNode, NextNode, T[], list<T>. Typed problems read one JSON value per parameter line, one line for a codec value, or two lines (operations, arguments) for classes.' }
  }, required: ['statement_markdown', 'examples', 'hints', 'solution_markdown', 'starter_code']
}
const testset: ToolSchema = object({
  checker: { type: 'string', enum: ['exact', 'trimmed', 'json', 'numeric', 'json_unordered', 'json_unordered_deep', 'json_tolerant', 'special'] }, judge: { type: 'string', maxLength: 65536, description: 'Python source defining check(args, output, expected) -> bool; required for and only allowed with the special checker.' }, provenance: { type: 'string', enum: ['generated', 'source', 'user'] },
  cases: { type: 'array', minItems: 1, maxItems: 200, items: object({ id: { type: 'string', minLength: 1, maxLength: 100 }, input: { type: 'string', maxLength: 1048576, description: 'At most 1 MiB of UTF-8.' }, expectedOutput: { type: 'string', maxLength: 65536, description: 'At most 64 KiB of UTF-8.' }, hidden: { type: 'boolean' } }, ['id', 'input', 'expectedOutput', 'hidden']) }
}, ['checker', 'provenance', 'cases'])
const problemFields = {
  ...edit, name: { type: 'string', minLength: 1, maxLength: 500 } as ToolSchema,
  difficulty: { type: ['string', 'null'], enum: ['Easy', 'Medium', 'Hard', null] } as ToolSchema,
  kind, topics: labels, companies: { ...labels, maxItems: 1000 }, tags: labels, collections: labels,
  source_type: sourceType, source_url: { type: ['string', 'null'], maxLength: 2000 } as ToolSchema,
  external_key: { type: ['string', 'null'], minLength: 1, maxLength: 200 } as ToolSchema,
  source_metadata: sourceMetadata, content, testset
}
const problemRequired = ['id', 'expected_revision', 'name', 'difficulty', 'kind', 'topics', 'companies', 'tags', 'collections', 'source_type', 'source_url', 'external_key', 'content']
const filters = object({
  search: { type: 'string', maxLength: 500 }, kinds: { type: 'array', maxItems: 4, items: kind },
  difficulties: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] } },
  topics: labels, companies: labels, tags: labels, collections: labels,
  sourceTypes: { type: 'array', maxItems: 3, items: sourceType }, hasContent: { type: ['boolean', 'null'] },
  statuses: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['unattempted', 'attempted', 'solved'] } },
  lastAskedSince: { type: ['string', 'null'], maxLength: 10 }, lastAskedUntil: { type: ['string', 'null'], maxLength: 10 }
}, ['search', 'kinds', 'difficulties', 'topics', 'companies', 'tags', 'collections', 'sourceTypes', 'hasContent', 'statuses'])
const sort: ToolSchema = { type: 'array', minItems: 1, maxItems: 5, items: object({ field: { type: 'string', enum: ['name', 'difficulty', 'kind', 'createdAt', 'updatedAt', 'lastAsked'] }, direction: { type: 'string', enum: ['asc', 'desc'] } }, ['field', 'direction']) }

export const problemLibraryTools: readonly ManorTool[] = [
  domainQuery('query_problems', 'manor_problem_query', 'Read each canonical problem group once, with topic, company, collection, source, recency, and content filters. Retained-source labels participate in filters. Statements load separately; cursor is stable problem ID order.', {
    ...paging, search: { type: 'string', maxLength: 500 }, kind, difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
    topic: id, company: id, tag: id, collection: id, source_type: sourceType, has_content: { type: 'boolean' }, status: { type: 'string', enum: ['unattempted', 'attempted', 'solved'] },
    last_asked_since: { type: 'string', maxLength: 10 }, last_asked_until: { type: 'string', maxLength: 10 }
  }, []),
  domainQuery('read_problem', 'manor_problem_query', 'Read the canonical problem and all retained source records. When an alias is requested, requested_problem and requested_content preserve its exact identity and statement for draft recovery. Hidden grading tests are never returned.', { id }, ['id']),
  domainQuery('list_problem_views', 'manor_problem_query', 'Read saved problem filters, sorts, grouping, and columns.', paging, []),
  command('save_problem', 'Create or edit a general problem at its current revision. Null content preserves the current statement. Content changes create an immutable version. Optional testsets are stored privately and never exposed to clients. An external key deduplicates repeated source imports.', problemFields, problemRequired),
  command('import_problems', 'Atomically import 1 to 100 problems. Supply stable IDs and external source keys, revision zero for new entries, or the current revision to update. An unchanged deduplicated source returns unchanged; concurrent edits conflict. Reuse command_id on retries. Return per-problem committed outcomes.', { items: { type: 'array', minItems: 1, maxItems: 100, items: object(problemFields, problemRequired) } }, ['items']),
  command('merge_problem_duplicates', 'Reversibly group functionally equivalent imported source records under one reviewed title. Preserve all source IDs, content versions, and provenance. Stock and custom problems remain separate. Sources with attempts, drafts, submissions, or an open editor cannot be hidden. Account-global mistake jots remain independent. Choose a canonical source with a current grader when any source has one. Similar titles alone are insufficient evidence.', {
    ...edit, name: { type: 'string', minLength: 1, maxLength: 500 }, reason: { type: 'string', minLength: 1, maxLength: 2000 }, aliases: { type: 'array', minItems: 1, maxItems: 99, items: object(edit, ['id', 'expected_revision']) }
  }, ['id', 'expected_revision', 'name', 'reason', 'aliases']),
  command('unmerge_problem_duplicate', 'Restore a retained source to the index without deleting or moving its content or history. Requires both source and canonical revisions.', { ...edit, canonical_expected_revision: { type: 'integer', minimum: 1 } }, ['id', 'expected_revision', 'canonical_expected_revision']),
  command('save_problem_view', 'Create or edit an account-owned saved view. Values within a filter property combine with OR; properties combine with AND.', {
    ...edit, name: { type: 'string', minLength: 1, maxLength: 120 }, filters, sort,
    group_by: { type: ['string', 'null'], enum: ['topic', 'company', 'difficulty', 'kind', 'collection', null] },
    visible_columns: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', enum: ['difficulty', 'kind', 'topics', 'companies', 'tags', 'collections', 'status', 'lastAsked'] } }
  }, ['id', 'expected_revision', 'name', 'filters', 'sort', 'group_by', 'visible_columns']),
  command('delete_problem_view', 'Remove a saved view at its current revision without changing any problems.', edit, ['id', 'expected_revision']),
  domainQuery('read_problem_draft', 'manor_problem_query', 'Read the cloud-saved code draft for one problem and language. Unsynced local edits are unavailable to MCP.', { problem_id: id, language }, ['problem_id', 'language']),
  command('save_problem_draft', 'Protect a code draft in the cloud at its current revision and statement version. Exact source whitespace is preserved. This does not execute or submit code.', {
    ...edit, problem_id: id, language, content_version: { type: 'integer', minimum: 1 }, source: { type: 'string', maxLength: 262144, description: 'At most 256 KiB when encoded as UTF-8.' }
  }, ['id', 'expected_revision', 'problem_id', 'language', 'content_version', 'source'])
]
