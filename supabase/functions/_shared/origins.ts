/**
 * The Tauri desktop shell serves the built frontend from its own protocol handler, so requests
 * from that window carry the literal origin `tauri://localhost` instead of an HTTPS origin.
 * Deno parses the value but reports `new URL('tauri://localhost').origin` as the string "null",
 * so every check compares this constant literally before falling back to URL parsing.
 */
export const DESKTOP_WEBVIEW_ORIGIN = 'tauri://localhost'

export class OriginNotAllowedError extends Error {
  constructor() { super('Origin is not allowed'); this.name = 'OriginNotAllowedError' }
}

/**
 * Validates the configured allowlist, then confirms the caller's origin is on it. A configured
 * entry is an exact HTTPS origin, a local development http origin, or the desktop app origin.
 */
export function assertAllowedOrigin(origin: string): string {
  const canonical = Deno.env.get('MANOR_ORIGIN')
  if (!canonical) throw new Error('Missing server configuration MANOR_ORIGIN')
  const additional = Deno.env.get('MANOR_ALLOWED_ORIGINS')
  const configured = [canonical, ...(additional ? additional.split(',').map(value => value.trim()) : [])]
  for (const value of configured) {
    if (value === DESKTOP_WEBVIEW_ORIGIN) continue
    const url = URL.parse(value)
    if (url === null || url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error(`Manor origins must be exact HTTPS origins, local development origins, or the desktop app origin; received "${value}"`)
    }
  }
  if (!configured.includes(origin)) throw new OriginNotAllowedError()
  return origin
}

/**
 * The URL scheme the desktop build registered with the operating system (`manor` for production,
 * `manor-staging` for staging). Each backend serves exactly one desktop build, so the scheme is
 * configuration rather than something a request can choose. Every link that has to reach the app
 * from outside it, whether a connection return or an agent's consent request, is built from this.
 */
export function desktopScheme(): string {
  const scheme = Deno.env.get('MANOR_DESKTOP_SCHEME')
  if (!scheme) throw new Error('Missing server configuration MANOR_DESKTOP_SCHEME, required to return to the desktop app')
  if (!/^[a-z][a-z0-9-]*$/.test(scheme)) throw new Error(`Server configuration MANOR_DESKTOP_SCHEME must match [a-z][a-z0-9-]*, received "${scheme}"`)
  return scheme
}

/**
 * Where a connection flow returns the browser that started it. The desktop app has no HTTP
 * origin to redirect to, so it receives a deep link on its own URL scheme instead.
 */
export function settingsReturnUrl(origin: string): URL {
  if (origin !== DESKTOP_WEBVIEW_ORIGIN) return new URL('/settings', origin)
  return new URL(`${desktopScheme()}://settings`)
}

export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin')
  return origin === null ? null : assertAllowedOrigin(origin)
}

export function originHeaders(origin: string | null): Record<string, string> {
  return origin === null ? { Vary: 'Origin' } : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}
