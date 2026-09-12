import { z } from 'zod'

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
export const keyEnvelopeSchema = z.object({
  version: z.literal(1), kdf: z.literal('PBKDF2-SHA256'), iterations: z.literal(600000),
  salt: base64, nonce: base64, wrappedKey: base64
})
export type KeyEnvelope = z.infer<typeof keyEnvelopeSchema>
export const ciphertextSchema = z.object({ version: z.literal(1), nonce: base64, ciphertext: base64 })
export type Ciphertext = z.infer<typeof ciphertextSchema>
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function encode(value: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function decode(value: string, expectedLength: number | null): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (expectedLength !== null && bytes.length !== expectedLength) throw new TypeError('Encrypted Journal metadata has an invalid byte length')
  return bytes
}
function metadata(accountId: string, purpose: string, identity: string, revision: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(['manor-journal', 1, accountId, purpose, identity, revision]))
}
async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}
function validateNewPassphrase(passphrase: string): void {
  if (passphrase.length < 16 || passphrase.length > 1024) throw new RangeError('Use a Journal passphrase between 16 and 1,024 characters')
}
async function envelopeFor(accountId: string, passphrase: string, dataKey: CryptoKey): Promise<KeyEnvelope> {
  validateNewPassphrase(passphrase)
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await wrappingKey(passphrase, salt, 600000)
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, key, { name: 'AES-GCM', iv: nonce, additionalData: metadata(accountId, 'key', 'data-key', 1), tagLength: 128 })
  return { version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: encode(salt), nonce: encode(nonce), wrappedKey: encode(wrapped) }
}

/** Native WebCrypto authenticated encryption. KDF cost follows OWASP's PBKDF2-SHA256 baseline. */
export async function createJournalKey(accountId: string, passphrase: string): Promise<{ envelope: KeyEnvelope; key: CryptoKey }> {
  const exportable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const envelope = await envelopeFor(accountId, passphrase, exportable)
  return { envelope, key: await unlockJournalKey(accountId, passphrase, envelope) }
}

/** Unlocks a non-exportable data key held only in the active Journal component. */
export async function unlockJournalKey(accountId: string, passphrase: string, input: KeyEnvelope): Promise<CryptoKey> {
  const envelope = keyEnvelopeSchema.parse(input)
  const wrapping = await wrappingKey(passphrase, decode(envelope.salt, 32), envelope.iterations)
  return crypto.subtle.unwrapKey('raw', decode(envelope.wrappedKey, 48), wrapping,
    { name: 'AES-GCM', iv: decode(envelope.nonce, 12), additionalData: metadata(accountId, 'key', 'data-key', 1), tagLength: 128 },
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Rewraps the same data key without rewriting or decrypting entries. There is no recovery bypass. */
export async function changeJournalPassphrase(accountId: string, currentPassphrase: string, nextPassphrase: string, input: KeyEnvelope): Promise<KeyEnvelope> {
  const envelope = keyEnvelopeSchema.parse(input)
  const wrapping = await wrappingKey(currentPassphrase, decode(envelope.salt, 32), envelope.iterations)
  const key = await crypto.subtle.unwrapKey('raw', decode(envelope.wrappedKey, 48), wrapping,
    { name: 'AES-GCM', iv: decode(envelope.nonce, 12), additionalData: metadata(accountId, 'key', 'data-key', 1), tagLength: 128 },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return envelopeFor(accountId, nextPassphrase, key)
}

export async function encryptEntry(key: CryptoKey, accountId: string, date: string, revision: number, text: string): Promise<Ciphertext> {
  z.iso.date().parse(date)
  z.number().int().positive().parse(revision)
  const plaintext = encoder.encode(text)
  if (plaintext.length > 1024 * 1024) throw new RangeError('A Journal entry must be 1 MB or smaller')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: metadata(accountId, 'entry', date, revision), tagLength: 128 }, key, plaintext)
  return { version: 1, nonce: encode(nonce), ciphertext: encode(ciphertext) }
}

export async function decryptEntry(key: CryptoKey, accountId: string, date: string, revision: number, input: Ciphertext): Promise<string> {
  const envelope = ciphertextSchema.parse(input)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.nonce, 12), additionalData: metadata(accountId, 'entry', date, revision), tagLength: 128 }, key, decode(envelope.ciphertext, null))
  return decoder.decode(plaintext)
}
