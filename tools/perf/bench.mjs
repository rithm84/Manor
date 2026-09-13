// Manor performance benchmark. Measures cold and warm page loads, network payload, main-thread work, heap, and idle
// polling for a signed-in account, and writes a JSON report. Usage: node bench.mjs <session.json> <origin> <label> [runs]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const [sessionPath, origin, label, runsArg] = process.argv.slice(2)
if (!sessionPath || !origin || !label) throw new Error('usage: node bench.mjs <session.json> <origin> <label> [runs]')
const runs = Number(runsArg ?? 3)
const ref = new URL(origin).hostname.includes('staging') ? 'cysdooljdslgvqrahymm' : 'pxdxqueevzttpmxjsqes'
const { session } = JSON.parse(await readFile(sessionPath, 'utf8'))
const pages = [['home', '/home'], ['habits', '/habits'], ['notes', '/notes?note=nt-window'], ['jobs', '/jobs'], ['leetcode', '/leetcode'], ['mood', '/mood-focus'], ['bookmarks', '/bookmarks']]

const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const kb = (bytes) => Math.round(bytes / 102.4) / 10

async function newSignedInPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('manor.theme', 'dark'); localStorage.setItem('manor.sidebar.docked', '1') }, [`sb-${ref}-auth-token`, JSON.stringify(session)])
  return { context, page }
}

function trackNetwork(page) {
  const entries = []
  page.on('response', async (response) => {
    const url = response.url(); const type = response.request().resourceType()
    let bytes = 0
    try { const sizes = await response.request().sizes(); bytes = sizes.responseBodySize + sizes.responseHeadersSize } catch {}
    entries.push({ url, type, bytes, status: response.status(), api: url.includes('supabase.co'), at: Date.now() })
  })
  return entries
}

function summarizeNetwork(entries) {
  const sum = (predicate) => entries.filter(predicate).reduce((total, e) => total + e.bytes, 0)
  const api = entries.filter(e => e.api)
  return {
    requests: entries.length, transferKB: kb(sum(() => true)),
    jsKB: kb(sum(e => e.type === 'script')), cssKB: kb(sum(e => e.type === 'stylesheet')), fontKB: kb(sum(e => e.type === 'font')),
    apiRequests: api.length, apiKB: kb(sum(e => e.api)),
    apiCalls: api.map(e => e.url.replace(/^.*supabase\.co\//, '').replace(/\?.*$/, '').slice(0, 60)),
    jsChunks: entries.filter(e => e.type === 'script').map(e => e.url.split('/').pop()),
  }
}

async function measureLoad(page, path) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const entries = trackNetwork(page)
  const startedAt = Date.now()
  await page.goto(origin + path, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle')
  const settledMs = Date.now() - startedAt
  const lastResponseMs = entries.length ? Math.max(...entries.map(e => e.at)) - startedAt : null
  await page.waitForTimeout(500)
  const timing = await page.evaluate(() => new Promise((resolve) => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]))
    const longTasks = performance.getEntriesByType('longtask')
    let lcp = null
    try {
      const observer = new PerformanceObserver((list) => { const last = list.getEntries().at(-1); if (last) lcp = Math.round(last.startTime) })
      observer.observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => { observer.disconnect(); resolve({ nav, paints, lcp, longTasks: longTasks.length, longTaskMs: Math.round(longTasks.reduce((t, e) => t + e.duration, 0)) }) }, 200)
    } catch { resolve({ nav, paints, lcp, longTasks: longTasks.length, longTaskMs: 0 }) }
  }))
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  await cdp.detach()
  return {
    ttfbMs: Math.round(timing.nav.responseStart), domContentLoadedMs: Math.round(timing.nav.domContentLoadedEventEnd), loadMs: Math.round(timing.nav.loadEventEnd),
    fcpMs: timing.paints['first-contentful-paint'] ?? null, lcpMs: timing.lcp, settledMs, lastResponseMs,
    longTasks: timing.longTasks, longTaskMs: timing.longTaskMs,
    scriptMs: Math.round(metrics.ScriptDuration * 1000), layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000),
    heapMB: Math.round(metrics.JSHeapUsedSize / 1048576 * 10) / 10, domNodes: metrics.Nodes, listeners: metrics.JSEventListeners,
    network: summarizeNetwork(entries),
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { label, origin, at: new Date().toISOString(), runs, pages: {}, coverage: null, navigationLoop: null, idle: null }

