import { z } from 'zod'
import { manorTools, type JsonObject, type ManorTool, type ToolSchema } from '../../../supabase/functions/_shared/toolCatalog'

interface DomainDefinition {
  name: string
  description: string
  operations: readonly string[]
}

const domains: readonly DomainDefinition[] = [
  { name: 'notes', description: 'Notes document reads, stable block edits, import/export, versions, and optional suggestions.', operations: [
    'find_in_note', 'export_note', 'import_note', 'duplicate_note_blocks', 'edit_note_media',
    'query_notes', 'read_note', 'read_note_blocks', 'query_note_suggestions', 'list_note_versions', 'read_note_version',
    'create_note', 'update_note', 'edit_note_blocks', 'move_note_blocks', 'propose_note_edits', 'resolve_note_suggestions', 'restore_note_version'
  ] },
  { name: 'note_organization', description: 'Notes folder hierarchy, document duplication and moves, and recoverable note lifecycle.', operations: [
    'list_note_folders', 'duplicate_note', 'move_note', 'remove_empty_note_folder', 'create_note_folder', 'update_note_folder',
    'remove_note_folder', 'archive_note', 'trash_note', 'restore_note'
  ] },
  { name: 'home', description: 'Tasks, contexts, recurring occurrences, saved task views, Manor scratch blocks, and read-only connected calendar events.', operations: [
    'get_day_overview', 'query_calendar_events', 'save_task_view', 'delete_task_view', 'query_tasks', 'list_contexts', 'list_task_views',
    'query_scratch_blocks', 'create_tasks', 'update_tasks', 'create_context', 'update_context', 'remove_context', 'create_recurring_task',
    'skip_task_occurrence', 'update_future_task_occurrences', 'save_scratch_block', 'delete_scratch_block', 'trash_task', 'restore_task'
  ] },
  { name: 'habits', description: 'Habit definitions, dated entries, history, streaks, freeze pool, and lifecycle.', operations: [
    'query_habits', 'query_habit_history', 'clear_habit_entries', 'get_streak_status', 'create_habit', 'update_habit', 'set_habit_status',
    'log_habits', 'apply_habit_freeze', 'clear_habit_freeze'
  ] },
  { name: 'mood', description: 'Daily Mood and Focus records and evolving daily synthesis from debriefs. Never includes Journal.', operations: [
    'query_daily_records', 'commit_debrief'
  ] },
  { name: 'jobs', description: 'Job catalog, applications, application history, stages, and recoverable lifecycle.', operations: [
    'get_application_history', 'query_applications', 'query_job_catalog', 'add_applications', 'update_applications', 'add_job_listing',
    'trash_application', 'restore_application'
  ] },
  { name: 'leetcode', description: 'Curriculum problems, dated solve attempts and exact solutions, mistakes notes, summary, and freezes.', operations: [
    'query_attempts', 'query_problems', 'query_mistakes', 'get_leetcode_summary', 'apply_leetcode_freeze', 'clear_leetcode_freeze',
    'create_attempt', 'update_attempt', 'save_mistake', 'delete_attempt', 'delete_mistake'
  ] },
  { name: 'knowledge', description: 'Captured Knowledge, bookmarks, related-record links, exact text search, and semantic search across authorized modules.', operations: [
    'link_records', 'unlink_records', 'get_related_records', 'read_knowledge', 'semantic_search', 'query_knowledge', 'search', 'save_capture', 'remove_capture'
  ] },
  { name: 'workspace', description: 'Workspace context, preferences, integration/job/command status, history, metrics, Trash, recovery, and typed cross-module lifecycle batches.', operations: [
    'list_trash', 'get_workspace_context', 'get_metrics', 'get_operation_status', 'get_changes_since', 'get_background_run', 'get_preferences',
    'get_integration_status', 'update_preferences', 'retry_background_run', 'trash_records', 'restore_records', 'archive_records', 'unarchive_records', 'query_action_history'
  ] },
  { name: 'reviews_files', description: 'Frozen weekly-review inputs and saves, plus owned immutable files, resumes, upload verification, and download access.', operations: [
    'get_file_status', 'list_files', 'list_resumes', 'prepare_file_upload', 'finalize_file_upload', 'get_file_download',
    'query_weekly_reviews', 'get_weekly_review_input', 'save_weekly_review'
  ] }
]

