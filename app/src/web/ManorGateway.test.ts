import { describe, expect, it } from 'vitest'

import { ManorRequestError, describeRequestFailure } from './ManorGateway'

describe('request failure wording', () => {
  it('names the value a check constraint rejected instead of the constraint', () => {
    const detail = 'new row for relation "job_roles" violates check constraint "job_roles_location_check"'
    expect(describeRequestFailure('23514', detail)).toBe('The location is too long or not in the expected form.')
    expect(new ManorRequestError('add_job_listing', '23514', detail).message).not.toContain('add_job_listing')
  })

  it('keeps server-written sentences, such as a revision conflict, as they are', () => {
    expect(describeRequestFailure('PT409', 'Record changed. Reload and resolve the edit.')).toBe('Record changed. Reload and resolve the edit.')
  })
})
