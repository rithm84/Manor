import { z } from 'zod'
import type { ResumesApi, ResumeVersion, ResumeUpload } from '../../shared/resumes'
import { parseResumeUpload } from '../../shared/resumes'
import type { ManorGateway } from '../ManorGateway'
import { FileService } from './FileService'

const resumeSchema = z.object({ id: z.uuid(), label: z.string(), file_name: z.string(), byte_size: z.number(), uploaded_at: z.iso.datetime({ offset: true }) })
export class ResumesService implements ResumesApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async list(): Promise<readonly ResumeVersion[]> {
    return (await this.gateway.rows('resumes')).map(row => {
      const item = resumeSchema.parse(row)
      return { id: item.id, label: item.label, fileName: item.file_name, byteSize: item.byte_size, uploadedAt: item.uploaded_at }
    })
  }
  async upload(input: ResumeUpload): Promise<ResumeVersion> {
    const upload = parseResumeUpload(input)
    const bytes = Uint8Array.from(atob(upload.base64), character => character.charCodeAt(0))
    const file = await new FileService(this.gateway).upload({ id: crypto.randomUUID(), purpose: 'resume', label: upload.label, parentId: null, name: upload.fileName, mimeType: 'application/pdf', bytes: new Blob([bytes], { type: 'application/pdf' }) })
    const resume = (await this.list()).find(item => item.id === file.id)
    if (!resume) throw new Error('The uploaded resume metadata was not returned')
    return resume
  }
  async remove(id: string): Promise<void> {
    await this.gateway.command('remove_resume', { id }, crypto.randomUUID())
  }
}
