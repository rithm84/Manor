import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ciphertextSchema, keyEnvelopeSchema } from './crypto'
import type { Ciphertext, KeyEnvelope } from './crypto'

const keyringSchema = z.object({ envelope: keyEnvelopeSchema, revision: z.number().int().positive() })
const entrySchema = z.object({ date: z.iso.date(), envelope: ciphertextSchema.nullable(), revision: z.number().int().positive() })
const stateSchema = z.object({ keyring: keyringSchema.nullable(), entries: z.array(entrySchema), timezone: z.string().min(1) })
export type JournalState = z.infer<typeof stateSchema>
export type JournalEntry = z.infer<typeof entrySchema>
export type JournalKeyring = z.infer<typeof keyringSchema>
type RpcArguments = Record<string, string | number | boolean | Ciphertext | KeyEnvelope>

/** This adapter accepts ciphertext only and is never imported by the ordinary Manor app. */
export class JournalApi {
  private readonly client: SupabaseClient
  constructor(client: SupabaseClient) { this.client = client }
  private async call(operation: string, params: RpcArguments): Promise<z.infer<ReturnType<typeof z.json>>> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error, status } = await this.client.rpc(operation, params)
      if (error === null) return z.json().parse(data)
      if (attempt === 2 || (status !== 0 && status !== 429 && status < 500)) throw new Error(`${operation}: ${error.message} (${error.code}, HTTP ${status})`)
      console.warn('Retrying encrypted Journal request', { operation, attempt: attempt + 1, status })
      await new Promise<void>((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
    throw new Error('Journal request attempts exhausted')
  }
  async load(): Promise<JournalState> { return stateSchema.parse(await this.call('journal_read_state', {})) }
  async saveKeyring(envelope: KeyEnvelope, expectedRevision: number): Promise<JournalKeyring> {
    return keyringSchema.parse(await this.call('journal_save_keyring', { p_envelope: envelope, p_expected_revision: expectedRevision }))
  }
  async saveEntry(date: string, envelope: Ciphertext, expectedRevision: number): Promise<JournalEntry> {
    return entrySchema.parse(await this.call('journal_save_entry', { p_date: date, p_envelope: envelope, p_expected_revision: expectedRevision }))
  }
  async deleteEntry(date: string, expectedRevision: number): Promise<JournalEntry> {
    return entrySchema.parse(await this.call('journal_delete_entry', { p_date: date, p_expected_revision: expectedRevision, p_confirm: true }))
  }
}
