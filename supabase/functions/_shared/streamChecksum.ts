import { createSHA256 } from 'npm:hash-wasm@4.12.0'
import { Buffer } from 'node:buffer'

export class FileVerificationError extends Error {
  constructor(readonly code: 'size_mismatch' | 'checksum_mismatch', message: string) {
    super(message)
    this.name = 'FileVerificationError'
  }
}

/** Saved state includes partial content and must remain in the private verifier table. */
export async function verifyFileRange(stream: ReadableStream<Uint8Array>, expectedSize: number, priorState: string | null, finalSha256: string | null): Promise<{ size: number; state: string; sha256: string | null }> {
  const hash = await createSHA256()
  if (priorState !== null) hash.load(Buffer.from(priorState, 'base64'))
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > expectedSize) throw new FileVerificationError('size_mismatch', 'Uploaded file size differs from the upload intent')
    hash.update(chunk)
  }
  if (size !== expectedSize) throw new FileVerificationError('size_mismatch', 'Uploaded file size differs from the upload intent')
  const state = Buffer.from(hash.save()).toString('base64')
  const sha256 = finalSha256 === null ? null : hash.digest('hex')
  if (finalSha256 !== null && sha256 !== finalSha256) throw new FileVerificationError('checksum_mismatch', 'Uploaded file checksum differs from the upload intent')
  return { size, state, sha256 }
}
