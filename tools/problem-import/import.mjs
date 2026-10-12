/**
 * Imports a version-1 JSON problem bundle through Manor's ordinary revision-checked commands.
 * Required flags: --file, --project-ref, --account-id, --checkpoint, --batch-size (1 to 100).
 * --dry-run validates and sizes batches without opening a database connection.
 * Source labels, URLs, and content belong in the input file, never in this importer.
 */
import { z } from 'zod'
import { bundleSchema, hash, stableUuid } from './bundle.mjs'
import { runSql, SqlError } from './sql.mjs'
const identifier = z.string().min(1).max(200)
import { readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const outcomeSchema = z.object({ id: identifier, revision: z.number().int().positive(), content_version: z.number().int().nonnegative(), outcome: z.enum(['created', 'updated', 'unchanged']) })
const receiptSchema = z.object({ command_id: z.uuid(), operation: z.literal('import_problems'), replayed: z.boolean(), record: z.object({ count: z.number().int().positive(), items: z.array(outcomeSchema) }) })
const checkpointSchema = z.object({
  version: z.literal(1), projectRef: z.string(), accountId: z.uuid(), payloadHash: z.string(),
  batchSize: z.number().int().min(1).max(100), batchPlanHash: z.string().optional(), completed: z.array(z.number().int().nonnegative()),
  outcomes: z.array(outcomeSchema), updatedAt: z.iso.datetime()
})

function options(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--dry-run') { flags.set(key, 'true'); continue }
    if (!['--file', '--project-ref', '--account-id', '--checkpoint', '--batch-size'].includes(key) || flags.has(key) || argv[index + 1] === undefined) throw new TypeError(`Invalid or repeated importer argument: ${key}`)
    flags.set(key, argv[++index])
  }
  return {
    file: resolve(z.string().min(1).parse(flags.get('--file'))), checkpoint: resolve(z.string().min(1).parse(flags.get('--checkpoint'))),
    projectRef: z.string().regex(/^[a-z]{20}$/).parse(flags.get('--project-ref')), accountId: z.uuid().parse(flags.get('--account-id')),
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
    return { version: 1, ...identity, completed: [], outcomes: [], updatedAt: new Date().toISOString() }
  }
  const checkpoint = checkpointSchema.parse(JSON.parse(bytes))
  for (const [key, value] of Object.entries(identity)) if (checkpoint[key] !== value) throw new Error(`Checkpoint ${key} differs from this import. Use the original bundle and arguments or a new checkpoint path.`)
  return checkpoint
}
async function saveCheckpoint(path, checkpoint) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 })
  await rename(temporary, path)
}
async function query(projectRef, path) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let rows
    try { rows = await runSql(projectRef, path) }
    catch (error) {
      if (!(error instanceof SqlError)) throw error
      if (attempt === 3 || /PT409|Record changed|different input|not owned|not authorized|status 413/.test(error.reason)) throw new Error(`Supabase problem import failed in project ${projectRef} after attempt ${attempt} (${error.message}): ${error.reason}`)
      console.warn(JSON.stringify({ event: 'problem_import_retry', attempt, reason: error.reason }))
      await new Promise(resolveWait => setTimeout(resolveWait, attempt * 1000))
      continue
    }
    return z.object({ rows: z.array(z.object({ receipt: receiptSchema })) }).parse({ rows }).rows
  }
  throw new Error('Problem import exhausted retries')
}

const configuration = options(process.argv.slice(2))
const bundle = bundleSchema.parse(JSON.parse(await readFile(configuration.file, 'utf8')))
const keys = new Set()
const problems = bundle.problems.map(problem => {
  const key = `${problem.source_type}:${problem.external_key}`
  if (keys.has(key)) throw new Error(`Repeated external key in import bundle: ${problem.external_key}`)
  keys.add(key)
  return { ...problem, id: problem.id ?? stableUuid(`problem:${key}`), expected_revision: problem.expected_revision ?? 0 }
})
const payloadHash = hash(JSON.stringify(problems))
const groups = batches(problems, configuration.batchSize)
const batchPlanHash = hash(JSON.stringify(groups.map(group => hash(JSON.stringify(group)))))
if (configuration.dryRun) {
  console.log(JSON.stringify({ event: 'problem_import_validated', problems: problems.length, batches: groups.length, payloadHash }))
} else {
  let checkpoint = await loadCheckpoint(configuration.checkpoint, { projectRef: configuration.projectRef, accountId: configuration.accountId, payloadHash, batchSize: configuration.batchSize, batchPlanHash })
  const temporary = await mkdtemp(join(tmpdir(), 'manor-problem-import-'))
  try {
    for (let index = 0; index < groups.length; index += 1) {
      if (checkpoint.completed.includes(index)) continue
      const input = JSON.stringify({ items: groups[index] })
      const commandId = stableUuid(`${configuration.projectRef}:${configuration.accountId}:${payloadHash}:${index}:${input}`)
      const claims = Buffer.from(JSON.stringify({ sub: configuration.accountId, role: 'authenticated' })).toString('base64')
      const encoded = Buffer.from(input).toString('base64')
      const sql = `with identity as materialized (select set_config('request.jwt.claims',convert_from(decode('${claims}','base64'),'UTF8'),true)) select public.manor_command('${commandId}'::uuid,'import_problems',convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) as receipt from identity join public.profiles p on p.user_id='${configuration.accountId}'::uuid;`
      const sqlPath = join(temporary, 'batch.sql')
      await writeFile(sqlPath, sql, { mode: 0o600 })
      const rows = await query(configuration.projectRef, sqlPath)
      if (rows.length !== 1) throw new Error('The selected account has no Manor profile. Check --account-id in the selected project.')
      const receipt = rows[0].receipt
      if (receipt.command_id !== commandId || receipt.record.count !== groups[index].length || receipt.record.items.length !== groups[index].length) throw new Error('Import receipt does not match the submitted batch')
      checkpoint = { ...checkpoint, completed: [...checkpoint.completed, index], outcomes: [...checkpoint.outcomes, ...receipt.record.items], updatedAt: new Date().toISOString() }
      await saveCheckpoint(configuration.checkpoint, checkpoint)
      console.log(JSON.stringify({ event: 'problem_import_batch_committed', batch: index + 1, batches: groups.length, count: receipt.record.count, replayed: receipt.replayed }))
    }
    console.log(JSON.stringify({ event: 'problem_import_completed', problems: checkpoint.outcomes.length, created: checkpoint.outcomes.filter(item => item.outcome === 'created').length, updated: checkpoint.outcomes.filter(item => item.outcome === 'updated').length, unchanged: checkpoint.outcomes.filter(item => item.outcome === 'unchanged').length }))
  } finally { await rm(temporary, { recursive: true, force: false }) }
}
