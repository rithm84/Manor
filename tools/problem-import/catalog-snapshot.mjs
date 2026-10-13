/**
 * Publishes a compressed snapshot of the shared problem catalog that a new desktop copy loads before it walks the
 * catalog feed. It reads the catalog cursor before any row, so a change committed during the export lands after that
 * cursor and arrives through the feed. Rows are paged by key through the Management API in byte-bounded pages and
 * serialized by Postgres (`to_jsonb`), streamed to disk, and gzip-compressed with a header line:
 *   {"schema":1,"cursor":N,"problems":n,"contents":m}
 *   {"type":"problem","row":{...}}   one per `public.problem_catalog` row
 *   {"type":"content","row":{...}}   one per `public.problem_catalog_content` row
 * The snapshot is uploaded to `catalog/<cursor>.ndjson.gz` in the private `manor-catalog` bucket, and then
 * `catalog/manifest.json` is replaced with its cursor, path, byte length, SHA-256, and counts. The previous snapshot is
 * kept for clients still downloading it; older ones are deleted. Usage:
 *   node catalog-snapshot.mjs --project-ref <ref> [--dry-run]
 * --dry-run builds and measures the snapshot without uploading anything. The service key is read through the
 * logged-in Supabase CLI and never printed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { z } from 'zod'
import { runSqlTextWithRetries } from './sql.mjs'

const BUCKET = 'manor-catalog'
const SCHEMA = 1
const PAGE_BYTES = 2000000
const PAGE_ROWS = 2000
const SOURCES = [
  { type: 'problem', view: 'public.problem_catalog', key: 'id' },
  { type: 'content', view: 'public.problem_catalog_content', key: 'problem_id' }
]
const manifestSchema = z.object({
  schema: z.literal(SCHEMA), cursor: z.number().int().nonnegative(), path: z.string().regex(/^catalog\/\d+\.ndjson\.gz$/),
  bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/), problems: z.number().int().nonnegative(),
  contents: z.number().int().nonnegative(), createdAt: z.iso.datetime()
})

function options(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--dry-run') { flags.set(key, 'true'); continue }
    if (key !== '--project-ref' || flags.has(key) || argv[index + 1] === undefined) throw new TypeError(`Invalid or repeated snapshot argument: ${key}. Usage: node catalog-snapshot.mjs --project-ref <ref> [--dry-run]`)
    flags.set(key, argv[++index])
  }
  return { projectRef: z.string().regex(/^[a-z]{20}$/).parse(flags.get('--project-ref')), dryRun: flags.has('--dry-run') }
}

const query = (projectRef, sql, event) => runSqlTextWithRetries(projectRef, sql, { attempts: 5, permanent: /status 400|does not exist|permission denied/, event, timeout: 180000, maxBuffer: 64000000 })
const literal = value => `convert_from(decode('${Buffer.from(value).toString('base64')}','base64'),'UTF8')`

async function catalogCursor(projectRef) {
  const rows = await query(projectRef, 'select public.manor_catalog_cursor()::text as cursor;', 'catalog_snapshot_retry')
  return z.array(z.object({ cursor: z.coerce.number().int().nonnegative() })).length(1).parse(rows)[0].cursor
}
async function serverCounts(projectRef) {
  const rows = await query(projectRef, 'select (select count(*) from public.problem_catalog)::int as problems, (select count(*) from public.problem_catalog_content)::int as contents;', 'catalog_snapshot_retry')
  return z.array(z.object({ problems: z.number().int(), contents: z.number().int() })).length(1).parse(rows)[0]
}

/** Yields one view's rows as Postgres JSON text, in key order, a page of at most PAGE_BYTES (or one row) at a time. */
async function* viewRows(projectRef, { view, key }) {
  let after = null
  for (;;) {
    const sql = `with page as (select r.${key} as k, to_jsonb(r)::text as line from ${view} r${after === null ? '' : ` where r.${key} > ${literal(after)}`} order by r.${key} limit ${PAGE_ROWS}),
sized as (select k, line, sum(octet_length(line)) over (order by k) as running, min(k) over () as first from page)
select k, line from sized where running <= ${PAGE_BYTES} or k = first order by k;`
    const rows = z.array(z.object({ k: z.string(), line: z.string() })).parse(await query(projectRef, sql, 'catalog_snapshot_retry'))
    if (rows.length === 0) return
    for (const row of rows) yield row.line
    after = rows.at(-1).k
  }
}

/** Writes every row line to `path` and returns the line count per type. */
async function exportRows(projectRef, path) {
  const out = createWriteStream(path, { mode: 0o600 })
  const counts = { problem: 0, content: 0 }
  for (const source of SOURCES) {
    for await (const line of viewRows(projectRef, source)) {
      if (!out.write(`{"type":"${source.type}","row":${line}}\n`)) await once(out, 'drain')
      counts[source.type] += 1
    }
  }
  out.end()
  await once(out, 'finish')
  return counts
}

async function digest(path) {
  const sha = createHash('sha256')
  for await (const chunk of createReadStream(path)) sha.update(chunk)
  return sha.digest('hex')
}

