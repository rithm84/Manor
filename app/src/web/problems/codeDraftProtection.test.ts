import { describe, expect, it } from 'vitest'
import { CodeDraftProtectionBoundary } from './codeDraftProtection'

const identity = { accountId: 'account', problemId: 'problem', language: 'python' as const }

function restartAllowed(target: EventTarget): boolean { return target.dispatchEvent(new Event('manor:before-update', { cancelable: true })) }

describe('code draft update protection', () => {
  it('blocks while local I/O is pending, including after navigation, then permits locally protected cloud-pending source', async () => {
    const target = new EventTarget()
    const protection = new CodeDraftProtectionBoundary<typeof identity>(target)
    expect(restartAllowed(target)).toBe(true)
    const locallyProtected = protection.begin(identity)
    let finish: () => void = (): void => { throw new Error('The deferred local write did not initialize.') }
    const pendingWrite = new Promise<void>(resolve => { finish = resolve }).then(locallyProtected)
    expect(restartAllowed(target)).toBe(false)
    expect(protection.hasUnprotected(identity.accountId)).toBe(true)
    expect(protection.hasUnprotected('other-account')).toBe(false)
    finish()
    await pendingWrite
    expect(restartAllowed(target)).toBe(true)
  })
  it('cannot release a newer source generation with an older receipt and keeps failed writes blocked until recovery', () => {
    const target = new EventTarget()
    const protection = new CodeDraftProtectionBoundary<typeof identity & { readonly code: string }>(target)
    const olderReceipt = protection.begin({ ...identity, code: 'older source' })
    const latestReceipt = protection.begin({ ...identity, code: 'latest source' })
    olderReceipt()
    expect(restartAllowed(target)).toBe(false)
    expect(protection.readUnprotected(identity)?.code).toBe('latest source')
    // A failed local write never acknowledges its receipt; navigating does not remove the guard.
    expect(restartAllowed(target)).toBe(false)
    const recoveredReceipt = protection.begin({ ...identity, code: 'latest source' })
    latestReceipt()
    expect(restartAllowed(target)).toBe(false)
    recoveredReceipt()
    expect(restartAllowed(target)).toBe(true)
    expect(protection.readUnprotected(identity)).toBeNull()
  })
})
