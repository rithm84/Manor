import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { blobChecksum } from './blobChecksum'

describe('incremental attachment checksum', () => {
  it('matches a native digest across several slices and a partial final slice', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 17)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    expect(await blobChecksum(new Blob([bytes]))).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})
