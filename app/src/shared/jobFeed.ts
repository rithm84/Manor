/**
 * The SimplifyJobs internship feed: a shared, read-only catalog of postings
 * ingested on a schedule. Browsing is separate from the pipeline — a listing
 * becomes a job role only when the user adds it.
 */

export interface JobListing {
  id: string
  company: string
  role: string
  locations: string
  url: string
  posted: string
  /** Hiring cycle, e.g. "Summer 2027"; '' when the source omits it. */
  term: string
  /** Source's own bucket, e.g. "Software"; '' when the source omits it. */
  category: string
  /** True once this machine has added the listing to the pipeline. */
  added: boolean
  /** How many separate requisitions share this company, role, location, and
      cycle. Big employers post the same job many times; the row stands for
      all of them and adding it tracks one. */
  openings: number
}

export interface JobFeedPage {
  listings: readonly JobListing[]
  /** Distinct terms present in the feed, newest cycle first. */
  terms: readonly string[]
  /** Distinct categories present in the feed, alphabetical. */
  categories: readonly string[]
  /** True when the fetch was capped; the UI says so rather than implying all. */
  truncated: boolean
}

export function parseJobListingId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('A job listing id must be a non-empty string')
  }
  return value.trim()
}