/** Storage REST client authenticated with the project's service key, retrying throttling, server errors, and network failures. */
class CatalogStorage {
  constructor(projectRef) {
    const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/node_modules/.bin/supabase')
    const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'inherit'] }).toString())
    const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
    if (!serviceKey) throw new Error(`The Supabase CLI returned no service key for ${projectRef}; run supabase login first`)
    this.base = `https://${projectRef}.supabase.co/storage/v1`
    this.headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  }
  /** `init` is a function so a retried upload gets a fresh body stream. */
  async request(path, init, operation) {
    for (let attempt = 1; ; attempt += 1) {
      const { headers, ...rest } = init()
      let response
      try { response = await fetch(`${this.base}${path}`, { ...rest, headers: { ...this.headers, ...headers } }) }
      catch (error) {
        if (attempt === 6) throw new Error(`Storage ${operation} failed after ${attempt} attempts: ${error.message}`, { cause: error })
        console.warn(JSON.stringify({ event: 'catalog_snapshot_storage_retry', operation, attempt, reason: error.message })); await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue
      }
      if (response.ok) return response
      const body = (await response.text()).slice(0, 1000)
      if (attempt === 6 || (response.status < 500 && response.status !== 429)) throw new Error(`Storage ${operation} returned HTTP ${response.status}: ${body}`)
      console.warn(JSON.stringify({ event: 'catalog_snapshot_storage_retry', operation, attempt, status: response.status })); await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  async manifest() {
    const response = await fetch(`${this.base}/object/${BUCKET}/catalog/manifest.json`, { headers: { ...this.headers, 'cache-control': 'no-cache' } })
    if (response.status === 400 || response.status === 404) {
      const body = await response.text()
      if (/bucket not found/i.test(body)) throw new Error(`Storage bucket ${BUCKET} does not exist; apply the shared catalog migration first`)
      return null
    }
    if (!response.ok) throw new Error(`Reading catalog/manifest.json returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
    return manifestSchema.parse(await response.json())
  }
  upload(name, body, type, cacheControl) {
    return this.request(`/object/${BUCKET}/${name}`, () => ({ method: 'POST', headers: { 'Content-Type': type, 'cache-control': cacheControl, 'x-upsert': 'true' }, body: body(), duplex: 'half' }), `upload ${name}`)
  }
  async snapshots() {
    const response = await this.request(`/object/list/${BUCKET}`, () => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: 'catalog', limit: 1000, offset: 0 }) }), 'list snapshots')
    return z.array(z.object({ name: z.string() })).parse(await response.json()).map(item => `catalog/${item.name}`).filter(name => /^catalog\/\d+\.ndjson\.gz$/.test(name))
  }
  remove(names) {
    return this.request(`/object/${BUCKET}`, () => ({ method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }) }), 'delete old snapshots')
  }
}

const configuration = options(process.argv.slice(2))
const started = performance.now()
const storage = configuration.dryRun ? null : new CatalogStorage(configuration.projectRef)
const previous = storage === null ? null : await storage.manifest()
const cursor = await catalogCursor(configuration.projectRef)
const directory = await mkdtemp(join(tmpdir(), 'manor-catalog-snapshot-'))
try {
  const rowsPath = join(directory, 'rows.ndjson'), snapshotPath = join(directory, 'snapshot.ndjson.gz')
  const counts = await exportRows(configuration.projectRef, rowsPath)
  const exported = performance.now()
  const header = JSON.stringify({ schema: SCHEMA, cursor, problems: counts.problem, contents: counts.content })
  async function* lines() { yield `${header}\n`; yield* createReadStream(rowsPath) }
  await pipeline(Readable.from(lines()), createGzip({ level: 9 }), createWriteStream(snapshotPath, { mode: 0o600 }))
  const bytes = (await stat(snapshotPath)).size, sha256 = await digest(snapshotPath)
  const after = await catalogCursor(configuration.projectRef)
  const server = await serverCounts(configuration.projectRef)
  const matches = server.problems === counts.problem && server.contents === counts.content
  if (!matches && after === cursor) throw new Error(`Snapshot counts differ from the server while the catalog cursor stayed at ${cursor}: ${counts.problem} problems and ${counts.content} contents exported, ${server.problems} and ${server.contents} on the server`)
  if (!matches) console.warn(JSON.stringify({ event: 'catalog_snapshot_moved', cursor, after, exported: counts, server }))
  const path = `catalog/${cursor}.ndjson.gz`
  const manifest = manifestSchema.parse({ schema: SCHEMA, cursor, path, bytes, sha256, problems: counts.problem, contents: counts.content, createdAt: new Date().toISOString() })
  if (storage !== null) {
    if (previous !== null && previous.cursor > cursor) throw new Error(`The published manifest is at cursor ${previous.cursor}, ahead of this export at ${cursor}; keep the newer snapshot`)
    await storage.upload(path, () => Readable.toWeb(createReadStream(snapshotPath)), 'application/gzip', 'max-age=3600')
    await storage.upload('catalog/manifest.json', () => JSON.stringify(manifest), 'application/json', 'no-cache')
    const keep = new Set([path, previous?.path])
    const stale = (await storage.snapshots()).filter(name => !keep.has(name))
    if (stale.length > 0) await storage.remove(stale)
  }
  console.log(JSON.stringify({ event: configuration.dryRun ? 'catalog_snapshot_built' : 'catalog_snapshot_published', ...manifest, server, cursorAfter: after, exportMs: Math.round(exported - started), totalMs: Math.round(performance.now() - started) }))
} finally { await rm(directory, { recursive: true, force: false }) }
