/** Durable append-only classification receipts, compacted after a completed batch. */
import { existsSync } from 'node:fs'
import { appendFile, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { checkpointEntrySchema, checkpointSchema, type CheckpointEntry } from './classification.ts'

export async function loadCheckpoint(path: string): Promise<CheckpointEntry[]> {
  const entries = existsSync(path) ? checkpointSchema.parse(JSON.parse(await readFile(path, 'utf8'))).records : []
  const byId = new Map(entries.map(entry => [entry.sourceId, entry]))
  if (byId.size !== entries.length) throw new Error(`Classification checkpoint repeats source IDs: ${path}`)
  const journal = `${path}.journal`
  if (!existsSync(journal)) return entries
  const source = await readFile(journal, 'utf8')
  if (source.length > 0 && !source.endsWith('\n')) throw new Error(`Classification journal has an incomplete final receipt: ${journal}; inspect and repair the final line before resuming`)
  for (const [index, line] of source.split('\n').filter(Boolean).entries()) {
    const entry = checkpointEntrySchema.parse(JSON.parse(line))
    const previous = byId.get(entry.sourceId)
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`Classification journal conflicts with a prior receipt: ${journal}:${index + 1}, sourceId=${entry.sourceId}`)
    byId.set(entry.sourceId, entry)
  }
  return [...byId.values()]
}

/** Serialize fsynced receipts; retries never overwrite a different result for the same source. */
export class ClassificationCheckpoint {
  readonly path: string
  readonly entries: Map<string, CheckpointEntry>
  private writes: Promise<void>
  constructor(path: string, entries: CheckpointEntry[]) { this.path = path; this.entries = new Map(entries.map(entry => [entry.sourceId, entry])); this.writes = Promise.resolve() }
  async save(entry: CheckpointEntry): Promise<void> {
    const previous = this.entries.get(entry.sourceId)
    if (previous !== undefined) throw new Error(`Classification receipt already exists: ${entry.sourceId}`)
    this.entries.set(entry.sourceId, entry)
    this.writes = this.writes.then(() => appendFile(`${this.path}.journal`, `${JSON.stringify(entry)}\n`, { mode: 0o600, flush: true }))
    await this.writes
  }
  async compact(): Promise<void> {
    await this.writes
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, records: [...this.entries.values()] }, null, 2), { mode: 0o600, flush: true })
    await rename(temporary, this.path)
    const journal = `${this.path}.journal`
    if (existsSync(journal)) await unlink(journal)
  }
}
