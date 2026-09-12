import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import pg from 'pg'

export const fileSchema = z.object({ id: z.uuid(), user_id: z.uuid(), storage_path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.coerce.number().int().nonnegative(), purpose: z.string(), parent_id: z.string().nullable(), storage_object_id: z.uuid(), storage_version: z.string().nullable() })
export const manifestSchema = z.object({ version: z.literal(1), databaseTime: z.iso.datetime({ offset: true }), databaseSnapshot: z.string(), sourceClusterId: z.string().regex(/^[0-9]+$/), walLsn: z.string(), files: z.array(fileSchema) })
export const ledgerSchema = z.array(z.object({ user_id: z.uuid(), object_type: z.string(), object_id: z.string(), purged_at: z.iso.datetime({ offset: true }), series_id: z.string().nullable().optional(), occurrence_date: z.iso.date().nullable().optional(), parent_folder_id: z.string().nullable().optional() }))
export function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} in the recovery runner's secret environment`)
  return value
}
export function environment() {
  required('RESTIC_REPOSITORY'); required('RESTIC_PASSWORD_FILE')
  const source = required('MANOR_SOURCE_REMOTE')
  if (!source.endsWith(':manor-files')) throw new Error('MANOR_SOURCE_REMOTE must name an rclone remote with the manor-files bucket')
  const repository = required('RESTIC_REPOSITORY')
  if (!repository.startsWith('s3:https://') && !repository.startsWith('b2:')) throw new Error('Production recovery requires an independent managed S3 HTTPS or B2 repository')
  if (repository.includes('.supabase.co')) throw new Error('Backup storage must be independent of the source Supabase infrastructure')
  return { source, repository }
}
/** No shell interpretation; never log credentials, file paths, or database records. */
export async function command(program, args, options) {
  const result = await new Promise((done, reject) => {
    const child = spawn(program, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const output = []; const errors = []
    child.stdout.on('data', data => output.push(data)); child.stderr.on('data', data => errors.push(data))
    child.on('error', reject)
    child.on('close', code => done({ code, output: Buffer.concat(output).toString(), errors: Buffer.concat(errors).toString() }))
  })
  if (result.code !== 0) throw new Error(`${program} failed with exit ${result.code}. Inspect the restricted runner logs; no backup was declared successful. ${result.errors.slice(-800).replaceAll(requiredSafeDatabaseUrl(), '[database]')}`)
  return result.output
}
function requiredSafeDatabaseUrl() { return process.env.MANOR_DATABASE_URL ?? 'DATABASE_URL_NOT_SET' }
export const commandOptions = () => ({ cwd: process.cwd(), env: process.env })
export function objectPath(root, name) {
  if (name.includes('\n') || name.includes('\r') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '')) throw new Error('Unsafe storage object path in recovery manifest')
  const path = resolve(root, name)
  if (!path.startsWith(resolve(root) + sep)) throw new Error('Storage object escaped recovery directory')
  return path
}
export async function verifyFiles(root, files) {
  for (const file of files) {
    const hash = createHash('sha256'); let size = 0
    for await (const chunk of createReadStream(objectPath(root, file.storage_path))) { hash.update(chunk); size += chunk.length }
    if (hash.digest('hex') !== file.sha256 || size !== file.size) throw new Error(`Recovery file checksum or length mismatch for object ${file.id}`)
  }
}
export async function database(name) {
  const client = new pg.Client({ connectionString: required(name), ssl: { rejectUnauthorized: true } })
  await client.connect(); return client
}
export async function privateDirectory(path) { await mkdir(path, { recursive: false, mode: 0o700 }); return path }
export async function loadJson(path, schema) { return schema.parse(JSON.parse(await readFile(path, 'utf8'))) }
