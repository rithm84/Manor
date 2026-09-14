/**
 * Measures the installed app on this Mac by reading the timing lines the
 * frontend writes to the shell log.
 *
 * Each run quits the app, launches it, waits for the boot milestones and the
 * first settled route, then opens each route through a deep link and waits for
 * its `route settled` line. The app must be installed and signed in; nothing
 * is written to the account, since every step is a navigation.
 *
 * Usage: node benchmark.mjs [--identity production|staging] [--runs N]
 *        [--routes habits,notes,jobs,bookmarks,settings,home]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const IDENTITIES = {
  production: { app: '/Applications/Manor.app', name: 'Manor', identifier: 'app.manor.desktop', scheme: 'manor' },
  staging: { app: join(homedir(), 'Applications', 'Manor Staging.app'), name: 'Manor Staging', identifier: 'app.manor.desktop.staging', scheme: 'manor-staging' }
}
const DEFAULT_ROUTES = ['habits', 'notes', 'jobs', 'bookmarks', 'settings', 'home']
const LAUNCH_TIMEOUT_MS = 20_000
const ROUTE_TIMEOUT_MS = 10_000
const POLL_MS = 100

/**
 * Parses the command line.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ identity: keyof typeof IDENTITIES, runs: number, routes: string[] }} The options.
 */
function parseCommandLine(argv) {
  const options = { identity: 'production', runs: 5, routes: DEFAULT_ROUTES }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    if (flag === '--identity' && value in IDENTITIES) options.identity = value
    else if (flag === '--runs' && /^[1-9]\d*$/.test(value)) options.runs = Number(value)
    else if (flag === '--routes') options.routes = value.split(',').map((route) => route.trim()).filter((route) => route !== '')
    else throw new Error(`Unknown or invalid option ${flag} ${value}`)
  }
  return options
}

/**
 * Parses one shell log line into its message and structured fields.
 *
 * @param {string} line A line such as `[date][time][webview][INFO] boot milestone=shell since_launch_ms=412`.
 * @returns {{ message: string, fields: Record<string, string> } | null} The parsed line, or null for a line without fields.
 */
function parseLine(line) {
  const match = /^\[[^\]]*\]\[[^\]]*\]\[[^\]]*\]\[[A-Z]+\] (.*)$/.exec(line)
  if (match === null) return null
  const text = match[1]
  const fields = {}
  const pattern = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g
  let first = text.length
  for (const pair of text.matchAll(pattern)) {
    if (pair.index < first) first = pair.index
    fields[pair[1]] = pair[2].startsWith('"') ? pair[2].slice(1, -1).replace(/\\"/g, '"') : pair[2]
  }
  return { message: text.slice(0, first).trim(), fields }
}

/**
 * Waits until the log grows a line that satisfies the predicate, returning it.
 *
 * @param {string} logPath Path of the shell log.
 * @param {number} from Byte offset to read from.
 * @param {(entry: { message: string, fields: Record<string, string> }) => boolean} accept Which line ends the wait.
 * @param {number} timeoutMs How long to wait before failing.
 * @returns {Promise<{ entry: { message: string, fields: Record<string, string> }, offset: number }>} The line and the offset after it.
 */
async function waitForLine(logPath, from, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let offset = from
  while (Date.now() < deadline) {
    const size = statSync(logPath).size
    if (size > offset) {
      const chunk = readFileSync(logPath, 'utf8').slice(offset)
      const lines = chunk.split('\n')
      const complete = chunk.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1)
      let consumed = offset
      for (const line of complete) {
        consumed += Buffer.byteLength(line, 'utf8') + 1
        const entry = parseLine(line)
        if (entry !== null && accept(entry)) return { entry, offset: consumed }
      }
      offset = consumed
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`The shell log at ${logPath} showed no matching line within ${timeoutMs} ms`)
}

/**
 * Quits the app if it is running and waits for the process to end.
 *
 * @param {typeof IDENTITIES.production} identity The app to quit.
 * @returns {void}
 */
function quit(identity) {
  execFileSync('osascript', ['-e', `if application id "${identity.identifier}" is running then quit application id "${identity.identifier}"`])
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      execFileSync('pgrep', ['-f', `${identity.app}/Contents/MacOS/`], { stdio: 'pipe' })
    } catch {
      return
    }
    execFileSync('sleep', ['0.2'])
  }
  throw new Error(`${identity.name} did not quit within 10 seconds`)
}

