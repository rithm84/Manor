export class OriginNotAllowedError extends Error {
  constructor() { super('Origin is not allowed'); this.name = 'OriginNotAllowedError' }
}

export function assertAllowedOrigin(origin: string): string {
  const canonical = Deno.env.get('MANOR_ORIGIN')
  if (!canonical) throw new Error('Missing server configuration MANOR_ORIGIN')
  const additional = Deno.env.get('MANOR_ALLOWED_ORIGINS')
  const configured = [canonical, ...(additional ? additional.split(',').map(value => value.trim()) : [])]
  for (const value of configured) {
    const url = new URL(value)
    if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new Error('Manor origins must be exact HTTPS origins or local development origins')
    }
  }
  if (!configured.includes(origin)) throw new OriginNotAllowedError()
  return origin
}

export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin')
  return origin === null ? null : assertAllowedOrigin(origin)
}

export function originHeaders(origin: string | null): Record<string, string> {
  return origin === null ? { Vary: 'Origin' } : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
}
