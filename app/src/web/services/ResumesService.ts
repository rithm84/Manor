import { z } from 'zod'
import type { ResumesApi, ResumeVersion, ResumeUpload } from '../../shared/resumes'
import { parseResumeUpload } from '../../shared/resumes'
import type { ManorGateway } from '../ManorGateway'
import { FileService } from './FileService'

const resumeSchema = z.object({ id: z.uuid(), label: z.string(), file_name: z.string(), byte_size: z.number(), uploaded_at: z.iso.datetime({ offset: true }) })
function toVersion(row: unknown): ResumeVersion {
  const item = resumeSchema.parse(row)
  return { id: item.id, label: item.label, fileName: item.file_name, byteSize: item.byte_size, uploadedAt: item.uploaded_at }
}
export class ResumesService implements ResumesApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async list(): Promise<readonly ResumeVersion[]> {
    return (await this.gateway.rows('resumes')).map(toVersion)
  }
  async upload(input: ResumeUpload): Promise<ResumeVersion> {
    const upload = parseResumeUpload(input)
    const bytes = Uint8Array.from(atob(upload.base64), character => character.charCodeAt(0))
    const file = await new FileService(this.gateway).upload({ id: crypto.randomUUID(), purpose: 'resume', label: upload.label, parentId: null, name: upload.fileName, mimeType: 'application/pdf', bytes: new Blob([bytes], { type: 'application/pdf' }) })
    const cached = (await this.list()).find(item => item.id === file.id)
    if (cached !== undefined) return cached
    // The row is committed once finalization returns; a mirror that has not caught up yet is no reason to
    // report the upload as failed, so the answer comes from the server.
    const fresh = (await this.gateway.readRowsFromServer('resumes', [])).map(toVersion).find(item => item.id === file.id)
    if (fresh === undefined) throw new Error('The uploaded resume metadata was not returned')
    return fresh
  }
  async remove(id: string): Promise<void> {
    await this.gateway.command('remove_resume', { id }, crypto.randomUUID())
  }
}
