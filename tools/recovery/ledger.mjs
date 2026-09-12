import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { command, commandOptions, ledgerSchema } from './common.mjs'

/** Retain the latest complete content-free ledger independently of the restored daily snapshot. */
export async function checkpointLedger(client) {
  await client.query('select public.manor_prepare_purge()')
  const rows = (await client.query('select to_jsonb(t) as value from manor_private.purge_tombstones t order by user_id,object_type,object_id')).rows.map(row => row.value)
  const ledger = ledgerSchema.parse(rows)
  const directory = await mkdtemp(join(tmpdir(), 'manor-ledger-'))
  try {
    await writeFile(join(directory, 'tombstones.json'), JSON.stringify(ledger), { mode: 0o600 })
    const output = await command('restic', ['backup', '.', '--host', 'manor-recovery', '--tag', 'manor-ledger', '--json'], { cwd: directory, env: process.env })
    const summary = output.trim().split('\n').map(line => JSON.parse(line)).find(line => line.message_type === 'summary')
    const id = z.string().regex(/^[a-f0-9]{64}$/).parse(summary?.snapshot_id)
    await command('restic', ['check', '--read-data'], commandOptions())
    const committed = await client.query('select public.manor_acknowledge_recovery($1,$2::jsonb)', [id, JSON.stringify(ledger)])
    await command('restic', ['forget', '--host', 'manor-recovery', '--tag', 'manor-ledger', '--group-by', 'host,tags', '--keep-last', '1', '--prune'], commandOptions())
    console.log(JSON.stringify({ event: 'manor_deletion_ledger_verified', count: ledger.length }))
    return committed.rows.length
  } finally { await rm(directory, { recursive: true, force: false }) }
}
