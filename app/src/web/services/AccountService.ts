import { z } from 'zod'
import type { AccountApi, AccountInfo, AgentConnectionRequest, AgentConnectionReturn, AvatarUpload } from '../../shared/account'
import { agentConnectionRequestSchema, agentConnectionReturnSchema, parseAvatarUpload } from '../../shared/account'
import type { ManorGateway } from '../ManorGateway'
import type { MirrorStore } from '../mirror/MirrorStore'
import type { NoteDraftStore } from '../notes/NoteDraftStore'
import { signInWithGoogle } from '../auth'
import type { DesktopShell } from '../shell/DesktopShell'
import { FileService } from './FileService'
import type { AgentConnection } from '../../shared/account'

/**
 * Authorization IDs reach Manor through a deep link, so a malformed one is a broken request, not a bug.
 * Supabase mints an opaque token (32 lowercase letters and digits today), not a UUID, so only the shape
 * of a URL-safe token is checked here and Supabase decides whether it exists.
 */
function authorizationId(value: string): string {
  const parsed = z.string().regex(/^[A-Za-z0-9._-]{8,200}$/).safeParse(value)
  if (!parsed.success) throw new Error('This connection request is not valid. Ask the app to connect again.')
  return parsed.data
}

export class AccountService implements AccountApi {
  private readonly gateway: ManorGateway
  private readonly drafts: NoteDraftStore
  private readonly shell: DesktopShell
  private readonly mirror: MirrorStore
  constructor(gateway: ManorGateway, drafts: NoteDraftStore, shell: DesktopShell, mirror: MirrorStore) { this.gateway = gateway; this.drafts = drafts; this.shell = shell; this.mirror = mirror }
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
  async connectionRequest(id: string): Promise<AgentConnectionRequest | AgentConnectionReturn> {
    const { data, error } = await this.gateway.client.auth.oauth.getAuthorizationDetails(authorizationId(id))
    if (error) throw error
    if ('redirect_url' in data) return agentConnectionReturnSchema.parse({ redirectUrl: data.redirect_url })
    return agentConnectionRequestSchema.parse({ clientId: data.client.id, clientName: data.client.name })
  }
  async approveConnection(id: string, allowWrites: boolean): Promise<string> {
    // Manor records the grant against the OAuth client, and only the authorization carries that client's id.
    const request = await this.connectionRequest(id)
    if ('redirectUrl' in request) throw new Error('This connection request was already answered')
    const grant = await this.gateway.client.rpc('manor_authorize_mcp_client', { p_client_id: request.clientId, p_write: allowWrites })
    if (grant.error) throw grant.error
    const { data, error } = await this.gateway.client.auth.oauth.approveAuthorization(authorizationId(id), { skipBrowserRedirect: true })
    if (error) throw error
    return agentConnectionReturnSchema.parse({ redirectUrl: data.redirect_url }).redirectUrl
  }
  async denyConnection(id: string): Promise<string> {
    const { data, error } = await this.gateway.client.auth.oauth.denyAuthorization(authorizationId(id), { skipBrowserRedirect: true })
    if (error) throw error
    return agentConnectionReturnSchema.parse({ redirectUrl: data.redirect_url }).redirectUrl
  }
  signInWithGoogle(): Promise<void> { return signInWithGoogle(this.gateway.client, this.shell) }
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
      // The mirror is account data on this device, so it leaves with the rest of it. The sync stops first,
      // so no read and no pull is still in flight against the file being deleted. The session is already
      // gone by now, so a mirror that refuses to go is reported rather than turned into a failed sign-out;
      // opening it again under any account rebuilds it from scratch.
      this.gateway.stopMirror()
      await this.mirror.wipe(this.gateway.accountId).catch((cause: unknown) => console.error('Manor could not delete the local mirror on sign-out', { accountId: this.gateway.accountId, cause }))
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