export type BrowserGroupSchema = Omit<ToolSchema, 'properties' | 'items'> & {
  properties?: { [key: string]: BrowserGroupSchema }
  items?: BrowserGroupSchema
  oneOf?: BrowserGroupSchema[]
  const?: string
  $ref?: string
  $defs?: { [key: string]: BrowserGroupSchema }
}
// Operation names and typed fields carry routine behavior. These annotations retain
// semantics that schemas cannot express; the remote catalog keeps its full prose.
const browserSemantics: Readonly<Record<string, string>> = {
  read_note: 'Committed native blocks and revisions; local drafts are separate.',
  get_operation_status: 'Structural receipt only; missing means unrecorded, not necessarily failed.',
  get_background_run: 'Current sync-job state, not retained run history; no raw errors or payloads.',
  query_habit_history: 'Eligible tracked days including missingness; excludes paused/retired/future days; max 366 days.',
  get_metrics: 'Max 366 local dates; current completed_at task timestamps; eligible habit denominators.',
  edit_note_media: 'Full native properties and ready owned attachment URL; preserve IDs and immutable bytes.',
  duplicate_note_blocks: 'Fresh recursive block IDs; shared attachments; both note revisions required.',
  clear_habit_entries: 'Today/yesterday entries only; preserve definitions.',
  restore_records: 'Atomic recoverable restore; Notes preserves descendants. Select hierarchy roots.',

  find_in_note: 'Search text in one committed native document.',
  export_note: 'Lossless native block_json only; file bytes separate. Markdown unsupported.',
  import_note: 'Native block_json only; preserve block IDs. Attachments must be ready and owned.',
  duplicate_note: 'Copy at most 100 available notes atomically; fresh block IDs, shared attachments.',
  edit_note_blocks: 'Atomic anchored edits preserve unrelated blocks.',
  move_note_blocks: 'Atomic source and destination edit; supply both revisions.',
  propose_note_edits: 'Optional suggestion; direct requested edits need no proposal.',
  resolve_note_suggestions: 'Changed target blocks conflict instead of overwriting.',
  restore_note_version: 'Creates a new revision; retained versions remain.',
  remove_note_folder: 'Lift children into parent; remove_empty_note_folder rejects children.',
  query_calendar_events: 'Read-only connected calendar; scratch blocks never write to Google.',
  create_recurring_task: 'RRULE: DAILY/WEEKLY/MONTHLY, INTERVAL, weekly BYDAY, UNTIL.',
  update_future_task_occurrences: 'Preserve past/completed/skipped; null recurrence stops series.',
  create_tasks: 'Atomic batch; new records use revision zero.',
  update_tasks: 'Atomic sparse edits; Done records completion.',
  commit_debrief: 'Today/yesterday only. Preserve synthesis; save only explicit ratings.',
  query_daily_records: 'Missing ratings differ from Resting.',
  log_habits: 'Today/yesterday active roster; revision is dated entry, zero creates.',
  set_habit_status: 'Effective today; retirement preserves history.',
  apply_habit_freeze: 'Yesterday only; habit-definition revision.',
  apply_leetcode_freeze: 'Yesterday; five monthly freezes. Logged attempts refund usage.',
  create_attempt: 'Any past date; no future date. Preserve exact solution.',
  query_job_catalog: 'Shared listing is not an application until added.',
  save_capture: 'Already processed content; no additional normalization.',
  get_weekly_review_input: 'Frozen saved-timezone Sunday 22:00 window; preserve snapshot and watermark.',
  save_weekly_review: 'Match frozen snapshot exactly; never change reviewed source records.',
  prepare_file_upload: 'Up to 1GB; resumable endpoint uses upload_token as x-signature. Then finalize.',
  finalize_file_upload: 'Verify bytes/checksum; retry same upload ID resumes checkpoint.',
  get_file_download: 'Short-lived signed URL for owned ready file.',
  trash_records: 'Atomic seven-day Trash; Notes includes descendants. Select hierarchy roots.',
  archive_records: 'Archive preserves records; distinct from Trash.',
  retry_background_run: 'Failed, unleased sync job only; existing connection required.',
  get_changes_since: 'Commit-ordered cursor; 0 starts at feed installation. Acquire cursor before initial read.',
  get_preferences: 'Saved account preferences; browser appearance is separate.'
}

