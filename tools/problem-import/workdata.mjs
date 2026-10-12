/**
 * Syncs the private problem working directory with a private Supabase Storage bucket, so any machine or
 * cloud session can continue the content pipeline without that data entering the repository.
 * Each spec directory is one gzip tarball and every other file is gzipped; objects above 5 MB are split
 * into parts. A manifest of content hashes and part counts makes push and pull incremental. Usage:
 *   node workdata.mjs push <data-dir> --project-ref <ref>
 *   node workdata.mjs pull <data-dir> --project-ref <ref>
 * The staging service key is read through the logged-in Supabase CLI and never printed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'manor-problem-work'
const PART = 5 * 1024 * 1024
const objectPath = (key, part) => [...key.split('/'), `part-${part}`].map(encodeURIComponent).join('/')
const EXCLUDED = [/^work\/bundles\//, /^work\/\.repo$/, /\.log$/, /(^|\/)\.DS_Store$/, /(^|\/)__pycache__\//]
const [command, rawDirectory, flag, projectRef] = process.argv.slice(2)
if (!['push', 'pull'].includes(command) || !rawDirectory || flag !== '--project-ref' || !/^[a-z]{20}$/.test(projectRef ?? '')) throw new TypeError('Usage: node workdata.mjs push|pull <data-dir> --project-ref <ref>')
const root = resolve(rawDirectory)
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/node_modules/.bin/supabase')
const environment = { ...process.env }
if (environment.SUPABASE_ACCESS_TOKEN === '') delete environment.SUPABASE_ACCESS_TOKEN
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], { cwd: '/tmp', env: environment, stdio: ['ignore', 'pipe', 'inherit'] }).toString())
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

/** Units: one per spec directory (tarred) and one per other file. */
function units() {
  const out = new Map()
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const rel = relative(root, path)
      if (EXCLUDED.some(pattern => pattern.test(rel + (statSync(path).isDirectory() ? '/' : '')))) continue
      if (statSync(path).isDirectory()) {
        // An interrupted author can leave an empty spec directory; there is nothing to sync until it holds files.
        if (/^work\/specs\/[^/]+$/.test(rel)) { if (specFiles(rel).length > 0) out.set(rel + '.tar.gz', { kind: 'spec', path: rel }) }
        else walk(path)
      } else out.set(rel, { kind: 'file', path: rel })
    }
  }
  walk(root)
  return out
}
function specFiles(rel) { return readdirSync(join(root, rel)).filter(name => !name.startsWith('.') && name !== '__pycache__').sort() }
function specBytes(rel) {
  const directory = join(root, rel)
  const files = specFiles(rel)
  return execFileSync('tar', ['-czf', '-', '-C', directory, ...files], { maxBuffer: 1 << 30, env: { ...process.env, GZIP: '-n' } })
}
function specDigest(rel) {
  const hash = createHash('sha256')
  const directory = join(root, rel)
  for (const name of readdirSync(directory).filter(name => !name.startsWith('.') && name !== '__pycache__').sort()) hash.update(name).update('\0').update(readFileSync(join(directory, name))).update('\0')
  return hash.digest('hex')
}
const digest = (unit) => unit.kind === 'spec' ? specDigest(unit.path) : createHash('sha256').update(readFileSync(join(root, unit.path))).digest('hex')

async function remoteManifest() {
  const response = await fetch(`${storage}/object/${BUCKET}/manifest.json`, { headers })
  if (response.status === 400 || response.status === 404) return {}
  if (!response.ok) throw new Error(`Reading the work manifest returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response.json()
}
/** The manifest is saved during long pushes so an interrupted push resumes where it stopped. */
async function saveManifest(manifest) {
  await request(`/object/${BUCKET}/manifest.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(manifest) }, 'upload manifest')
}
async function pool(items, size, task) {
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await task(items[next++]) }))
}

if (command === 'push') {
  const existing = await fetch(`${storage}/bucket/${BUCKET}`, { headers })
  const missing = existing.status === 404 || (existing.status === 400 && /not found/i.test(await existing.text()))
  if (!existing.ok && !missing) throw new Error(`Checking the work bucket returned HTTP ${existing.status}; retry the push`)
  if (missing) await request('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 104857600 }) }, 'create bucket')
  const manifest = await remoteManifest()
  const local = units()
  const changed = []
  for (const [key, unit] of local) { const hash = digest(unit); if (manifest[key]?.hash !== hash) changed.push({ key, unit, hash }) }
  let done = 0
  await pool(changed, 4, async ({ key, unit, hash }) => {
    const body = unit.kind === 'spec' ? specBytes(unit.path) : gzipSync(readFileSync(join(root, unit.path)))
    const parts = Math.max(1, Math.ceil(body.length / PART))
    for (let part = 0; part < parts; part++) await request(`/object/${BUCKET}/${objectPath(key, part)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: body.subarray(part * PART, (part + 1) * PART) }, `upload ${key} part ${part + 1}/${parts}`)
    manifest[key] = { hash, parts }
    if (++done % 200 === 0) { await saveManifest(manifest); console.log(JSON.stringify({ event: 'workdata_progress', uploaded: done, of: changed.length })) }
  })
  await saveManifest(manifest)
  console.log(JSON.stringify({ event: 'workdata_pushed', units: local.size, uploaded: changed.length }))
} else {
  const manifest = await remoteManifest()
  const wanted = Object.entries(manifest).filter(([key, { hash }]) => {
    const spec = key.endsWith('.tar.gz') && key.startsWith('work/specs/')
    const path = join(root, spec ? key.slice(0, -7) : key)
    if (!existsSync(path)) return true
    return digest(spec ? { kind: 'spec', path: key.slice(0, -7) } : { kind: 'file', path: key }) !== hash
  })
  let done = 0
  await pool(wanted, 4, async ([key, { parts }]) => {
    const chunks = []
    for (let part = 0; part < parts; part++) chunks.push(Buffer.from(await (await request(`/object/${BUCKET}/${objectPath(key, part)}`, { method: 'GET' }, `download ${key} part ${part + 1}/${parts}`)).arrayBuffer()))
    const bytes = Buffer.concat(chunks)
    if (key.endsWith('.tar.gz') && key.startsWith('work/specs/')) {
      const directory = join(root, key.slice(0, -7)); mkdirSync(directory, { recursive: true })
      execFileSync('tar', ['-xzf', '-', '-C', directory], { input: bytes })
    } else { mkdirSync(dirname(join(root, key)), { recursive: true }); writeFileSync(join(root, key), gunzipSync(bytes)) }
    if (++done % 500 === 0) console.log(JSON.stringify({ event: 'workdata_progress', downloaded: done, of: wanted.length }))
  })
  console.log(JSON.stringify({ event: 'workdata_pulled', units: Object.keys(manifest).length, downloaded: wanted.length }))
}
