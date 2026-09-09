/* Pure mapping from X API bookmark payloads to kb_entries rows. No Deno or
   network access here, so app/tests/xIngestMapping.test.ts can exercise it. */

export interface XPostUrlEntity {
  url: string
  expanded_url?: string
}

export interface XPost {
  id: string
  text: string
  author_id: string
  created_at?: string
  entities?: { urls?: XPostUrlEntity[] }
}

export interface XUser {
  id: string
  username: string
  name: string
}

export interface KbEntryInsert {
  user_id: string
  source: 'x_bookmark'
  source_ref: string
  url: string
  author: string | null
  title: string
  content_md: string
  status: 'pending' | 'normalized'
  captured_at: string
  raw: { post_url: string; article_url: string | null; post: XPost }
}

const TITLE_LIMIT = 80
const X_HOSTS = new Set(['x.com', 'twitter.com', 't.co'])

/** First ~80 characters of the post text, whitespace collapsed. */
export function titleOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= TITLE_LIMIT) return collapsed
  return `${collapsed.slice(0, TITLE_LIMIT).trimEnd()}…`
}

export function postUrlOf(username: string, postId: string): string {
  return `https://x.com/${username}/status/${postId}`
}

/** First entity URL pointing outside X; null when the post links nowhere external. */
export function externalUrlOf(post: XPost): string | null {
  for (const entity of post.entities?.urls ?? []) {
    const candidate = entity.expanded_url ?? entity.url
    let host: string
    try {
      host = new URL(candidate).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (!X_HOSTS.has(host)) return candidate
  }
  return null
}

export function authorOf(user: XUser | undefined): string | null {
  if (user === undefined) return null
  return user.name === '' ? `@${user.username}` : `${user.name} (@${user.username})`
}

/**
 * One kb_entries row for a bookmarked post. Posts that link an external
 * article point their url at the article and stay pending so normalize-capture
 * pulls the article into the same entry (PRD 7.8); the post URL survives in
 * raw. Plain posts keep the x.com URL and arrive already normalized.
 */
export function kbRowOf(
  userId: string,
  post: XPost,
  author: XUser | undefined,
  nowIso: string
): KbEntryInsert {
  const username = author?.username ?? 'i'
  const postUrl = postUrlOf(username, post.id)
  const articleUrl = externalUrlOf(post)
  return {
    user_id: userId,
    source: 'x_bookmark',
    source_ref: post.id,
    url: articleUrl ?? postUrl,
    author: authorOf(author),
    title: titleOf(post.text),
    content_md: post.text,
    status: articleUrl === null ? 'normalized' : 'pending',
    captured_at: nowIso,
    raw: { post_url: postUrl, article_url: articleUrl, post }
  }
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** True when the access token expires within five minutes of nowMs. */
export function needsRefresh(expiresAtIso: string, nowMs: number): boolean {
  return new Date(expiresAtIso).getTime() - nowMs <= REFRESH_MARGIN_MS
}
