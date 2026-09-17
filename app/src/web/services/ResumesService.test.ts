import { describe, expect, it, vi } from 'vitest'

import type { JsonObject, ManorGateway } from '../ManorGateway'
import { ResumesService } from './ResumesService'

const ID = '0d3f4b7e-6f1e-4b1a-9a8e-2c9d1f0e5a11'
const ROW: JsonObject = { id: ID, label: 'Garner-Resume.pdf', file_name: 'Garner-Resume.pdf', byte_size: 3, uploaded_at: '2026-09-17T21:52:00+00:00' }

vi.mock('./FileService', () => ({
  FileService: class {
    async upload(): Promise<{ id: string; path: string; size: number; mimeType: string }> {
      return { id: ID, path: 'resumes/x.pdf', size: 3, mimeType: 'application/pdf' }
    }
  }
}))

/** The verifier committed the row, but the mirror the cached read serves from has not pulled it yet. */
class LaggingMirrorGateway {
  serverReads = 0
  async rows(): Promise<JsonObject[]> { return [] }
  async readRowsFromServer(): Promise<JsonObject[]> { this.serverReads += 1; return [ROW] }
}

describe('ResumesService upload', () => {
  it('answers from the server when the cached list has not caught up with the finalized row', async () => {
    const gateway = new LaggingMirrorGateway()
    const service = new ResumesService(gateway as unknown as ManorGateway)
    const version = await service.upload({ label: 'Garner-Resume.pdf', fileName: 'Garner-Resume.pdf', base64: 'QUJD' })
    expect(version).toEqual({ id: ID, label: 'Garner-Resume.pdf', fileName: 'Garner-Resume.pdf', byteSize: 3, uploadedAt: '2026-09-17T21:52:00+00:00' })
    expect(gateway.serverReads).toBe(1)
  })
})