// 1. Cold loads (fresh context each run) and one warm reload per page.
for (const [name, path] of pages) {
  const cold = []
  let warm = null
  for (let i = 0; i < runs; i += 1) {
    const { context, page } = await newSignedInPage(browser)
    page.on('pageerror', (error) => console.error('page error', name, error.message))
    await page.evaluate(() => { try { new PerformanceObserver(() => {}).observe({ type: 'longtask', buffered: true }) } catch {} })
    cold.push(await measureLoad(page, path))
    if (i === runs - 1) {
      // Warm means the service worker controls the page, which is the state of every visit after the first.
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 }).catch(() => console.warn('service worker never took control'))
      warm = await measureLoad(page, path)
    }
    await context.close()
  }
  const summary = {}
  for (const key of Object.keys(cold[0])) if (typeof cold[0][key] === 'number') summary[key] = median(cold.map(r => r[key]))
  report.pages[name] = { cold: summary, coldNetwork: cold[0].network, warm: Object.fromEntries(Object.entries(warm).filter(([k, v]) => typeof v === 'number')), warmNetwork: warm.network }
  console.log(name, JSON.stringify(summary))
}

// 2. JS coverage on a cold Home load: how much shipped JS ran.
{
  const { context, page } = await newSignedInPage(browser)
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  await page.goto(origin + '/home', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const coverage = await page.coverage.stopJSCoverage()
  let total = 0, used = 0
  const perFile = []
  for (const entry of coverage) {
    const size = entry.source?.length ?? 0; let fileUsed = 0
    for (const fn of entry.functions) for (const range of fn.ranges) if (range.count > 0) fileUsed += range.endOffset - range.startOffset
    total += size; used += Math.min(fileUsed, size)
    perFile.push({ file: entry.url.split('/').pop(), kb: kb(size), usedPct: size ? Math.round(Math.min(fileUsed, size) / size * 100) : 0 })
  }
  report.coverage = { totalKB: kb(total), usedKB: kb(used), usedPct: total ? Math.round(used / total * 100) : 0, files: perFile.sort((a, b) => b.kb - a.kb).slice(0, 10) }
  console.log('coverage', JSON.stringify({ totalKB: report.coverage.totalKB, usedPct: report.coverage.usedPct }))
  await context.close()
}

// 3. Navigation loop: heap after 3 laps through every page, with GC forced, to expose retention.
{
  const { context, page } = await newSignedInPage(browser)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable')
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])); return { heapMB: Math.round(m.JSHeapUsedSize / 1048576 * 10) / 10, domNodes: m.Nodes, listeners: m.JSEventListeners } }
  await page.goto(origin + '/home', { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  const first = await heap()
  const laps = []
  for (let lap = 0; lap < 3; lap += 1) {
    for (const [, path] of pages) { await page.goto(origin + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(400) }
    await page.goto(origin + '/home', { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    laps.push(await heap())
  }
  report.navigationLoop = { first, laps }
  console.log('navigation loop', JSON.stringify(report.navigationLoop))
  await context.close()
}

// 4. Idle: requests issued while sitting on Home for 65 seconds after settling.
{
  const { context, page } = await newSignedInPage(browser)
  await page.goto(origin + '/home', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const entries = trackNetwork(page)
  await page.waitForTimeout(65_000)
  report.idle = { seconds: 65, requests: entries.length, apiRequests: entries.filter(e => e.api).length, urls: [...new Set(entries.map(e => e.url.replace(/^.*supabase\.co\//, '').replace(/\?.*$/, '').replace(/^.*\/\/[^/]+\//, '/').slice(0, 70)))] }
  console.log('idle', JSON.stringify(report.idle))
  await context.close()
}

await browser.close()
await mkdir('/Users/rithvik/Projects/Manor/docs/perf', { recursive: true })
const out = `/Users/rithvik/Projects/Manor/docs/perf/${label}.json`
await writeFile(out, JSON.stringify(report, null, 2) + '\n')
console.log('wrote', out)
