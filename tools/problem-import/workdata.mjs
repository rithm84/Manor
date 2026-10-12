/**
 * Syncs the private problem data root with a private Supabase Storage bucket, so any machine or cloud
 * session can continue the content pipeline without that data entering the repository.
 * A push uploads one compressed snapshot of the whole data root in 5 MB parts and then points
 * `latest.json` at it; a pull downloads the latest snapshot, verifies its SHA-256, and extracts it.
 * Few large objects keep Storage within its request limits. Usage:
 *   node workdata.mjs push <data-dir> --project-ref <ref>
 *   node workdata.mjs pull <data-dir> --project-ref <ref>
 * The project's service key is read through the logged-in Supabase CLI and never printed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'manor-problem-work'
const PART = 5 * 1024 * 1024
const KEEP = 3
const EXCLUDES = ['work/bundles', '*.log', '.DS_Store', '__pycache__', 'work/.repo']
const [command, rawDirectory, flag, projectRef] = process.argv.slice(2)
if (!['push', 'pull'].includes(command) || !rawDirectory || flag !== '--project-ref' || !/^[a-z]{20}$/.test(projectRef ?? '')) throw new TypeError('Usage: node workdata.mjs push|pull <data-dir> --project-ref <ref>')
const root = resolve(rawDirectory)
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/node_modules/.bin/supabase')
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'inherit'] }).toString())
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
if (!serviceKey) throw new Error(`The Supabase CLI returned no service key for ${projectRef}; run supabase login first`)
const storage = `https://${projectRef}.supabase.co/storage/v1`
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

async function request(path, init, operation) {
  for (let attempt = 1; ; attempt++) {
    let response
    try { response = await fetch(`${storage}${path}`, { ...init, headers: { ...headers, ...init.headers } }) }
    catch (error) {
      if (attempt === 7) throw new Error(`${operation} failed after ${attempt} attempts: ${error.message}`)
      console.warn(JSON.stringify({ event: 'workdata_retry', operation, attempt, reason: error.message })); await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue
    }
    if (response.ok) return response
    const body = (await response.text()).slice(0, 1000)
    if (attempt === 7 || (response.status < 500 && response.status !== 429)) throw new Error(`${operation} returned HTTP ${response.status}: ${body}`)
    console.warn(JSON.stringify({ event: 'workdata_retry', operation, attempt, status: response.status })); await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
  }
}
const upload = (name, body, type) => request(`/object/${BUCKET}/${name}`, { method: 'POST', headers: { 'Content-Type': type, 'x-upsert': 'true' }, body }, `upload ${name}`)
async function download(name) { return Buffer.from(await (await request(`/object/${BUCKET}/${name}`, { method: 'GET' }, `download ${name}`)).arrayBuffer()) }
async function latest() {
  const response = await fetch(`${storage}/object/${BUCKET}/latest.json`, { headers })
  if (response.status === 400 || response.status === 404) return null
  if (!response.ok) throw new Error(`Reading latest.json returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response.json()
}

if (command === 'push') {
  const existing = await fetch(`${storage}/bucket/${BUCKET}`, { headers })
  const missing = existing.status === 404 || (existing.status === 400 && /not found/i.test(await existing.text()))
  if (!existing.ok && !missing) throw new Error(`Checking the work bucket returned HTTP ${existing.status}; retry the push`)
  if (missing) await request('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) }, 'create bucket')
  const temporary = mkdtempSync(join(tmpdir(), 'manor-workdata-'))
  try {
    const archive = join(temporary, 'snapshot.tar.gz')
    // Authoring keeps writing while a push runs. GNU tar then exits 1 ("file changed as we read it") after
    // writing a complete archive; the next push captures the newer files.
    const gnu = /GNU tar/.test(execFileSync('tar', ['--version']).toString())
    try { execFileSync('tar', ['-czf', archive, ...(gnu ? ['--warning=no-file-changed'] : []), ...EXCLUDES.flatMap(pattern => ['--exclude', pattern]), '-C', root, ...readdirSync(root).filter(name => !EXCLUDES.includes(name)).sort()], { env: { ...process.env, COPYFILE_DISABLE: '1' }, maxBuffer: 64 * 1024 * 1024 }) }
    catch (error) { if (!(gnu && error.status === 1)) throw error }
    const bytes = readFileSync(archive)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const parts = Math.ceil(bytes.length / PART)
    for (let part = 0; part < parts; part++) await upload(`snapshots/${sha256}/part-${part}`, bytes.subarray(part * PART, (part + 1) * PART), 'application/octet-stream')
    const previous = await latest()
    const history = [{ sha256, parts, bytes: bytes.length, createdAt: new Date().toISOString() }, ...(previous?.history ?? [])]
    await upload('latest.json', JSON.stringify({ ...history[0], history: history.slice(0, KEEP) }), 'application/json')
    const expired = history.slice(KEEP).flatMap(old => Array.from({ length: old.parts }, (_, part) => `snapshots/${old.sha256}/part-${part}`))
    if (expired.length > 0) await request(`/object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: expired }) }, 'delete expired snapshots')
    console.log(JSON.stringify({ event: 'workdata_pushed', sha256, parts, bytes: bytes.length }))
  } finally { rmSync(temporary, { recursive: true, force: true }) }
} else {
  const snapshot = await latest()
  if (snapshot === null) throw new Error(`No snapshot exists in bucket ${BUCKET}; push one first`)
  const chunks = []
  for (let part = 0; part < snapshot.parts; part++) chunks.push(await download(`snapshots/${snapshot.sha256}/part-${part}`))
  const bytes = Buffer.concat(chunks)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== snapshot.sha256) throw new Error(`Snapshot ${snapshot.sha256} downloaded with hash ${sha256}; retry the pull`)
  mkdirSync(root, { recursive: true })
  const temporary = mkdtempSync(join(tmpdir(), 'manor-workdata-'))
  try {
    writeFileSync(join(temporary, 'snapshot.tar.gz'), bytes)
    // Snapshots pushed from macOS can carry Apple extended-attribute headers that GNU tar reports once per file.
    const gnu = /GNU tar/.test(execFileSync('tar', ['--version']).toString())
    execFileSync('tar', ['-xzf', join(temporary, 'snapshot.tar.gz'), ...(gnu ? ['--warning=no-unknown-keyword'] : []), '-C', root], { maxBuffer: 64 * 1024 * 1024 })
  } finally { rmSync(temporary, { recursive: true, force: true }) }
  console.log(JSON.stringify({ event: 'workdata_pulled', sha256, parts: snapshot.parts, bytes: bytes.length, createdAt: snapshot.createdAt }))
}
