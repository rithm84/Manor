import { z, required } from './integrationRuntime.ts'

/** Every Manor sandbox runs in Ashburn, Virginia, the Blaxel region closest to the Supabase projects in AWS us-east-2. */
const region = 'us-was-1'
/** A standing sandbox is deleted after this long without a standby or resume; it is recreated on demand. */
const warmIdle = '1h'
/** A standing sandbox that would expire sooner than this is replaced before a job, so expiry never interrupts one. */
const warmExpiryMarginSeconds = 180
const sandboxSchema = z.object({ metadata: z.object({ name: z.string(), url: z.url() }), status: z.string(), expiresIn: z.number().optional() })
export type BlaxelSandbox = z.infer<typeof sandboxSchema>
export const processSchema = z.object({ name: z.string(), status: z.enum(['running', 'completed', 'failed', 'killed', 'stopped']), exitCode: z.number(), stdout: z.string(), stderr: z.string() })
const processOutputSchema = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int(), durationMs: z.number().nonnegative(), timedOut: z.boolean(), outputLimit: z.boolean() })
/** `tainted` lists what a job left behind in its sandbox; a tainted sandbox must not run another job. */
export const judgeOutputSchema = z.object({ compile: processOutputSchema.nullable(), cases: z.array(z.object({ id: z.string(), process: processOutputSchema })), tainted: z.array(z.string()) })
export type JudgeOutput = z.infer<typeof judgeOutputSchema>
export interface JudgeInput { readonly language: string; readonly code: string; readonly cases: readonly { readonly id: string; readonly input: string }[] }
/** Judge sandboxes run submitted code; checker sandboxes run trusted special judges over expected answers and never receive submitted code. */
export type WarmPurpose = 'judge' | 'checker'
export type EditorLanguage = 'cpp' | 'c' | 'python' | 'javascript' | 'java' | 'go'

export class BlaxelRequestError extends Error {
  readonly status: number
  constructor(operation: string, status: number, detail: string) { super(`Blaxel ${operation} returned HTTP ${status}: ${detail}`); this.name = 'BlaxelRequestError'; this.status = status }
}

