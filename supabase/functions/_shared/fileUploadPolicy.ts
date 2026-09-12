export const FILE_VERIFICATION_CHUNK_BYTES = 32 * 1024 * 1024

/** Decimal 1 GB is the maximum attachment size; avatar limits remain narrower. */
export const MAX_FILE_UPLOAD_BYTES = 1_000_000_000
export class FileUploadSizeError extends Error {
  readonly code: 'file_too_large' | 'file_empty' | 'file_size_invalid'
  constructor(code: 'file_too_large' | 'file_empty' | 'file_size_invalid', message: string) {
    super(message)
    this.name = 'FileUploadSizeError'
    this.code = code
  }
}
/** Call before reading bytes or persisting a pending upload. */
export function validateFileUploadSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new FileUploadSizeError('file_size_invalid', 'This file has an invalid size. Choose the file again.')
  if (size === 0) throw new FileUploadSizeError('file_empty', 'This file is empty. Choose a file with content.')
  if (size > MAX_FILE_UPLOAD_BYTES) throw new FileUploadSizeError('file_too_large', 'Choose a file no larger than 1 GB.')
}
