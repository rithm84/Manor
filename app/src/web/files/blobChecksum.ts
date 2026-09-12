import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** Bounded slices avoid allocating a second copy of a large attachment. */
export async function blobChecksum(file: Blob): Promise<string> {
  const hash = sha256.create()
  try {
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      const bytes = await file.slice(offset, offset + 1024 * 1024).arrayBuffer()
      hash.update(new Uint8Array(bytes))
    }
    return bytesToHex(hash.digest())
  } finally {
    hash.destroy()
  }
}
