import { z } from 'zod'
import { parseTask, parseContextDefinition, parseSavedTaskView, parseScratchBlock } from '../../shared/home'
import type { HomeApi, HomeState, Task, ContextDefinition, ContextDraft, SavedTaskView, ScratchBlock } from '../../shared/home'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { camelRow, commandRecord, rowRevision } from './rows'

function taskFromRow(row: JsonObject): Task { return { ...parseTask(camelRow(row)), revision: rowRevision(row), seriesId: z.string().nullable().parse(row.series_id) } }
function scratchFromRow(row: JsonObject): ScratchBlock { return { ...parseScratchBlock({ ...camelRow(row), start: row.start_time, end: row.end_time }), revision: rowRevision(row) } }

export class HomeService implements HomeApi {
  private readonly gateway: ManorGateway
  private contextRows: readonly JsonObject[] | null = null
  private taskRows: readonly JsonObject[] | null = null
  private scratchRows: readonly JsonObject[] | null = null
  private viewRows: readonly JsonObject[] | null = null
  constructor(gateway: ManorGateway) { this.gateway = gateway }

  async load(): Promise<HomeState> {
    const [tasks, contexts, blocks, views] = await Promise.all([
      this.gateway.rows('tasks'), this.gateway.rows('contexts'), this.gateway.rows('scratch_blocks'), this.gateway.rows('saved_task_views')
    ])
    const result: HomeState = {
      tasks: tasks.filter((row) => row.deleted_at === null && row.skipped_at === null && row.superseded_at === null).map(taskFromRow),
      contexts: contexts.map((row) => parseContextDefinition(camelRow(row))),
      scratchBlocks: blocks.filter((row) => z.iso.datetime({ offset: true }).parse(row.expires_at) > new Date().toISOString()).map(scratchFromRow),
      savedTaskViews: views.map((row) => ({ ...parseSavedTaskView(camelRow(row)), revision: rowRevision(row) }))
    }
    this.taskRows = tasks; this.contextRows = contexts; this.scratchRows = blocks; this.viewRows = views
    return result
  }

  private cachedRevision(rows: readonly JsonObject[] | null, id: string, label: string): number {
    if (rows === null) throw new Error(`Load ${label} records before editing`)
    const row = rows.find((candidate) => candidate.id === id)
    if (row === undefined) throw new Error(`The ${label} is no longer available`)
    return rowRevision(row)
  }

  private context(name: string): JsonObject {
    if (this.contextRows === null) throw new Error('Load task contexts before making changes')
    const row = this.contextRows.find((candidate) => candidate.name === name)
    if (row === undefined) throw new Error(`Task context ${name} is no longer available`)
    return row
  }

  async upsertTask(input: Task): Promise<Task> {
    const task = parseTask(input)
    if (this.taskRows === null) throw new Error('Load tasks before making changes')
    const existing = this.taskRows.find((row) => row.id === task.id)
    if (existing !== undefined && input.revision === undefined) throw new Error('Task revision is missing. Reload the task before saving.')
    const fields: JsonObject = { id: task.id, title: task.title, context_id: this.context(task.context).id,
      estimate_minutes: task.estimateMinutes, priority: task.priority, status: task.status, due: task.due,
      tags: [...task.tags], expected_revision: existing === undefined ? 0 : z.number().int().positive().parse(input.revision) }
    let operation = existing === undefined ? 'create_task' : 'update_task'
    if (existing === undefined && task.recurrence !== null) {
      operation = 'create_recurring_task'
      fields.recurrence = task.recurrence
    } else if (existing !== undefined && existing.series_id === null && task.recurrence !== null) {
      operation = 'convert_task_to_series'
      fields.recurrence = task.recurrence
      fields.new_series_id = crypto.randomUUID()
    } else if (existing !== undefined && input.recurrenceScope === 'future') {
      operation = 'update_future_task_occurrences'
      fields.recurrence = task.recurrence
      fields.new_series_id = crypto.randomUUID()
    } else if (existing !== undefined && task.recurrence !== existing.recurrence) {
      throw new Error('Choose This and future occurrences to change the repeat pattern. Your draft is preserved.')
    }
    const result = await this.gateway.command(operation, fields, crypto.randomUUID())
    const row = commandRecord(result)
    this.taskRows = [...this.taskRows.filter((candidate) => candidate.id !== task.id), row]
    return taskFromRow(row)
  }