/**
 * Launches the app cold and records its boot milestones and first settled route.
 *
 * @param {typeof IDENTITIES.production} identity The app to launch.
 * @param {string} logPath Path of the shell log.
 * @returns {Promise<{ shell: number, session: number, account: number, cached: boolean, firstRoute: string, firstRouteMs: number, offset: number }>} The measurements.
 */
async function measureLaunch(identity, logPath) {
  quit(identity)
  const start = statSync(logPath).size
  execFileSync('open', [identity.app])
  const milestone = (name) => (entry) => entry.message === 'boot' && entry.fields.milestone === name
  const shell = await waitForLine(logPath, start, milestone('shell'), LAUNCH_TIMEOUT_MS)
  const session = await waitForLine(logPath, shell.offset, milestone('session'), LAUNCH_TIMEOUT_MS)
  if (session.entry.fields.signed_in !== 'true') throw new Error(`${identity.name} is not signed in; sign in once, then run the benchmark again`)
  const account = await waitForLine(logPath, session.offset, milestone('account'), LAUNCH_TIMEOUT_MS)
  const route = await waitForLine(logPath, account.offset, (entry) => entry.message === 'route settled', LAUNCH_TIMEOUT_MS)
  return {
    shell: Number(shell.entry.fields.since_launch_ms),
    session: Number(session.entry.fields.since_launch_ms),
    account: Number(account.entry.fields.since_launch_ms),
    cached: account.entry.fields.cached === 'true',
    firstRoute: route.entry.fields.path,
    firstRouteMs: Number(route.entry.fields.ms),
    offset: route.offset
  }
}

/**
 * Opens one route through a deep link and records how long it took to settle.
 *
 * @param {typeof IDENTITIES.production} identity The running app.
 * @param {string} logPath Path of the shell log.
 * @param {number} offset Byte offset in the log to read from.
 * @param {string} route The route name, such as `notes`.
 * @returns {Promise<{ ms: number, queries: number, offset: number }>} The measurement and the offset after its line.
 */
async function measureRoute(identity, logPath, offset, route) {
  execFileSync('open', [`${identity.scheme}://${route}`])
  const settled = await waitForLine(logPath, offset, (entry) => entry.message === 'route settled' && entry.fields.path === `/${route}`, ROUTE_TIMEOUT_MS)
  return { ms: Number(settled.entry.fields.ms), queries: Number(settled.entry.fields.queries), offset: settled.offset }
}

/**
 * Summarizes a series of measurements.
 *
 * @param {number[]} values The samples.
 * @returns {string} `median (min to max)` in milliseconds.
 */
function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
  return `${median} ms (${sorted[0]} to ${sorted[sorted.length - 1]})`
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2))
  const identity = IDENTITIES[options.identity]
  const logPath = join(homedir(), 'Library', 'Logs', identity.identifier, 'manor.log')
  statSync(identity.app)
  statSync(logPath)
  const launches = []
  const routes = Object.fromEntries(options.routes.map((route) => [route, []]))
  for (let run = 1; run <= options.runs; run += 1) {
    const launch = await measureLaunch(identity, logPath)
    launches.push(launch)
    let offset = launch.offset
    for (const route of options.routes) {
      const sample = await measureRoute(identity, logPath, offset, route)
      routes[route].push(sample)
      offset = sample.offset
    }
    process.stderr.write(`run ${run}/${options.runs}: shell ${launch.shell} ms, account ${launch.account} ms, ${launch.firstRoute} settled ${launch.firstRouteMs} ms after navigation\n`)
  }
  const cached = launches.filter((launch) => launch.cached).length
  console.log(`## ${identity.name}, ${options.runs} cold relaunches, ${cached} from the cached account\n`)
  console.log('| Launch milestone | Since the process started |\n|---|---|')
  console.log(`| Shell ready in the webview | ${summarize(launches.map((launch) => launch.shell))} |`)
  console.log(`| Session known | ${summarize(launches.map((launch) => launch.session))} |`)
  console.log(`| Account rendered | ${summarize(launches.map((launch) => launch.account))} |`)
  console.log(`| First route (${launches[0].firstRoute}) settled, from navigation | ${summarize(launches.map((launch) => launch.firstRouteMs))} |`)
  console.log('\n| Route by deep link | Settled | Concurrent queries |\n|---|---|---|')
  for (const [route, samples] of Object.entries(routes)) {
    console.log(`| /${route} | ${summarize(samples.map((sample) => sample.ms))} | ${Math.max(...samples.map((sample) => sample.queries))} |`)
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause))
  process.exit(1)
})
