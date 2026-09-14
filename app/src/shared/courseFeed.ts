/** Course calendar feed connection state (the Canvas feed link saved in Settings). The link itself is never sent to the browser. */
export interface CourseFeedStatus {
  connected: boolean
  /** Host the link points at, for display; null when disconnected. */
  host: string | null
  connectedAt: string | null
  lastCheckedAt: string | null
  /** Items the last check returned for its window; null when never checked. */
  lastItemCount: number | null
  lastError: string | null
}

export interface CourseFeedCheck {
  from: string
  to: string
  total: number
}

export interface CourseFeedApi {
  status: () => Promise<CourseFeedStatus>
  /** Validates the link by fetching it, saves it, and reports how many items are due in the next two weeks. */
  connect: (url: string) => Promise<{ host: string; count: number }>
  disconnect: () => Promise<void>
  /** Fetches the feed now and reports the count for the default window. */
  check: () => Promise<CourseFeedCheck>
}
