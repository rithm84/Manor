/** Resume versions live in Supabase (private bucket + metadata rows); each
    job application can record exactly which version it was sent with. */

export interface ResumeVersion {
  id: string
  label: string
  fileName: string
  byteSize: number
  uploadedAt: string
}

export interface ResumeUpload {
  label: string
  fileName: string
  /** File bytes, base64-encoded (JSON-safe for uploads). */
  base64: string
}

export interface ResumesApi {
  list: () => Promise<readonly ResumeVersion[]>
  upload: (upload: ResumeUpload) => Promise<ResumeVersion>
  remove: (resumeId: string) => Promise<void>
}

export function parseResumeUpload(value: unknown): ResumeUpload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Resume upload must be an object')
  }
  const upload = value as Record<string, unknown>
  if (typeof upload.label !== 'string' || upload.label.trim() === '') {
    throw new TypeError('Resume upload requires a version label')
  }
  if (typeof upload.fileName !== 'string' || !upload.fileName.toLowerCase().endsWith('.pdf')) {
    throw new TypeError(`Resume upload requires a .pdf file, got ${String(upload.fileName)}`)
  }
  if (typeof upload.base64 !== 'string' || upload.base64 === '') {
    throw new TypeError('Resume upload requires file content')
  }
  return { label: upload.label.trim(), fileName: upload.fileName, base64: upload.base64 }
}
