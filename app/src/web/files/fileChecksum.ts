import { z } from 'zod'

const resultSchema = z.union([
  z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ error: z.string() })
])

/** Keep large-file hashing off the editor's main thread. */
export function fileChecksum(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fileHash.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent): void => {
      worker.terminate()
      const result = resultSchema.safeParse(event.data)
      if (!result.success) { reject(new Error('File checksum worker returned an invalid result')); return }
      if ('error' in result.data) { reject(new Error(`File checksum failed: ${result.data.error}`)); return }
      resolve(result.data.sha256)
    }
    worker.onerror = (event: ErrorEvent): void => {
      worker.terminate()
      reject(new Error(`File checksum failed: ${event.message}`))
    }
    worker.postMessage(file)
  })
}
