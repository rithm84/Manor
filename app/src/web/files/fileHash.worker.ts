import { blobChecksum } from './blobChecksum'

self.onmessage = async (event: MessageEvent<Blob>): Promise<void> => {
  try {
    if (!(event.data instanceof Blob)) throw new TypeError('File hashing requires a Blob')
    self.postMessage({ sha256: await blobChecksum(event.data) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
