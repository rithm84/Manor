// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { ManorConnectionError, ManorRequestError, describeRequestFailure, requestFailure } from './ManorGateway'

describe('request failure wording', () => {
  it('names the value a check constraint rejected instead of the constraint', () => {
    const detail = 'new row for relation "job_roles" violates check constraint "job_roles_location_check"'
    expect(describeRequestFailure('23514', detail)).toBe('The location is too long or not in the expected form.')
    expect(new ManorRequestError('add_job_listing', '23514', detail).message).not.toContain('add_job_listing')
  })

  it('keeps server-written sentences, such as a revision conflict, as they are', () => {
    expect(describeRequestFailure('PT409', 'Record changed. Reload and resolve the edit.')).toBe('Record changed. Reload and resolve the edit.')
  })

  it('reads a request that got no answer as a connection problem, in the reader\'s words, and says so to the app', () => {
    const seen: boolean[] = []
    const listener = (event: Event): void => { if (event instanceof CustomEvent) seen.push(event.detail.connected as boolean) }
    window.addEventListener('manor:connection', listener)
    const failure = requestFailure('Read habit history', { code: '', message: 'TypeError: Load failed' }, 0)
    window.removeEventListener('manor:connection', listener)
    expect(failure).toBeInstanceOf(ManorConnectionError)
    expect(failure.message).not.toContain('TypeError')
    expect((failure as ManorConnectionError).detail).toBe('TypeError: Load failed')
    expect(seen).toEqual([false])
    expect(requestFailure('Read habit history', { code: 'PT409', message: 'Record changed.' }, 409)).toBeInstanceOf(ManorRequestError)
  })
})
