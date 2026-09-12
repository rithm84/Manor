import { z } from 'zod'
import type { AccountApi, AccountInfo, AvatarUpload } from '../../shared/account'
import { parseAvatarUpload } from '../../shared/account'
import type { ManorGateway } from '../ManorGateway'
import type { NoteDraftStore } from '../notes/NoteDraftStore'
import { signInWithGoogle } from '../auth'
import { FileService } from './FileService'
import type { AgentConnection } from '../../shared/account'

export class AccountService implements AccountApi {
  private readonly gateway: ManorGateway
  private readonly drafts: NoteDraftStore
  constructor(gateway: ManorGateway, drafts: NoteDraftStore) { this.gateway = gateway; this.drafts = drafts }
  async connections(): Promise<readonly AgentConnection[]> {
    const { data, error } = await this.gateway.client.rpc('manor_list_mcp_clients')
    if (error) throw error
    return z.array(z.object({ client_id: z.uuid(), can_write: z.boolean(), authorized_at: z.iso.datetime({ offset: true }) })).parse(data)
      .map(item => ({ clientId: item.client_id, canWrite: item.can_write, authorizedAt: item.authorized_at }))
  }
  async revokeConnection(clientId: string): Promise<void> {
    const { error } = await this.gateway.client.rpc('manor_revoke_mcp_client', { p_client_id: z.uuid().parse(clientId) })
    if (error) throw error
  }
  signInWithGoogle(): Promise<void> { return signInWithGoogle(this.gateway.client) }
  async current(): Promise<AccountInfo | null> {
    const { data, error } = await this.gateway.client.auth.getSession()
    if (error) throw error
    if (!data.session) return null
    return { userId: data.session.user.id, email: z.email().parse(data.session.user.email) }
  }
  async signOut(): Promise<'signedOut' | 'cancelled'> {
    return navigator.locks.request(`manor-account:${this.gateway.accountId}`, async () => {
      const [drafts, attachments] = await Promise.all([this.drafts.list(this.gateway.accountId), this.drafts.attachments(this.gateway.accountId)])
      if (drafts.length > 0 || attachments.length > 0) return 'cancelled' as const
      const { error } = await this.gateway.client.auth.signOut({ scope: 'local' })
      if (error) throw error
      localStorage.removeItem(`manor.account:${this.gateway.accountId}`)
      return 'signedOut' as const
    })
  }
  async avatarUrl(): Promise<string | null> {
    const profiles = await this.gateway.rows('profiles')
    if (profiles.length === 0) return null
    const settings = z.record(z.string(), z.json()).parse(profiles[0].settings)
    if (settings.avatar_file_id) return new FileService(this.gateway).signedUrl(z.uuid().parse(settings.avatar_file_id))
    const { data, error } = await this.gateway.client.auth.getSession()
    if (error) throw error
    const picture = data.session?.user.user_metadata.avatar_url
    return typeof picture === 'string' && picture.startsWith('https://') ? picture : null
  }
  async setAvatar(input: AvatarUpload): Promise<string> {
    const upload = parseAvatarUpload(input)
    const bytes = Uint8Array.from(atob(upload.base64), character => character.charCodeAt(0))
    const files = new FileService(this.gateway)
    const file = await files.upload({ id: crypto.randomUUID(), purpose: 'avatar', label: null, parentId: null, name: 'Profile picture', mimeType: upload.contentType, bytes: new Blob([bytes], { type: upload.contentType }) })
    return files.signedUrl(file.id)
  }
}
