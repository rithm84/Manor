import { describe, expect, it, vi } from 'vitest'

import { NoteWriterLocks } from './NotesService'

class AvailableLockManager {
  readonly releases: Array<Promise<void>> = []

  async request(_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    const held = callback({ name: 'note', mode: 'exclusive' })
    this.releases.push(held)
    await held
  }
}

class UnavailableLockManager {
  async request(_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>): Promise<void> {
    await callback(null)
  }
}

describe('NoteWriterLocks', () => {
  it('shares an in-flight lock across effect remounts and releases after the final owner', async () => {
    const manager = new AvailableLockManager()
    const request = vi.spyOn(manager, 'request')
    const locks = new NoteWriterLocks('account-1', manager)

    const firstAcquire = locks.acquire('note-1')
    const secondAcquire = locks.acquire('note-1')
    const [releaseFirst, releaseSecond] = await Promise.all([firstAcquire, secondAcquire])

    expect(request).toHaveBeenCalledTimes(1)
    expect(locks.owns('note-1')).toBe(true)
    releaseFirst()
    expect(locks.owns('note-1')).toBe(true)
    releaseSecond()
    await expect(manager.releases[0]).resolves.toBeUndefined()
    expect(locks.owns('note-1')).toBe(false)
  })

  it('reports a genuinely unavailable cross-tab lock', async () => {
    const locks = new NoteWriterLocks('account-1', new UnavailableLockManager())

    await expect(locks.acquire('note-1')).rejects.toThrow('another Manor tab')
    expect(locks.owns('note-1')).toBe(false)
  })
})
