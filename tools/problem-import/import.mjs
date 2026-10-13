/**
 * Imports a version-1 JSON problem bundle into the shared Manor catalog through `manor_private.catalog_command`.
 * Required flags: --file, --project-ref, --target catalog, --checkpoint, --batch-size (1 to 100).
 * Each batch runs as `postgres` through the Supabase CLI or the Management API (see sql.mjs); custom problems are
 * written by their owner through MCP, never by this importer.
 * --dry-run validates and sizes batches without opening a database connection.
 * Source labels, URLs, and content belong in the input file, never in this importer.
 */
import { z } from 'zod'
import { bundleSchema, hash, stableUuid } from './bundle.mjs'
import { runSqlTextWithRetries } from './sql.mjs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'

const identifier = z.string().min(1).max(200)
const outcomeSchema = z.object({ id: identifier, revision: z.number().int().positive(), content_version: z.number().int().nonnegative(), outcome: z.enum(['created', 'updated', 'unchanged']) })
const receiptSchema = z.object({ command_id: z.uuid(), operation: z.literal('import_problems'), replayed: z.boolean(), record: z.object({ count: z.number().int().positive(), items: z.array(outcomeSchema) }) })
const checkpointSchema = z.object({
  version: z.literal(2), projectRef: z.string(), target: z.literal('catalog'), payloadHash: z.string(),
  batchSize: z.number().int().min(1).max(100), batchPlanHash: z.string(), completed: z.array(z.number().int().nonnegative()),
  outcomes: z.array(outcomeSchema), updatedAt: z.iso.datetime()
})
const PERMANENT = /PT409|Record changed|different input|read-only|not owned|not authorized|status 400|status 413/

function options(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--dry-run') { flags.set(key, 'true'); continue }
    if (!['--file', '--project-ref', '--target', '--checkpoint', '--batch-size'].includes(key) || flags.has(key) || argv[index + 1] === undefined) throw new TypeError(`Invalid or repeated importer argument: ${key}`)
    flags.set(key, argv[++index])
  }
  return {
    file: resolve(z.string().min(1).parse(flags.get('--file'))), checkpoint: resolve(z.string().min(1).parse(flags.get('--checkpoint'))),
    projectRef: z.string().regex(/^[a-z]{20}$/).parse(flags.get('--project-ref')), target: z.literal('catalog').parse(flags.get('--target')),
    batchSize: z.coerce.number().int().min(1).max(100).parse(flags.get('--batch-size')), dryRun: flags.has('--dry-run')
  }
}
function batches(problems, count) {
  const groups = []; let pending = []
  for (const problem of problems) {
    if (Buffer.byteLength(JSON.stringify({ items: [problem] })) > 1000000) throw new RangeError(`Problem ${problem.id} exceeds the CLI transport limit of 1,000,000 JSON bytes; reduce its saved testset size`)
    const combined = [...pending, problem]
    if (pending.length > 0 && (combined.length > count || Buffer.byteLength(JSON.stringify({ items: combined })) > 1000000)) { groups.push(pending); pending = [problem] }
    else pending = combined
  }
  if (pending.length > 0) groups.push(pending)
  return groups
}
async function loadCheckpoint(path, identity) {
  let bytes
  try { bytes = await readFile(path, 'utf8') }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { version: 2, ...identity, completed: [], outcomes: [], updatedAt: new Date().toISOString() }
  }
  const stored = JSON.parse(bytes)
  if (stored.version === 1) throw new Error(`Checkpoint ${path} is version 1, written by the account-scoped importer. Catalog imports use checkpoint version 2 with --target catalog and different command IDs; pass a new checkpoint path. Problems already imported are reported unchanged.`)
  const checkpoint = checkpointSchema.parse(stored)
  for (const [key, value] of Object.entries(identity)) if (checkpoint[key] !== value) throw new Error(`Checkpoint ${key} differs from this import. Use the original bundle and arguments or a new checkpoint path.`)
  return checkpoint
}
async function saveCheckpoint(path, checkpoint) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 })
  await rename(temporary, path)
}

const configuration = options(process.argv.slice(2))
const bundle = bundleSchema.parse(JSON.parse(await readFile(configuration.file, 'utf8')))
const keys = new Set()
const problems = bundle.problems.map(problem => {
  if (problem.source_type === 'custom') throw new Error(`Problem ${problem.external_key} is custom; the catalog holds only stock and imported problems, and custom problems are created through MCP`)
  const key = `${problem.source_type}:${problem.external_key}`
  if (keys.has(key)) throw new Error(`Repeated external key in import bundle: ${problem.external_key}`)
  keys.add(key)
  return { ...problem, id: problem.id ?? stableUuid(`problem:${key}`), expected_revision: problem.expected_revision ?? 0 }
})
const payloadHash = hash(JSON.stringify(problems))
const groups = batches(problems, configuration.batchSize)
const batchPlanHash = hash(JSON.stringify(groups.map(group => hash(JSON.stringify(group)))))
if (configuration.dryRun) {
  console.log(JSON.stringify({ event: 'problem_import_validated', target: configuration.target, problems: problems.length, batches: groups.length, payloadHash }))
} else {
  let checkpoint = await loadCheckpoint(configuration.checkpoint, { projectRef: configuration.projectRef, target: configuration.target, payloadHash, batchSize: configuration.batchSize, batchPlanHash })
  for (let index = 0; index < groups.length; index += 1) {
    if (checkpoint.completed.includes(index)) continue
    const input = JSON.stringify({ items: groups[index] })
    const commandId = stableUuid(`${configuration.projectRef}:${configuration.target}:${payloadHash}:${index}:${input}`)
    const encoded = Buffer.from(input).toString('base64')
    const sql = `select manor_private.catalog_command('${commandId}'::uuid,'import_problems',convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) as receipt;`
    const rows = z.array(z.object({ receipt: receiptSchema })).length(1).parse(await runSqlTextWithRetries(configuration.projectRef, sql, { attempts: 5, permanent: PERMANENT, event: 'problem_import_retry', timeout: 180000, maxBuffer: 4000000 }))
    const receipt = rows[0].receipt
    if (receipt.command_id !== commandId || receipt.record.count !== groups[index].length || receipt.record.items.length !== groups[index].length) throw new Error(`Import receipt for batch ${index + 1} does not match the submitted batch: command ${receipt.command_id}, count ${receipt.record.count}, expected command ${commandId} and count ${groups[index].length}`)
    checkpoint = { ...checkpoint, completed: [...checkpoint.completed, index], outcomes: [...checkpoint.outcomes, ...receipt.record.items], updatedAt: new Date().toISOString() }
    await saveCheckpoint(configuration.checkpoint, checkpoint)
    console.log(JSON.stringify({ event: 'problem_import_batch_committed', batch: index + 1, batches: groups.length, count: receipt.record.count, replayed: receipt.replayed }))
  }
  console.log(JSON.stringify({ event: 'problem_import_completed', problems: checkpoint.outcomes.length, created: checkpoint.outcomes.filter(item => item.outcome === 'created').length, updated: checkpoint.outcomes.filter(item => item.outcome === 'updated').length, unchanged: checkpoint.outcomes.filter(item => item.outcome === 'unchanged').length }))
}