export interface BrowserToolGroup {
  name: string
  description: string
  inputSchema: BrowserGroupSchema
  readOnly: boolean
  operations: readonly ManorTool[]
}

/** Hoist constraints shared at the same input path; each branch keeps its closed key set. */
function hoistInputConstraints(schemas: readonly BrowserGroupSchema[]): { common: BrowserGroupSchema; branches: BrowserGroupSchema[] } {
  const branches = schemas.map(schema => ({ ...schema, ...(schema.properties ? { properties: { ...schema.properties } } : {}) }))
  const common: BrowserGroupSchema = { type: schemas[0]?.type }
  const keys = new Set(schemas.flatMap(schema => Object.keys(schema.properties ?? {})))
  const properties: { [key: string]: BrowserGroupSchema } = {}
  for (const key of keys) {
    const positions = schemas.flatMap((schema, index) => schema.properties?.[key] ? [index] : [])
    if (positions.length < 2) continue
    const values = positions.map(index => schemas[index]?.properties?.[key] ?? {})
    const first = values[0]
    if (!first) continue
    if (values.every(value => JSON.stringify(value) === JSON.stringify(first))) {
      properties[key] = first
      for (const index of positions) { const branch = branches[index]; if (branch?.properties) branch.properties[key] = {} }
    } else if (values.every(value => value.type === 'object' && value.properties)) {
      const nested = hoistInputConstraints(values)
      if (nested.common.properties && Object.keys(nested.common.properties).length > 0) {
        properties[key] = nested.common
        for (const [position, index] of positions.entries()) { const branch = branches[index]; if (branch?.properties) branch.properties[key] = nested.branches[position] ?? {} }
      }
    } else if (values.every(value => value.type === 'array' && value.items?.type === 'object')) {
      const nested = hoistInputConstraints(values.map(value => value.items ?? {}))
      if (nested.common.properties && Object.keys(nested.common.properties).length > 0) {
        properties[key] = { type: 'array', items: nested.common }
        for (const [position, index] of positions.entries()) { const branch = branches[index]; if (branch?.properties) branch.properties[key] = { ...values[position], items: nested.branches[position] ?? {} } }
      }
    }
  }
  if (Object.keys(properties).length > 0) common.properties = properties
  return { common, branches }
}

/** JSON Schema references reuse identical constraints without relaxing validation. */
function compactSchema(schema: BrowserGroupSchema): BrowserGroupSchema {
  const occurrences = new Map<string, { schema: BrowserGroupSchema; count: number }>()
  const visit = (node: BrowserGroupSchema): void => {
    const key = JSON.stringify(node)
    const previous = occurrences.get(key)
    occurrences.set(key, { schema: node, count: (previous?.count ?? 0) + 1 })
    for (const child of Object.values(node.properties ?? {})) visit(child)
    if (node.items) visit(node.items)
    for (const child of node.oneOf ?? []) visit(child)
  }
  visit(schema)
  const references = new Map<string, string>()
  for (const [key, value] of occurrences) {
    const name = `s${references.size}`
    const referenceBytes = JSON.stringify({ $ref: `#/$defs/${name}` }).length
    if (value.count > 1 && key.length * (value.count - 1) > referenceBytes * value.count + name.length + 4) references.set(key, name)
  }
  const used = new Set<string>()
  const encode = (node: BrowserGroupSchema, define: boolean): BrowserGroupSchema => {
    const reference = references.get(JSON.stringify(node))
    if (reference && !define) { used.add(reference); return { $ref: `#/$defs/${reference}` } }
    return { ...node,
      ...(node.properties ? { properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, encode(value, false)])) } : {}),
      ...(node.items ? { items: encode(node.items, false) } : {}),
      ...(node.oneOf ? { oneOf: node.oneOf.map(child => encode(child, false)) } : {})
    }
  }
  const output = encode(schema, true)
  const definitions: { [key: string]: BrowserGroupSchema } = {}
  // Encoding a used definition can discover another definition it references.
  for (const reference of used) {
    const source = [...references].find(([, name]) => name === reference)?.[0]
    const original = source ? occurrences.get(source)?.schema : undefined
    if (!original) throw new Error(`Missing compact schema definition ${reference}`)
    definitions[reference] = encode(original, true)
  }
  return used.size === 0 ? output : { ...output, $defs: definitions }
}

