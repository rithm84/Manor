import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { command, objectPath, verifyFiles } from './common.mjs'
const restic = resolve('.bin/restic')
const rclone = resolve('.bin/rclone')

test('real encrypted snapshot restores synthetic bytes and pruning removes expired recovery points', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manor-recovery-test-'))
  const repository = join(directory, 'repository'); const source = join(directory, 'source'); const staged = join(directory, 'stage')
  const env = { ...process.env, RESTIC_REPOSITORY: repository, RESTIC_PASSWORD: 'synthetic-test-only-not-a-production-key', RESTIC_CACHE_DIR: join(directory, 'cache') }
  const options = { cwd: directory, env }
  try {
    await mkdir(source); await mkdir(staged)
    await writeFile(join(source, 'sample'), 'synthetic recovery payload')
    await command(rclone, ['copy', source, staged, '--immutable'], options)
    await command(restic, ['init'], options)
    await command(restic, ['backup', '.', '--host', 'manor-recovery', '--tag', 'manor-daily', '--time', '2020-01-01 00:00:00'], { cwd: staged, env })
    await writeFile(join(staged, 'sample'), 'synthetic current payload')
    await command(restic, ['backup', '.', '--host', 'manor-recovery', '--tag', 'manor-pending'], { cwd: staged, env })
    const pending = JSON.parse(await command(restic, ['snapshots', '--tag', 'manor-pending', '--json'], options))
    assert.equal(pending.length, 1)
    await command(restic, ['check', '--read-data'], options)
    await command(restic, ['tag', '--add', 'manor-daily', '--remove', 'manor-pending', pending[0].id], options)
    await command(restic, ['forget', '--host', 'manor-recovery', '--tag', 'manor-daily', '--group-by', 'host,tags', '--keep-within', '7d', '--prune'], options)
    const snapshots = JSON.parse(await command(restic, ['snapshots', '--json'], options))
    assert.equal(snapshots.length, 1)
    await command(restic, ['restore', snapshots[0].id, '--target', join(directory, 'restore')], options)
    assert.equal(await readFile(join(directory, 'restore', 'sample'), 'utf8'), 'synthetic current payload')
    await command(restic, ['check', '--read-data'], options)
    const files = [{ id: 'synthetic', storage_path: 'sample', size: Buffer.byteLength('synthetic current payload'), sha256: createHash('sha256').update('synthetic current payload').digest('hex') }]
    await verifyFiles(join(directory, 'restore'), files)
    await writeFile(join(directory, 'restore', 'sample'), 'tampered')
    await assert.rejects(verifyFiles(join(directory, 'restore'), files), /checksum or length/)
    await assert.rejects(command(restic, ['snapshots'], { cwd: directory, env: { ...env, RESTIC_PASSWORD: 'wrong-key' } }), /failed/)
  } finally { await rm(directory, { recursive: true, force: false }) }
})

test('manifest paths cannot escape the isolated restore directory', () => {
  for (const path of ['../secret', '/absolute', 'a/../../secret', 'a\nother']) assert.throws(() => objectPath('/tmp/recovery', path), /Unsafe|escaped/)
})
