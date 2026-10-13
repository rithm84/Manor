import { describe, expect, it } from 'vitest'

import {
  CATALOG_SNAPSHOT_GAP, SNAPSHOT_START, catalogSyncPlan, finishSnapshot, needsManifest, parseCatalogManifest, readSnapshotChunk,
  type CatalogManifest, type CatalogSnapshotEntry
} from './catalogSnapshot'

const manifest: CatalogManifest = parseCatalogManifest({
  schema: 1, cursor: 4812, path: 'catalog/4812.ndjson.gz', bytes: 1_204_331,
  sha256: 'a'.repeat(64), problems: 2, contents: 1, createdAt: '2026-10-13T17:02:11.000Z'
})

const lines = [
  JSON.stringify({ schema: 1, cursor: 4812, problems: 2, contents: 1 }),
  JSON.stringify({ type: 'problem', row: { id: 'neetcode-two-sum', name: 'Two Sum', revision: 3 } }),
  JSON.stringify({ type: 'content', row: { problem_id: 'neetcode-two-sum', version: 1, statement_markdown: 'Given an array…\nReturn indices.' } }),
  JSON.stringify({ type: 'problem', row: { id: 'b1f0c2de-0000-5000-8000-000000000001', name: 'Meta: Two Sum', revision: 1 } })
]

/** Reads text in the given chunk sizes, the way a decompression stream hands it over. */
function readAll(text: string, chunkSize: number): { entries: CatalogSnapshotEntry[]; cursor: number } {
  let progress = SNAPSHOT_START
  const entries: CatalogSnapshotEntry[] = []
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const read = readSnapshotChunk(progress, text.slice(offset, offset + chunkSize), manifest)
    progress = read.progress
    entries.push(...read.entries)
  }
  const last = finishSnapshot(progress, manifest)
  return { entries: [...entries, ...last.entries], cursor: last.header.cursor }
}

describe('the catalog snapshot parser', () => {
  it('reads the same rows whatever the chunk boundaries, with or without a final newline', () => {
    const whole = readAll(lines.join('\n') + '\n', 1_000_000)
    expect(whole.cursor).toBe(4812)
    expect(whole.entries.map((entry) => `${entry.type}:${String(entry.row.id ?? entry.row.problem_id)}`)).toEqual([
      'problem:neetcode-two-sum', 'content:neetcode-two-sum', 'problem:b1f0c2de-0000-5000-8000-000000000001'
    ])
    // Seven-character chunks split lines, keys, and the escaped newline inside a statement.
    expect(readAll(lines.join('\n'), 7)).toEqual(whole)
  })

  it('reads a real gzip stream the way the app decompresses it', async () => {
    const compressed = new Blob([lines.join('\n')]).stream().pipeThrough(new CompressionStream('gzip'))
    const reader = compressed.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader()
    let progress = SNAPSHOT_START
    let count = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const read = readSnapshotChunk(progress, value, manifest)
      progress = read.progress
      count += read.entries.length
    }
    count += finishSnapshot(progress, manifest).entries.length
    expect(count).toBe(3)
  })

  it('refuses a snapshot that is short, padded, or not the one its manifest names', () => {
    expect(() => readAll(lines.slice(0, 3).join('\n'), 64)).toThrow(/holds 1 problems and 1 statements but its header promises 2 and 1/)
    expect(() => readAll([...lines, lines[1]].join('\n'), 64)).toThrow(/holds 3 problems/)
    const otherCursor = [JSON.stringify({ schema: 1, cursor: 4811, problems: 2, contents: 1 }), ...lines.slice(1)]
    expect(() => readAll(otherCursor.join('\n'), 64)).toThrow(/does not match its manifest/)
    expect(() => readAll('', 64)).toThrow(/no header line/)
  })

  it('names the line that is not a row', () => {
    expect(() => readAll([lines[0], '{"type":"problem","row":[1]}'].join('\n'), 64)).toThrow(/line 2 is not a problem or statement row/)
    expect(() => readAll([lines[0], '{"type":"problem",'].join('\n'), 64)).toThrow(/line 2 is not JSON/)
    expect(() => readAll([lines[0], JSON.stringify({ type: 'testset', row: {} })].join('\n'), 64)).toThrow(/line 2/)
  })

  it('refuses a manifest that does not name a snapshot it can check', () => {
    expect(() => parseCatalogManifest({ ...manifest, sha256: 'not-a-digest' })).toThrow(/manifest is not in the expected form/)
    expect(() => parseCatalogManifest({ ...manifest, path: '../4812.ndjson.gz' })).toThrow(/manifest/)
  })
})

describe('catalogSyncPlan', () => {
  it('walks the feed while a complete copy is close to the head', () => {
    const copy = { ready: true, cursor: 900 }
    expect(needsManifest(copy, 900 + CATALOG_SNAPSHOT_GAP)).toBe(false)
    expect(catalogSyncPlan(copy, 900 + CATALOG_SNAPSHOT_GAP, null)).toBe('feed')
  })

  it('loads a newer snapshot when the copy is far behind, and walks the feed when no newer one exists', () => {
    const copy = { ready: true, cursor: 900 }
    const head = 900 + CATALOG_SNAPSHOT_GAP + 1
    expect(needsManifest(copy, head)).toBe(true)
    expect(catalogSyncPlan(copy, head, head - 10)).toBe('snapshot')
    expect(catalogSyncPlan(copy, head, 900)).toBe('feed')
    expect(catalogSyncPlan(copy, head, null)).toBe('feed')
  })

  it('fills an empty copy from the snapshot, or from the tables when none is published', () => {
    const empty = { ready: false, cursor: 0 }
    expect(needsManifest(empty, 0)).toBe(true)
    expect(catalogSyncPlan(empty, 12_000, 11_800)).toBe('snapshot')
    expect(catalogSyncPlan(empty, 12_000, null)).toBe('tables')
  })

  it('rebuilds a copy whose cursor belongs to a history the server no longer has', () => {
    const copy = { ready: true, cursor: 20_000 }
    expect(needsManifest(copy, 12_000)).toBe(true)
    expect(catalogSyncPlan(copy, 12_000, 11_800)).toBe('snapshot')
    expect(catalogSyncPlan(copy, 12_000, null)).toBe('tables')
  })
})
