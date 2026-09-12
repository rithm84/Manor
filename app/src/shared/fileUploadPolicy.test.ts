import { describe, expect, it } from 'vitest'
import { MAX_FILE_UPLOAD_BYTES, validateFileUploadSize } from './fileUploadPolicy'
describe('file upload admission', () => {
  it('accepts the reported video size and the exact Storage limit', () => {
    expect(() => validateFileUploadSize(37 * 1024 * 1024)).not.toThrow()
    expect(() => validateFileUploadSize(MAX_FILE_UPLOAD_BYTES)).not.toThrow()
  })
  it('rejects unsupported sizes before an upload can be queued', () => {
    expect(() => validateFileUploadSize(MAX_FILE_UPLOAD_BYTES + 1)).toThrow('Choose a file no larger than 1 GB.')
    expect(() => validateFileUploadSize(0)).toThrow('This file is empty.')
    expect(() => validateFileUploadSize(Number.NaN)).toThrow('invalid size')
  })
})