  async deleteTask(taskId: string): Promise<void> {
    const row = commandRecord(await this.gateway.command('trash_task', { id: taskId, expected_revision: this.cachedRevision(this.taskRows, taskId, 'task') }, crypto.randomUUID()))
    this.taskRows = [...this.taskRows!.filter((candidate) => candidate.id !== taskId), row]
  }
  async restoreTask(taskId: string): Promise<Task> {
    const row = commandRecord(await this.gateway.command('restore_task', { id: taskId, expected_revision: this.cachedRevision(this.taskRows, taskId, 'task') }, crypto.randomUUID()))
    this.taskRows = [...this.taskRows!.filter((candidate) => candidate.id !== taskId), row]
    return taskFromRow(row)
  }
  async skipOccurrence(task: Task): Promise<void> {
    await this.gateway.command('skip_task_occurrence', { id: task.id, expected_revision: z.number().int().positive().parse(task.revision) }, crypto.randomUUID())
  }
  async addContext(draft: ContextDraft): Promise<ContextDefinition> {
    const context = parseContextDefinition(draft)
    const row = commandRecord(await this.gateway.command('create_context', { id: crypto.randomUUID(), ...context, expected_revision: 0 }, crypto.randomUUID()))
    this.contextRows = [...(this.contextRows ?? []), row]
    return parseContextDefinition(camelRow(row))
  }
  async updateContext(originalName: string, draft: ContextDraft): Promise<ContextDefinition> {
    const previous = this.context(originalName)
    const context = parseContextDefinition(draft)
    const row = commandRecord(await this.gateway.command('update_context', { id: previous.id, ...context, expected_revision: rowRevision(previous) }, crypto.randomUUID()))
    this.contextRows = this.contextRows!.map((candidate) => candidate.id === row.id ? row : candidate)
    return parseContextDefinition(camelRow(row))
  }
  async deleteContext(name: string): Promise<void> {
    const row = this.context(name)
    await this.gateway.command('remove_context', { id: row.id, expected_revision: rowRevision(row) }, crypto.randomUUID())
    this.contextRows = this.contextRows!.filter((candidate) => candidate.id !== row.id)
  }
  async upsertScratchBlock(input: ScratchBlock): Promise<ScratchBlock> {
    const block = parseScratchBlock(input)
    if (this.scratchRows === null) throw new Error('Load time blocks before saving')
    const exists = this.scratchRows.some((row) => row.id === block.id)
    const row = commandRecord(await this.gateway.command('save_scratch_block', { id: block.id, task_id: block.taskId, date: block.date, start_time: block.start, end_time: block.end, portion: block.portion, expected_revision: exists ? z.number().int().positive().parse(input.revision) : 0 }, crypto.randomUUID()))
    this.scratchRows = [...this.scratchRows.filter((candidate) => candidate.id !== row.id), row]
    return scratchFromRow(row)
  }
  async deleteScratchBlock(blockId: string): Promise<void> {
    await this.gateway.command('delete_scratch_block', { id: blockId, expected_revision: this.cachedRevision(this.scratchRows, blockId, 'time block') }, crypto.randomUUID())
  }
  async upsertSavedTaskView(input: SavedTaskView): Promise<SavedTaskView> {
    const view = parseSavedTaskView(input)
    if (this.viewRows === null) throw new Error('Load saved views before saving')
    const exists = this.viewRows.some((row) => row.id === view.id)
    const row = commandRecord(await this.gateway.command('save_task_view', { id: view.id, name: view.name, rules: view.rules.map((rule) => ({ ...rule })), expected_revision: exists ? z.number().int().positive().parse(input.revision) : 0 }, crypto.randomUUID()))
    this.viewRows = [...this.viewRows.filter((candidate) => candidate.id !== row.id), row]
    return { ...parseSavedTaskView(camelRow(row)), revision: rowRevision(row) }
  }
  async deleteSavedTaskView(viewId: string): Promise<void> {
    await this.gateway.command('delete_task_view', { id: viewId, expected_revision: this.cachedRevision(this.viewRows, viewId, 'saved view') }, crypto.randomUUID())
  }
}
