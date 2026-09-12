/** rclone handles transfer/retries; restic owns encrypted immutable snapshots and pruning. */
import { z } from 'zod'
import { checkpointLedger } from './ledger.mjs'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command, commandOptions, database, environment, fileSchema, verifyFiles, ledgerSchema, objectPath } from './common.mjs'

const { source } = environment()
const workspace = await mkdtemp(join(tmpdir(), 'manor-recovery-'))
const client = await database('MANOR_DATABASE_URL')
try {
  await checkpointLedger(client)
  await client.query("select pg_advisory_lock_shared(hashtextextended('manor-file-recovery',0))")
  await client.query('begin isolation level repeatable read read only')
  const watermark = (await client.query("select clock_timestamp()::text as time, pg_export_snapshot() as snapshot, pg_current_wal_lsn()::text as lsn, (select system_identifier::text from pg_control_system()) as cluster")).rows[0]
  const files = (await client.query("select f.id,f.user_id,f.storage_path,f.sha256,f.size,f.purpose,f.parent_id,o.id as storage_object_id,o.version as storage_version from public.file_objects f left join storage.objects o on o.bucket_id='manor-files' and o.name=f.storage_path where f.status='ready' order by f.id")).rows.map(file => fileSchema.parse(file))
  const ledger = ledgerSchema.parse((await client.query('select to_jsonb(t) as value from manor_private.purge_tombstones t order by user_id,object_type,object_id')).rows.map(row => row.value))
  await writeFile(join(workspace, 'manifest.json'), JSON.stringify({ version: 1, databaseTime: new Date(watermark.time).toISOString(), databaseSnapshot: watermark.snapshot, sourceClusterId: watermark.cluster, walLsn: watermark.lsn, files }), { mode: 0o600 })
  await writeFile(join(workspace, 'tombstones.json'), JSON.stringify(ledger), { mode: 0o600 })
  await mkdir(join(workspace, 'objects'), { mode: 0o700 })
  for (const file of files) objectPath(join(workspace, 'objects'), file.storage_path)
  const fileList = join(workspace, 'files.list')
  await writeFile(fileList, files.map(file => file.storage_path).join('\n'), { mode: 0o600 })
  await command('rclone', ['copy', source, join(workspace, 'objects'), '--files-from-raw', fileList, '--immutable', '--retries', '3', '--low-level-retries', '10'], commandOptions())
  await verifyFiles(join(workspace, 'objects'), files)
  await client.query('commit')
  const snapshotOutput = await command('restic', ['backup', '.', '--host', 'manor-recovery', '--tag', 'manor-pending', '--json'], { cwd: workspace, env: process.env })
  const summary = snapshotOutput.trim().split('\n').map(line => JSON.parse(line)).find(line => line.message_type === 'summary')
  const snapshotId = z.string().regex(/^[a-f0-9]{64}$/).parse(summary?.snapshot_id)
  await command('restic', ['check', '--read-data'], commandOptions())
  await command('restic', ['tag', '--add', 'manor-daily', '--remove', 'manor-pending', snapshotId], commandOptions())
  await command('restic', ['forget', '--host', 'manor-recovery', '--tag', 'manor-daily', '--group-by', 'host,tags', '--keep-within', '7d', '--prune'], commandOptions())
  await command('restic', ['check'], commandOptions())
  console.log(JSON.stringify({ event: 'manor_backup_verified', databaseTime: new Date(watermark.time).toISOString(), files: files.length }))
} finally {
  await client.end()
  await rm(workspace, { recursive: true, force: false })
}
