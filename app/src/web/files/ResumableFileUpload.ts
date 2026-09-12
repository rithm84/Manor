import type { SupabaseClient } from '@supabase/supabase-js'
import { Upload } from 'tus-js-client'

export function resumableStorageEndpoint(supabaseUrl: string): string {
  const endpoint = new URL('/storage/v1/upload/resumable', supabaseUrl)
  if (endpoint.hostname.endsWith('.supabase.co') && !endpoint.hostname.endsWith('.storage.supabase.co')) {
    endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co')
  }
  return endpoint.toString()
}

/** Persist the transfer offset separately from the protected attachment bytes. */
export class ResumableFileUpload {
  constructor(private readonly client: SupabaseClient, private readonly endpoint: string) {}

  upload(file: Blob, path: string, mimeType: string, checksum: string): Promise<void> {
    const endpoint = new URL(this.endpoint)
    return new Promise((resolve, reject) => {
      const transfer = new Upload(file, {
        endpoint: this.endpoint,
        fingerprint: async () => `manor-file:${endpoint.origin}:${path}:${checksum}`,
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        retryDelays: [0, 1000, 3000, 5000],
        metadata: { bucketName: 'manor-files', objectName: path, contentType: mimeType, cacheControl: '3600' },
        onBeforeRequest: async (request) => {
          const target = new URL(request.getURL())
          if (target.origin !== endpoint.origin || !target.pathname.startsWith(endpoint.pathname)) {
            throw new Error('The saved upload destination does not belong to Manor Storage. Reopen this attachment.')
          }
          const { data, error } = await this.client.auth.getSession()
          if (error) throw error
          if (data.session === null) throw new Error('Sign in again to resume the upload. Your attachment is saved on this device.')
          request.setHeader('Authorization', `Bearer ${data.session.access_token}`)
        },
        onShouldRetry: (error, attempt) => {
          const status = error.originalResponse?.getStatus() ?? 0
          const retry = navigator.onLine && (status === 0 || status === 423 || status === 429 || status >= 500)
          if (retry) console.warn('Retrying file transfer', { path, attempt: attempt + 1, status })
          return retry
        },
        onError: (error) => reject(error),
        onSuccess: () => resolve()
      })
      void transfer.findPreviousUploads().then((previous) => {
        if (previous.length > 0) transfer.resumeFromPreviousUpload(previous[0])
        transfer.start()
      }).catch(reject)
    })
  }
}
