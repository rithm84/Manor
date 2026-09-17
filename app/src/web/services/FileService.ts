import { z } from 'zod'
import { FILE_VERIFICATION_CHUNK_BYTES, validateFileUploadSize } from '../../shared/fileUploadPolicy'
import type { ManorGateway } from '../ManorGateway'
import { readConfiguration } from '../config'
import { fileChecksum } from '../files/fileChecksum'
import { ResumableFileUpload, resumableStorageEndpoint } from '../files/ResumableFileUpload'

const fileSchema = z.object({ id: z.uuid(), storage_path: z.string(), size: z.number(), mime_type: z.string(), status: z.enum(['allocated', 'ready', 'purging']) })
const verificationSchema = z.object({ id: z.uuid(), status: z.literal('verifying'), verified_bytes: z.number().int().nonnegative(), total_bytes: z.number().int().positive() })

export interface FileUpload {
  id: string
  purpose: 'note' | 'resume' | 'avatar' | 'capture'
  parentId: string | null
  name: string
  label: string | null
  mimeType: string
  bytes: Blob
}

export interface UploadedFile { id: string; path: string; size: number; mimeType: string }

export class FileService {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }

  async upload(upload: FileUpload): Promise<UploadedFile> {
    validateFileUploadSize(upload.bytes.size)
    const sha256 = await fileChecksum(upload.bytes)
    const receipt = await this.gateway.command('allocate_file', {
      id: upload.id, purpose: upload.purpose, parent_id: upload.parentId, name: upload.name, label: upload.label,
      mime_type: upload.mimeType, size: upload.bytes.size, sha256
    }, upload.id)
    const allocated = fileSchema.parse(receipt.record)
    // A replayed allocation receipt describes the original state, not whether finalization has since committed.
    const current = await this.gateway.client.from('file_objects').select('status').eq('user_id', this.gateway.accountId).eq('id', upload.id).single()
    if (current.error) throw current.error
    const { status } = z.object({ status: z.enum(['allocated', 'ready', 'purging']) }).parse(current.data)
    if (status === 'purging') throw new Error('This file is being removed and cannot be uploaded again')
    if (status === 'allocated') {
      const existing = await this.gateway.client.storage.from('manor-files').info(allocated.storage_path)
      if (existing.error !== null) {
        if (!('code' in existing.error) || existing.error.code !== 'NoSuchKey') throw existing.error
        const endpoint = resumableStorageEndpoint(readConfiguration().supabaseUrl)
        await new ResumableFileUpload(this.gateway.client, endpoint).upload(upload.bytes, allocated.storage_path, upload.mimeType, sha256)
      }
      // Completed but unacknowledged uploads are verified without sending their bytes again.
      await this.finalize(upload.id, upload.bytes.size)
    }
    // Finalization wrote the file's metadata row (a resume, an attachment) through the verifier, not a
    // command, so the mirror has not pulled it yet.
    await this.gateway.afterServerWrite()
    return { id: allocated.id, path: allocated.storage_path, size: allocated.size, mimeType: allocated.mime_type }
  }

  private async finalize(id: string, size: number): Promise<void> {
    let verifiedBytes = 0
    const maximumSteps = Math.ceil(size / FILE_VERIFICATION_CHUNK_BYTES) + 1
    for (let step = 0; step < maximumSteps; step += 1) {
      const result = await this.verifyNextPart(id)
      if (result.status === 'ready') {
        if (result.id !== id || result.size !== size) throw new Error('The verified file does not match this upload')
        return
      }
      if (result.status !== 'verifying') throw new Error('The uploaded file has not been finalized')
      if (result.id !== id || result.total_bytes !== size || result.verified_bytes <= verifiedBytes || result.verified_bytes >= size) {
        throw new Error('File verification returned inconsistent progress. Retry the upload to continue verification.')
      }
      verifiedBytes = result.verified_bytes
    }
    throw new Error('File verification did not finish. Retry the upload to continue verification.')
  }

  private async verifyNextPart(id: string): Promise<z.infer<typeof fileSchema> | z.infer<typeof verificationSchema>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await this.gateway.client.functions.invoke('file-finalize', { body: { id } })
      if (error === null) {
        return z.union([fileSchema, verificationSchema]).parse(data)
      }
      const response = 'context' in error && error.context instanceof Response ? error.context : null
      const status = response?.status ?? 0
      const detail = response === null ? error.message : await response.text()
      const failure = new Error(`The file could not be verified (HTTP ${status}): ${detail}`)
      if (attempt === 2 || (status !== 0 && status !== 429 && status < 500)) throw failure
      console.warn('Retrying file verification', { id, status, attempt: attempt + 1 })
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
    throw new Error('File verification attempts were exhausted')
  }

  async signedUrl(id: string): Promise<string> {
    const { data, error } = await this.gateway.client.from('file_objects').select('storage_path,status').eq('user_id', this.gateway.accountId).eq('id', id).single()
    if (error) throw error
    const file = z.object({ storage_path: z.string(), status: z.literal('ready') }).parse(data)
    const result = await this.gateway.client.storage.from('manor-files').createSignedUrl(file.storage_path, 900)
    if (result.error) throw result.error
    return result.data.signedUrl
  }
}
