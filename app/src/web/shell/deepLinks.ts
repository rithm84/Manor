/** The route a deep link uses to finish signing in. */
export const AUTH_CALLBACK_ROUTE = '/auth/callback'

/** What Supabase Auth returned to `/auth/callback`. */
export type SignInOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }

/** Callback URLs carry an auth code or session tokens, so error text quotes the address only. */
function withoutSecrets(url: string): string {
  return url.split('?')[0].split('#')[0]
}

/**
 * Turns a deep link into an app route: `<scheme>://<host>/<path>?<query>#<fragment>` becomes
 * `/<host>/<path>?<query>#<fragment>`. Custom schemes park the first segment in `host` and the
 * rest in `pathname`, so the two are joined back together here.
 */
export function deepLinkRoute(url: string, scheme: string): string {
  let link: URL
  try {
    link = new URL(url)
  } catch {
    throw new Error(`Manor received a deep link that is not a URL: ${withoutSecrets(url)}`)
  }
  if (link.protocol !== `${scheme}:`) {
    throw new Error(`Manor received a ${link.protocol.replace(':', '')} deep link, but this build opens ${scheme} links`)
  }
  const path = `/${link.host}${link.pathname}`.replace(/^\/+/, '/')
  return `${path}${link.search}${link.hash}`
}

/**
 * Reads what a sign-in callback route carries: `?code=` from the PKCE flow, `#access_token=` and
 * `#refresh_token=` from a verify link, or an error from a refused sign-in.
 */
export function signInOutcome(route: string): SignInOutcome {
  const callback = new URL(route, 'https://manor.invalid')
  const query = callback.searchParams
  const fragment = new URLSearchParams(callback.hash.slice(1))
  const failure = query.get('error_description') ?? fragment.get('error_description') ?? query.get('error') ?? fragment.get('error')
  if (failure !== null) return { kind: 'error', message: failure }
  const code = query.get('code')
  if (code !== null) return { kind: 'code', code }
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  if (accessToken !== null && refreshToken !== null) return { kind: 'tokens', accessToken, refreshToken }
  throw new Error(`The sign-in callback ${withoutSecrets(route)} carried no authorization code, no session, and no error`)
}
