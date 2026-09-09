/** X bookmark connection state. */

export interface XConnectionStatus {
  connected: boolean
  /** The connected account's @handle, without the @; null when disconnected. */
  username: string | null
  /** ISO timestamp of when the account was connected; null when disconnected. */
  connectedAt: string | null
}

export interface XApi {
  /** Current connection state; reports disconnected when signed out of Manor. */
  status: () => Promise<XConnectionStatus>
  disconnect: () => Promise<void>
  /** Runs one bookmark sync immediately and reports how many posts arrived. */
  ingestNow: () => Promise<{ added: number }>
}