/** The standing sandbox could not accept a job before the job started, so a replacement can take it. */
export class SandboxUnavailableError extends Error {
  constructor(sandboxName: string, cause: unknown) { super(`Sandbox ${sandboxName} could not accept a job: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); this.name = 'SandboxUnavailableError' }
}

/** The sandbox API path of a job's root-only directory. */
function jobPath(job: string): string { return '/filesystem/' + encodeURIComponent(`/var/lib/manor/jobs/${job}`) }

/**
 * Standing sandboxes are named per account, purpose, and image, without exposing the account ID in provider URLs. A new
 * image therefore starts new sandboxes instead of replacing running ones, and the previous ones expire after idle.
 */
async function warmSandboxName(purpose: WarmPurpose, owner: string, image: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${purpose}:${owner}:${image}`)))
  return `manor-${purpose}-` + [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Workspace credentials only leave this class as API headers, never as sandbox environment values. */
export class BlaxelClient {
  private readonly key: string
  private readonly workspace: string
  private readonly image: string
  constructor(key: string, workspace: string, image: string) { this.key = key; this.workspace = workspace; this.image = image }
  static configured(): BlaxelClient { return new BlaxelClient(required('BLAXEL_API_KEY'), required('BLAXEL_WORKSPACE'), required('BLAXEL_PROBLEM_IMAGE')) }

  private request(url: string, method: string, body: string | null, operation: string): Promise<Response> { return this.requestWithin(url, method, body, operation, 20000) }

  private async requestWithin(url: string, method: string, body: string | null, operation: string, timeoutMs: number): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.key}`, 'X-Blaxel-Authorization': `Bearer ${this.key}`, 'X-Blaxel-Workspace': this.workspace, 'Content-Type': 'application/json', Accept: 'application/json' }, body, signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        if (attempt === 2 || !['GET', 'DELETE'].includes(method)) throw error
        console.warn('Retrying Blaxel transport', { operation, attempt: attempt + 1 })
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt)); continue
      }
      if (response.ok || method === 'DELETE' && response.status === 404) return response
      const detail = (await response.text()).slice(0, 2000)
      const error = new BlaxelRequestError(operation, response.status, detail)
      if (attempt === 2 || !['GET', 'DELETE'].includes(method) || response.status !== 429 && response.status < 500) throw error
      console.warn('Retrying Blaxel request', { operation, status: response.status, attempt: attempt + 1 })
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
    throw new Error(`Blaxel ${operation} exhausted its retries`)
  }

  /**
   * The account's standing sandbox for one purpose, created on demand. Between jobs it stands by; it is replaced when it
   * is about to expire or failed, and Blaxel deletes it after idle.
   */
  async warmSandbox(purpose: WarmPurpose, owner: string): Promise<BlaxelSandbox> {
    const name = await warmSandboxName(purpose, owner, this.image)
    const current = await this.readSandbox(name)
    if (current !== null && current.status === 'DEPLOYED' && (current.expiresIn === undefined || current.expiresIn > warmExpiryMarginSeconds)) return current
    if (current !== null && ['DEPLOYED', 'FAILED'].includes(current.status)) await this.deleteSandbox(name)
    const spec = { region, lifecycle: { expirationPolicies: [{ type: 'ttl-idle', value: warmIdle, action: 'delete' }] }, runtime: { image: this.image, memory: 2048, ports: [], envs: [{ name: 'SANDBOX_DISABLE_PROCESS_LOGGING', value: 'true' }] } }
    let sandbox = sandboxSchema.parse(await (await this.request('https://api.blaxel.ai/v0/sandboxes?createIfNotExist=true', 'POST', JSON.stringify({ apiVersion: 'blaxel.ai/v1alpha1', kind: 'Sandbox', metadata: { name }, spec }), `create ${purpose} sandbox`)).json())
    const deadline = Date.now() + 45000
    while (sandbox.status !== 'DEPLOYED') {
      if (sandbox.status === 'FAILED' || sandbox.status === 'TERMINATED' || Date.now() > deadline) throw new Error(`Blaxel ${purpose} sandbox ${name} did not deploy: ${sandbox.status}`)
      await new Promise(resolve => setTimeout(resolve, 250))
      sandbox = sandboxSchema.parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${name}`, 'GET', null, `read ${purpose} sandbox`)).json())
    }
    return sandbox
  }

  private async readSandbox(name: string): Promise<BlaxelSandbox | null> {
    try { return sandboxSchema.parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${name}`, 'GET', null, 'read sandbox')).json()) }
    catch (error) {
      if (error instanceof BlaxelRequestError && error.status === 404) return null
      throw error
    }
  }

  async deleteSandbox(name: string): Promise<void> { await this.request(`https://api.blaxel.ai/v0/sandboxes/${encodeURIComponent(name)}`, 'DELETE', null, 'delete sandbox') }

  private sandboxUrl(sandbox: BlaxelSandbox, path: string): string {
    const url = new URL(sandbox.metadata.url)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.bl.run')) throw new Error('Blaxel returned an invalid sandbox URL')
    return new URL(path, url).toString()
  }

  /**
   * Runs one job in a standing sandbox. The request goes into a root-only job directory that the runner empties as it
   * reads it; the runner reports through a result file there, and the directory is removed before this returns, so
   * neither hidden inputs nor their outputs stay in the sandbox after the job.
   */
  async judge(sandbox: BlaxelSandbox, input: JudgeInput): Promise<JudgeOutput> {
    const body = JSON.stringify(input)
    if (new TextEncoder().encode(body).length > 4900000) throw new Error('Execution batch exceeds the sandbox transport limit')
    const job = crypto.randomUUID().replaceAll('-', '')
    const directory = jobPath(job)
    try { await this.request(this.sandboxUrl(sandbox, `${directory}%2Frequest.json`), 'PUT', JSON.stringify({ content: body, permissions: '0600' }), 'write judge input') }
    catch (error) { throw new SandboxUnavailableError(sandbox.metadata.name, error) }
    let output: JudgeOutput
    try { output = await this.runJudge(sandbox, job) }
    catch (error) {
      try { await this.removeJob(sandbox, directory) }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], `${error instanceof Error ? error.message : String(error)}; removing the job directory also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`) }
      throw error
    }
    await this.removeJob(sandbox, directory)
    return output
  }

  /** The process API holds the request until the runner exits; keepAlive kills a runner that outlives 110 seconds. */
  private async runJudge(sandbox: BlaxelSandbox, job: string): Promise<JudgeOutput> {
    const name = 'judge-' + job
    const deadline = Date.now() + 115000
    let result = processSchema.parse(await (await this.requestWithin(this.sandboxUrl(sandbox, '/process'), 'POST', JSON.stringify({ command: `python3 /opt/manor/runner.py /var/lib/manor/jobs/${job}`, name, workingDir: '/', keepAlive: true, timeout: 110, waitForCompletion: true }), 'run judge', 120000)).json())
    while (result.status === 'running') {
      if (Date.now() > deadline) throw new Error('Judge process exceeded the server deadline and its sandbox will be deleted')
      await new Promise(resolve => setTimeout(resolve, 250))
      result = processSchema.parse(await (await this.request(this.sandboxUrl(sandbox, `/process/${encodeURIComponent(name)}`), 'GET', null, 'read judge process')).json())
    }
    if (result.exitCode !== 0) throw new Error(`Judge supervisor exited ${result.exitCode}: ${result.stderr.slice(0, 2000)}`)
    const file = z.object({ content: z.string(), size: z.number().int().max(2100000) }).parse(await (await this.request(this.sandboxUrl(sandbox, `${jobPath(job)}%2Fresult.json`), 'GET', null, 'read judge result')).json())
    return judgeOutputSchema.parse(JSON.parse(file.content))
  }

  private async removeJob(sandbox: BlaxelSandbox, directory: string): Promise<void> { await this.request(this.sandboxUrl(sandbox, `${directory}?recursive=true`), 'DELETE', null, 'remove judge job') }

  /**
   * The account's editor sandbox, created once and reused across problems and languages. Without a connection it
   * stands by with its processes intact; the server's lease deletes it after idle, and Blaxel's idle policy deletes
   * it a day after its last standby or resume if that cleanup never runs. A sandbox running another image than the
   * server's configured one is replaced, so its language servers match the editor code that talks to them.
   */
  async ensureEditorSandbox(name: string): Promise<BlaxelSandbox> {
    if (!/^manor-editor-[a-f0-9]{32}$/.test(name)) throw new Error('Invalid server-owned editor sandbox name')
    const spec = { region, lifecycle: { expirationPolicies: [{ type: 'ttl-idle', value: '24h', action: 'delete' }] }, runtime: { image: this.image, memory: 2048, ports: [{ name: 'language-server', target: 3000, protocol: 'TCP' }], envs: [{ name: 'SANDBOX_DISABLE_PROCESS_LOGGING', value: 'true' }] } }
    const create = async (): Promise<unknown> => (await this.request('https://api.blaxel.ai/v0/sandboxes?createIfNotExist=true', 'POST', JSON.stringify({ apiVersion: 'blaxel.ai/v1alpha1', kind: 'Sandbox', metadata: { name }, spec }), 'ensure editor sandbox')).json()
    let created = await create()
    if (z.object({ spec: z.object({ runtime: z.object({ image: z.string() }) }) }).parse(created).spec.runtime.image !== this.image) {
      await this.deleteSandbox(name)
      created = await create()
    }
    let sandbox = sandboxSchema.parse(created)
    const deadline = Date.now() + 45000
    while (sandbox.status !== 'DEPLOYED') {
      if (sandbox.status === 'FAILED' || sandbox.status === 'TERMINATED' || Date.now() > deadline) throw new Error(`Blaxel editor sandbox ${name} did not deploy: ${sandbox.status}`)
      await new Promise(resolve => setTimeout(resolve, 250))
      sandbox = sandboxSchema.parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${name}`, 'GET', null, 'read editor sandbox')).json())
    }
    return sandbox
  }

  /**
   * One bridge process serves every language's server on the preview port and keeps them running across connections.
   * When none is running, it starts with the requested language first and starts the other languages after it.
   */
  async ensureLanguageServers(sandbox: BlaxelSandbox, first: EditorLanguage): Promise<void> {
    const running = async (): Promise<boolean> => z.array(z.object({ name: z.string(), status: processSchema.shape.status })).parse(await (await this.request(this.sandboxUrl(sandbox, '/process'), 'GET', null, 'list editor processes')).json())
      .some(item => item.status === 'running' && item.name.startsWith('language-servers-'))
    if (await running()) return
    try { await this.request(this.sandboxUrl(sandbox, '/process'), 'POST', JSON.stringify({ command: `node /opt/manor/lsp.mjs ${first}`, name: 'language-servers-' + crypto.randomUUID().slice(0, 8), workingDir: '/workspace', waitForPorts: [3000], timeout: 0 }), 'start language servers') }
    catch (error) {
      // A concurrent request may have started the bridge first, which leaves this one without the port.
      if (await running()) return
      throw error
    }
  }

  /** A short-lived token for the sandbox's private language-server preview, which lives as long as the sandbox, and each language's address on it. */
  async editorConnection(sandboxName: string, expiresAt: string): Promise<{ webSocketUrls: Record<EditorLanguage, string>; token: string }> {
    const previews = `https://api.blaxel.ai/v0/sandboxes/${encodeURIComponent(sandboxName)}/previews`
    const previewSchema = z.object({ spec: z.object({ url: z.url() }) })
    let preview: z.infer<typeof previewSchema>
    try { preview = previewSchema.parse(await (await this.request(`${previews}/editor`, 'GET', null, 'read editor preview')).json()) }
    catch (error) {
      if (!(error instanceof BlaxelRequestError) || error.status !== 404) throw error
      preview = previewSchema.parse(await (await this.request(previews, 'POST', JSON.stringify({ metadata: { name: 'editor' }, spec: { port: 3000, public: false } }), 'create editor preview')).json())
    }
    const token = z.object({ spec: z.object({ token: z.string().min(1) }) }).parse(await (await this.request(`${previews}/editor/tokens`, 'POST', JSON.stringify({ metadata: { name: 'editor-' + crypto.randomUUID().slice(0, 8) }, spec: { expiresAt } }), 'create editor token')).json()).spec.token
    const address = (language: EditorLanguage): string => { const url = new URL(`/lsp/${language}`, preview.spec.url); url.protocol = 'wss:'; url.searchParams.set('bl_preview_token', token); return url.toString() }
    return { webSocketUrls: { cpp: address('cpp'), c: address('c'), python: address('python'), javascript: address('javascript'), java: address('java'), go: address('go') }, token }
  }
}
