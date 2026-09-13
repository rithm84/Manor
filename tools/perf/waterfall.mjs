// Request waterfall for a signed-in page load, optionally under CPU and network throttling.
// Usage: node waterfall.mjs <session.json> <origin> <path> [throttle]
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const [sessionPath, origin, path, throttle] = process.argv.slice(2)
const ref = origin.includes('staging') ? 'cysdooljdslgvqrahymm' : 'pxdxqueevzttpmxjsqes'
const { session } = JSON.parse(await readFile(sessionPath, 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
await page.evaluate(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('manor.theme', 'dark') }, [`sb-${ref}-auth-token`, JSON.stringify(session)])
await page.goto(origin + path, { waitUntil: 'networkidle' }) // warm the service worker cache
const cdp = await context.newCDPSession(page)
if (throttle) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 })
}
const rows = []
let t0 = null
page.on('request', (request) => { if (t0 === null) t0 = Date.now(); rows.push({ url: request.url(), type: request.resourceType(), start: Date.now() - t0, end: null, from: null }) })
page.on('response', async (response) => {
  const row = rows.find(r => r.url === response.url() && r.end === null); if (!row) return
  row.end = Date.now() - t0; row.from = response.fromServiceWorker() ? 'sw' : (response.headers()['x-vercel-cache'] ?? (response.headers()['cf-cache-status'] ?? 'net'))
})
const started = Date.now()
await page.goto(origin + path, { waitUntil: 'networkidle' })
const settled = Date.now() - started
const paints = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)])))
console.log(`${path} ${throttle ? 'THROTTLED (4x CPU, 1.6Mbps/150ms)' : 'normal'} settled ${settled}ms paints ${JSON.stringify(paints)}`)
for (const r of rows) {
  const label = r.url.replace(origin, '').replace(/^https:\/\/[^/]*supabase\.co\//, 'SB:').replace(/\?.*$/, '').replace(/^\/assets\//, '').slice(0, 58)
  console.log(`${String(r.start).padStart(5)}-${String(r.end ?? '?').padStart(5)}ms ${String((r.end ?? 0) - r.start).padStart(4)}  ${(r.from ?? '').padEnd(4)} ${r.type.padEnd(10)} ${label}`)
}
await browser.close()
