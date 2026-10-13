/**
 * Runs one SQL text against a hosted Supabase project and returns its result rows.
 * By default it uses the logged-in Supabase CLI (`db query --linked`), which opens a direct Postgres
 * connection. Environments that allow only outbound HTTPS set `MANOR_SQL_TRANSPORT=https`; the query is then
 * sent to the Management API's database query endpoint with `SUPABASE_ACCESS_TOKEN`. Usage as a command:
 *   node sql.mjs --project-ref <ref> --file <file.sql>
 * prints `{"rows": [...]}`, the same shape as the CLI's JSON output.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/node_modules/.bin/supabase')

export class SqlError extends Error {
  constructor(message, reason) { super(message); this.reason = reason }
}

export async function runSql(projectRef, file, { timeout = 180000, maxBuffer = 4000000 } = {}) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new TypeError(`Invalid project ref ${projectRef}`)
  if (process.env.MANOR_SQL_TRANSPORT === 'https') {
    const token = process.env.SUPABASE_ACCESS_TOKEN
    if (!token) throw new Error('MANOR_SQL_TRANSPORT=https requires SUPABASE_ACCESS_TOKEN')
    const query = await readFile(file, 'utf8')
    let response
    // The Management API throttles bursts with HTTP 429 before running anything, so a throttled request is retried.
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(timeout),
        })
      } catch (error) { throw new SqlError(`SQL request failed: ${error.message}`, error.message) }
      if (response.status !== 429 || attempt === 6) break
      const wait = Number(response.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt
      await response.body?.cancel()
      await new Promise(resolveWait => setTimeout(resolveWait, wait))
    }
    const text = await response.text()
    if (!response.ok) throw new SqlError(`SQL request returned status ${response.status}`, `status ${response.status}: ${text.slice(0, 4000)}`)
    if (text.length > maxBuffer) throw new SqlError(`SQL result of ${text.length} bytes exceeds ${maxBuffer}`, 'result too large')
    return JSON.parse(text)
  }
  const environment = { ...process.env }; delete environment.SUPABASE_ACCESS_TOKEN
  let output
  try { output = await execute(cli, ['db', 'query', '--project-ref', projectRef, '--linked', '--output', 'json', '--file', file], { cwd: tmpdir(), env: environment, timeout, maxBuffer }) }
  catch (error) {
    const reason = typeof error.stderr === 'string' ? error.stderr.trim().slice(0, 4000) : error.message
    throw new SqlError(`Supabase CLI query exited with ${error.code ?? 'unavailable'}`, reason)
  }
  return JSON.parse(output.stdout).rows
}

/**
 * Runs one SQL text with `runSql`, retrying a transient `SqlError` after 2, 4, 8, ... seconds with a structured warning.
 * A reason matching `permanent`, or a failure on the last of `attempts`, raises with the project, attempt, and reason.
 */
export async function runSqlTextWithRetries(projectRef, sql, { attempts, permanent, event, timeout, maxBuffer }) {
  const directory = await mkdtemp(join(tmpdir(), 'manor-sql-'))
  try {
    const file = join(directory, 'query.sql')
    await writeFile(file, sql, { mode: 0o600 })
    for (let attempt = 1; ; attempt += 1) {
      try { return await runSql(projectRef, file, { timeout, maxBuffer }) }
      catch (error) {
        if (!(error instanceof SqlError)) throw error
        if (attempt === attempts || permanent.test(error.reason)) throw new Error(`SQL in project ${projectRef} failed after attempt ${attempt} (${error.message}): ${error.reason}`, { cause: error })
        console.warn(JSON.stringify({ event, attempt, reason: error.reason }))
        await new Promise(resolveWait => setTimeout(resolveWait, 2000 * 2 ** (attempt - 1)))
      }
    }
  } finally { await rm(directory, { recursive: true, force: false }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
  const file = option('--file')
  if (!file) throw new TypeError('Usage: node sql.mjs --project-ref <ref> --file <file.sql>')
  try { process.stdout.write(`${JSON.stringify({ rows: await runSql(option('--project-ref'), resolve(file), { timeout: 300000, maxBuffer: 128000000 }) })}\n`) }
  catch (error) { process.stderr.write(`${error.message}: ${error.reason ?? ''}\n`); process.exit(1) }
}
