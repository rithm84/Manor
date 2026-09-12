import { describe, expect, it } from 'vitest'
import { changeJournalPassphrase, createJournalKey, decryptEntry, encryptEntry, unlockJournalKey } from './crypto'

const ACCOUNT = 'synthetic-journal-account'
const PASSPHRASE = 'synthetic testing passphrase only'

describe('isolated Journal encryption', () => {
  it('round-trips synthetic text with non-exportable keys and unique nonces', async () => {
    const start = performance.now()
    const { key, envelope } = await createJournalKey(ACCOUNT, PASSPHRASE)
    expect(key.extractable).toBe(false)
    expect(envelope.iterations).toBe(600000)
    const first = await encryptEntry(key, ACCOUNT, '2026-09-09', 1, 'Synthetic text, never a real Journal entry.')
    const second = await encryptEntry(key, ACCOUNT, '2026-09-09', 1, 'Synthetic text, never a real Journal entry.')
    expect(first.nonce).not.toBe(second.nonce)
    expect(await decryptEntry(key, ACCOUNT, '2026-09-09', 1, first)).toBe('Synthetic text, never a real Journal entry.')
    console.info('Synthetic Journal KDF roundtrip timing', { milliseconds: Math.round(performance.now() - start) })
  })
  it('rejects wrong passphrases, account substitution, entry metadata substitution, and ciphertext tampering', async () => {
    const { key, envelope } = await createJournalKey(ACCOUNT, PASSPHRASE)
    await expect(unlockJournalKey(ACCOUNT, 'different passphrase, no recovery', envelope)).rejects.toThrow()
    await expect(unlockJournalKey('another-account', PASSPHRASE, envelope)).rejects.toThrow()
    const encrypted = await encryptEntry(key, ACCOUNT, '2026-09-09', 1, 'Synthetic only')
    await expect(decryptEntry(key, ACCOUNT, '2026-09-10', 1, encrypted)).rejects.toThrow()
    await expect(decryptEntry(key, ACCOUNT, '2026-09-09', 2, encrypted)).rejects.toThrow()
    const modified = { ...encrypted, ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}` }
    await expect(decryptEntry(key, ACCOUNT, '2026-09-09', 1, modified)).rejects.toThrow()
  })
  it('changes the passphrase without changing entry encryption and makes the old passphrase unusable', async () => {
    const { key, envelope } = await createJournalKey(ACCOUNT, PASSPHRASE)
    const encrypted = await encryptEntry(key, ACCOUNT, '2026-09-09', 1, 'Synthetic preserved content')
    const nextPhrase = 'another synthetic passphrase for testing'
    const changed = await changeJournalPassphrase(ACCOUNT, PASSPHRASE, nextPhrase, envelope)
    await expect(unlockJournalKey(ACCOUNT, PASSPHRASE, changed)).rejects.toThrow()
    const unlocked = await unlockJournalKey(ACCOUNT, nextPhrase, changed)
    expect(await decryptEntry(unlocked, ACCOUNT, '2026-09-09', 1, encrypted)).toBe('Synthetic preserved content')
  })
})
