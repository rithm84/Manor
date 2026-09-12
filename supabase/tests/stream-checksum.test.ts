import { createHash } from 'node:crypto'
import { FileVerificationError, verifyFileRange } from '../functions/_shared/streamChecksum.ts'

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}

Deno.test('saved verification state survives independent range invocations with exact full-file SHA256', async () => {
  const bytes = new Uint8Array(32 * 1024 * 1024)
  const reference = createHash('sha256')
  let state: string | null = null
  for (let i = 0; i < 3; i++) {
    bytes.fill(i)
    reference.update(bytes)
    const result = await verifyFileRange(bytesStream(bytes), bytes.length, state, i === 2 ? reference.digest('hex') : null)
    state = result.state
    if (result.size !== bytes.length || (i === 2 && result.sha256 === null)) throw new Error('Range checkpoint failed')
  }
})

Deno.test('range verification rejects truncated, oversized, and corrupt bytes', async () => {
  for (const input of [{size:9,expected:10,sha:null},{size:11,expected:10,sha:null},{size:10,expected:10,sha:'0'.repeat(64)}]) {
    let rejected = false
    try { await verifyFileRange(bytesStream(new Uint8Array(input.size)), input.expected, null, input.sha) }
    catch (error) { if (!(error instanceof FileVerificationError)) throw error; rejected = true }
    if (!rejected) throw new Error('Invalid bytes accepted')
  }
})
