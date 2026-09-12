import { z } from 'zod'
import type { KbApi, KbEntry } from '../../shared/kb'
import type { ManorGateway } from '../ManorGateway'
import { camelRow } from './rows'

const entrySchema = z.object({
  id: z.uuid(), source: z.enum(['x_bookmark', 'capture']), url: z.string().nullable(),
  title: z.string().nullable(), author: z.string().nullable(), summary: z.string().nullable(), contentMd: z.string().nullable(),
  status: z.enum(['pending', 'normalized', 'failed']), error: z.string().nullable(), capturedAt: z.string(), normalizedAt: z.string().nullable(), screenshotPath: z.string().nullable()
})

export class KnowledgeService implements KbApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async list(): Promise<readonly KbEntry[]> { return (await this.gateway.rows('kb_entries')).map(row => entrySchema.parse(camelRow(row))) }
  async remove(id: string): Promise<void> {
    await this.gateway.command('remove_capture', { id, expected_revision: this.gateway.revision('kb_entries', id) }, crypto.randomUUID())
  }
  async retryProcessing(id: string): Promise<void> {
    await this.gateway.command('queue_embedding', { id, expected_revision: this.gateway.revision('kb_entries', id) }, crypto.randomUUID())
  }
}
