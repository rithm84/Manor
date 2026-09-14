import { DESKTOP_WEBVIEW_ORIGIN, OriginNotAllowedError, assertAllowedOrigin, settingsReturnUrl } from '../functions/_shared/origins.ts'

const WEB_ORIGIN = 'https://mymanor-staging.vercel.app'
const CONFIGURATION_MESSAGE = 'exact HTTPS origins, local development origins, or the desktop app origin'

type Environment = { MANOR_ORIGIN: string | null; MANOR_ALLOWED_ORIGINS: string | null; MANOR_DESKTOP_SCHEME: string | null }

function apply(environment: Environment): void {
  for (const [name, value] of Object.entries(environment)) {
    if (value === null) Deno.env.delete(name)
    else Deno.env.set(name, value)
  }
}

function withEnvironment(environment: Environment, run: () => void): void {
  const saved: Environment = {
    MANOR_ORIGIN: Deno.env.get('MANOR_ORIGIN') ?? null,
    MANOR_ALLOWED_ORIGINS: Deno.env.get('MANOR_ALLOWED_ORIGINS') ?? null,
    MANOR_DESKTOP_SCHEME: Deno.env.get('MANOR_DESKTOP_SCHEME') ?? null,
  }
  apply(environment)
  try { run() } finally { apply(saved) }
}

function rejection(run: () => void): Error {
  try { run() } catch (error) { if (error instanceof Error) return error; throw error }
  throw new Error('Expected a rejection but the call returned')
}

Deno.test('the desktop webview origin is allowed only while it is configured', () => {
  withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: `${DESKTOP_WEBVIEW_ORIGIN}, http://localhost:5173`, MANOR_DESKTOP_SCHEME: null }, () => {
    for (const origin of [WEB_ORIGIN, DESKTOP_WEBVIEW_ORIGIN, 'http://localhost:5173']) {
      if (assertAllowedOrigin(origin) !== origin) throw new Error(`Configured origin ${origin} was not returned`)
    }
  })
  withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: null, MANOR_DESKTOP_SCHEME: 'manor-staging' }, () => {
    const error = rejection(() => assertAllowedOrigin(DESKTOP_WEBVIEW_ORIGIN))
    if (!(error instanceof OriginNotAllowedError)) throw new Error(`Unconfigured desktop origin failed with ${error.message}`)
  })
})

Deno.test('origins that only look like the desktop app are rejected', () => {
  withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: DESKTOP_WEBVIEW_ORIGIN, MANOR_DESKTOP_SCHEME: 'manor-staging' }, () => {
    for (const origin of ['tauri://evil', 'http://tauri.localhost', 'tauri://localhost.evil.example', 'https://localhost']) {
      const error = rejection(() => assertAllowedOrigin(origin))
      if (!(error instanceof OriginNotAllowedError)) throw new Error(`Origin ${origin} failed with ${error.message}`)
    }
  })
})

Deno.test('a configured entry that is not an exact allowed origin fails as configuration', () => {
  for (const entry of ['https://mymanor.vercel.app/settings', 'http://example.com', 'tauri://evil', 'tauri://localhost/settings']) {
    withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: entry, MANOR_DESKTOP_SCHEME: null }, () => {
      const error = rejection(() => assertAllowedOrigin(WEB_ORIGIN))
      if (error instanceof OriginNotAllowedError || !error.message.includes(CONFIGURATION_MESSAGE)) {
        throw new Error(`Entry ${entry} was not reported as a configuration error: ${error.message}`)
      }
    })
  }
})

Deno.test('settings returns to a path on the web and to the desktop scheme in the app', () => {
  withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: DESKTOP_WEBVIEW_ORIGIN, MANOR_DESKTOP_SCHEME: 'manor-staging' }, () => {
    const web = settingsReturnUrl(WEB_ORIGIN)
    web.searchParams.set('connection_provider', 'google')
    if (web.toString() !== `${WEB_ORIGIN}/settings?connection_provider=google`) throw new Error(`Web return URL is ${web.toString()}`)
    const desktop = settingsReturnUrl(DESKTOP_WEBVIEW_ORIGIN)
    if (desktop.toString() !== 'manor-staging://settings') throw new Error(`Desktop return URL is ${desktop.toString()}`)
    desktop.searchParams.set('connection_provider', 'google')
    desktop.searchParams.set('connection_code', 'code/with+symbols')
    if (desktop.toString() !== 'manor-staging://settings?connection_provider=google&connection_code=code%2Fwith%2Bsymbols') {
      throw new Error(`Desktop return URL lost its query: ${desktop.toString()}`)
    }
  })
})

Deno.test('the desktop return URL requires a configured scheme that is a valid URL scheme', () => {
  withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: DESKTOP_WEBVIEW_ORIGIN, MANOR_DESKTOP_SCHEME: null }, () => {
    const error = rejection(() => settingsReturnUrl(DESKTOP_WEBVIEW_ORIGIN))
    if (!error.message.includes('Missing server configuration MANOR_DESKTOP_SCHEME')) throw new Error(`Missing scheme failed with ${error.message}`)
  })
  for (const scheme of ['Manor', '1manor', 'manor staging', 'manor_staging', 'manor-staging://settings']) {
    withEnvironment({ MANOR_ORIGIN: WEB_ORIGIN, MANOR_ALLOWED_ORIGINS: DESKTOP_WEBVIEW_ORIGIN, MANOR_DESKTOP_SCHEME: scheme }, () => {
      const error = rejection(() => settingsReturnUrl(DESKTOP_WEBVIEW_ORIGIN))
      if (!error.message.includes('must match [a-z][a-z0-9-]*')) throw new Error(`Scheme "${scheme}" failed with ${error.message}`)
    })
  }
})
