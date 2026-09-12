/** Restore files only to an explicitly isolated, already restored Supabase database. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command, commandOptions, database, loadJson, manifestSchema, ledgerSchema, required, verifyFiles } from './common.mjs'
const targetUrl = required('MANOR_RECOVERY_DATABASE_URL')
if (targetUrl === required('MANOR_DATABASE_URL') || required('MANOR_RECOVERY_ISOLATED') !== 'yes') throw new Error('Recovery must target a separate isolated database with all jobs and outbound integrations disabled')
const targetRemote = required('MANOR_RECOVERY_REMOTE')
if (targetRemote === required('MANOR_SOURCE_REMOTE') || !targetRemote.endsWith(':manor-files')) throw new Error('Recovery Storage must be a separate manor-files bucket')
const snapshot = required('MANOR_RECOVERY_SNAPSHOT')
if (!/^[a-f0-9]{64}$/.test(snapshot)) throw new Error('Choose an explicit full daily recovery snapshot ID')
const workspace = await mkdtemp(join(tmpdir(), 'manor-restore-'))
const client = await database('MANOR_RECOVERY_DATABASE_URL')
try {
  await command('restic', ['check', '--read-data'], commandOptions())
  await command('restic', ['restore', snapshot, '--target', join(workspace, 'daily')], commandOptions())
  await command('restic', ['restore', 'latest', '--tag', 'manor-ledger', '--host', 'manor-recovery', '--target', join(workspace, 'ledger')], commandOptions())
  const manifest = await loadJson(join(workspace, 'daily', 'manifest.json'), manifestSchema)
  const targetId = (await client.query('select system_identifier::text from pg_control_system()')).rows[0].system_identifier
  if (manifest.sourceClusterId === targetId) throw new Error('Recovery database is the production cluster; refusing any mutation')
  const ledger = await loadJson(join(workspace, 'ledger', 'tombstones.json'), ledgerSchema)
  await verifyFiles(join(workspace, 'daily', 'objects'), manifest.files)
  const existingTargetFiles = await command('rclone', ['lsf', targetRemote, '--files-only', '--recursive'], commandOptions())
  if (existingTargetFiles.trim() !== '') throw new Error('Recovery Storage is not empty; choose a fresh isolated bucket before restoring')
  // The target migration provides an allowlisted reconciliation operation; it cannot restore records.
  await client.query("select set_config('manor.recovery_isolated','yes',false)")
  await client.query('select public.manor_reconcile_recovery($1::jsonb)', [JSON.stringify(ledger)])
  const expected = (await client.query("select id,user_id,storage_path,sha256,size::text from public.file_objects where status='ready'")).rows
  const matching = expected.map(row => {
    const file = manifest.files.find(file => file.id === row.id && file.user_id === row.user_id && file.storage_path === row.storage_path && file.sha256 === row.sha256 && file.size === Number(row.size))
    if (!file) throw new Error(`Database references object ${row.id} missing from this recovery point. Choose a compatible file snapshot before enabling access.`)
    return file
  })
  await writeFile(join(workspace, 'restore.list'), matching.map(file => file.storage_path).join('\n'), { mode: 0o600 })
  await command('rclone', ['copy', join(workspace, 'daily', 'objects'), targetRemote, '--files-from-raw', join(workspace, 'restore.list'), '--immutable', '--retries', '3'], commandOptions())
  await command('rclone', ['check', join(workspace, 'daily', 'objects'), targetRemote, '--files-from-raw', join(workspace, 'restore.list'), '--download', '--one-way'], commandOptions())
  console.log(JSON.stringify({ event: 'manor_files_restored_verified', files: matching.length, databaseWatermark: manifest.databaseTime, accessEnabled: false }))
} finally { await client.end(); await rm(workspace, { recursive: true, force: false }) }
