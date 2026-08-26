/** X (Twitter) bookmark sync: OAuth connection state and the bridge API
    served by main/xChannels.ts (renderer reaches it as window.manor.x). */

export interface XConnectionStatus {
  connected: boolean
  /** The connected account's @handle, without the @; null when disconnected. */
  username: string | null
  /** ISO timestamp of when the account was connected; null when disconnected. */
  connectedAt: string | null
}

export interface XApi {
  /** Starts an OAuth flow: boots the loopback listener and returns the URL to open. */
  beginConnect: () => Promise<{ authorizeUrl: string }>
  /**
   * Resolves once the browser callback lands and tokens are stored, or rejects
   * after about 120 seconds when the sign in never completes.
   */
  completeConnect: () => Promise<XConnectionStatus>
  /** Current connection state; reports disconnected when signed out of Manor. */
  status: () => Promise<XConnectionStatus>
  disconnect: () => Promise<void>
  /** Runs one bookmark sync immediately and reports how many posts arrived. */
  ingestNow: () => Promise<{ added: number }>
}