/** Explicit operation partitions reduce host tool count without weakening any contract. */
export function buildBrowserToolCatalog(tools: readonly ManorTool[]): BrowserToolGroup[] {
  const catalog = new Map<string, ManorTool>()
  for (const tool of tools) {
    if (catalog.has(tool.name)) throw new Error(`Shared tool catalog contains duplicate operation ${tool.name}`)
    catalog.set(tool.name, tool)
  }
  const assigned = new Set<string>()
  const groups: BrowserToolGroup[] = []
  for (const domain of domains) {
    const members = domain.operations.map(name => {
      if (assigned.has(name)) throw new Error(`Browser operation ${name} is assigned to more than one domain`)
      const tool = catalog.get(name)
      if (!tool) throw new Error(`Browser domain ${domain.name} references missing shared operation ${name}`)
      assigned.add(name)
      return tool
    })
    for (const readOnly of [true, false]) {
      const operations = members.filter(tool => tool.readOnly === readOnly)
      if (operations.length === 0) continue
      const inputs = hoistInputConstraints(operations.map(tool => tool.inputSchema))
      groups.push({
        name: `${readOnly ? 'read' : 'write'}_${domain.name}`,
        description: `${domain.description}${readOnly ? '' : ' Retry-stable command IDs; current revisions.'}`,
        readOnly,
        operations,
        inputSchema: compactSchema({
          type: 'object',
          properties: { operation: { type: 'string' }, input: inputs.common },
          required: ['operation', 'input'], additionalProperties: false,
          oneOf: operations.map((tool, index) => ({
            type: 'object', ...(browserSemantics[tool.name] ? { description: browserSemantics[tool.name] } : {}), properties: { operation: { const: tool.name }, input: inputs.branches[index] ?? tool.inputSchema },
          }))
        })
      })
    }
  }
  const unassigned = tools.filter(tool => !assigned.has(tool.name))
  if (unassigned.length > 0) throw new Error(`Shared tools lack an explicit browser domain: ${unassigned.map(tool => tool.name).join(', ')}`)
  return groups
}

export const browserToolGroups: readonly BrowserToolGroup[] = buildBrowserToolCatalog(manorTools)
const envelopeSchema = z.object({ operation: z.string(), input: z.record(z.string(), z.json()) }).strict()

/** Resolve only a group's declared discriminant, then validate the unchanged shared input. */
export function resolveBrowserOperation(group: BrowserToolGroup, input: JsonObject): { tool: ManorTool; fields: JsonObject } {
  const envelope = envelopeSchema.parse(input)
  const tool = group.operations.find(candidate => candidate.name === envelope.operation)
  if (!tool) throw new TypeError(`${group.name} does not support operation ${envelope.operation}`)
  const fields = z.record(z.string(), z.json()).parse(z.fromJSONSchema(tool.inputSchema).parse(envelope.input))
  return { tool, fields }
}

/** Reserve native origin/page-URL overhead within the verified host default budget. */
export function assertBrowserDescriptorBudget(descriptors: readonly { name: string; description: string; inputSchema: ToolSchema; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean } }[]): void {
  const bytes = new TextEncoder().encode(JSON.stringify(descriptors.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })))).byteLength
  const metadataReserve = descriptors.length * 200
  if (bytes + metadataReserve > 65_536) throw new RangeError(`Browser tools require ${bytes} descriptor bytes plus ${metadataReserve} reserved metadata bytes; the supported budget is 65536 bytes`)
}
