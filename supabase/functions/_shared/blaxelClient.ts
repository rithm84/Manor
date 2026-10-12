import { z, required } from './integrationRuntime.ts'

const sandboxSchema = z.object({ metadata: z.object({ name: z.string(), url: z.url() }), status: z.string() })
export type BlaxelSandbox = z.infer<typeof sandboxSchema>
export const processSchema = z.object({ name: z.string(), status: z.enum(['running', 'completed', 'failed', 'killed', 'stopped']), exitCode: z.number(), stdout: z.string(), stderr: z.string() })
export type BlaxelProcess = z.infer<typeof processSchema>
const processOutputSchema = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int(), durationMs: z.number().nonnegative(), timedOut: z.boolean(), outputLimit: z.boolean() })
export const judgeOutputSchema = z.object({ compile: processOutputSchema.nullable(), cases: z.array(z.object({ id: z.string(), process: processOutputSchema })) })
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export class BlaxelRequestError extends Error {
  readonly status: number
  constructor(operation: string, status: number, detail: string) { super(`Blaxel ${operation} returned HTTP ${status}: ${detail}`); this.name = 'BlaxelRequestError'; this.status = status }
}

/** Workspace credentials only leave this class as API headers, never as sandbox environment values. */
export class BlaxelClient {
  private readonly key: string
  private readonly workspace: string
  private readonly image: string
  constructor(key: string, workspace: string, image: string) { this.key = key; this.workspace = workspace; this.image = image }
  static configured(): BlaxelClient { return new BlaxelClient(required('BLAXEL_API_KEY'), required('BLAXEL_WORKSPACE'), required('BLAXEL_PROBLEM_IMAGE')) }

  private async request(url: string, method: string, body: string | null, operation: string): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { method, headers: { Authorization: `Bearer ${this.key}`, 'X-Blaxel-Authorization': `Bearer ${this.key}`, 'X-Blaxel-Workspace': this.workspace, 'Content-Type': 'application/json', Accept: 'application/json' }, body, signal: AbortSignal.timeout(20000) })
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

  async createSandbox(name: string, purpose: 'judge' | 'editor'): Promise<BlaxelSandbox> {
    if (!/^manor-(judge|editor)-[a-f0-9]{32}$/.test(name)) throw new Error('Invalid server-owned sandbox name')
    const spec = { region: 'us-was-1', runtime: { image: this.image, memory: 2048, ttl: purpose === 'judge' ? '5m' : '45m', ports: purpose === 'editor' ? [{ name: 'language-server', target: 3000, protocol: 'TCP' }] : [], envs: [{ name: 'SANDBOX_DISABLE_PROCESS_LOGGING', value: 'true' }] } }
    let sandbox = sandboxSchema.parse(await (await this.request('https://api.blaxel.ai/v0/sandboxes?createIfNotExist=true', 'POST', JSON.stringify({ apiVersion: 'blaxel.ai/v1alpha1', kind: 'Sandbox', metadata: { name }, spec }), 'create sandbox')).json())
    const deadline = Date.now() + 45000
    while (sandbox.status !== 'DEPLOYED') {
      if (sandbox.status === 'FAILED' || sandbox.status === 'TERMINATED' || Date.now() > deadline) throw new Error(`Blaxel sandbox ${name} did not deploy: ${sandbox.status}`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      sandbox = sandboxSchema.parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${name}`, 'GET', null, 'read sandbox')).json())
    }
    return sandbox
  }

  async deleteSandbox(name: string): Promise<void> { await this.request(`https://api.blaxel.ai/v0/sandboxes/${encodeURIComponent(name)}`, 'DELETE', null, 'delete sandbox') }

  private sandboxUrl(sandbox: BlaxelSandbox, path: string): string {
    const url = new URL(sandbox.metadata.url)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.bl.run')) throw new Error('Blaxel returned an invalid sandbox URL')
    return new URL(path, url).toString()
  }

  async startProcess(sandbox: BlaxelSandbox, command: string, name: string, stdin: boolean, timeout: number): Promise<BlaxelProcess> {
    return processSchema.parse(await (await this.request(this.sandboxUrl(sandbox, '/process'), 'POST', JSON.stringify({ command, name, stdin, workingDir: '/workspace', keepAlive: true, timeout, waitForCompletion: false }), 'start process')).json())
  }

  async judge(sandbox: BlaxelSandbox, input: { language: string; code: string; cases: readonly { id: string; input: string }[] }): Promise<JudgeOutput> {
    const process = await this.startProcess(sandbox, 'python3 /opt/manor/runner.py', 'judge', true, 110)
    const body = JSON.stringify(input)
    if (new TextEncoder().encode(body).length > 4900000) throw new Error('Execution batch exceeds the sandbox transport limit')
    await this.request(this.sandboxUrl(sandbox, `/process/${encodeURIComponent(process.name)}/stdin`), 'POST', body, 'write judge input')
    await this.request(this.sandboxUrl(sandbox, `/process/${encodeURIComponent(process.name)}/stdin`), 'DELETE', null, 'close judge input')
    const deadline = Date.now() + 115000
    let result = process
    while (result.status === 'running') {
      if (Date.now() > deadline) throw new Error('Judge process exceeded the server deadline and its sandbox will be deleted')
      await new Promise(resolve => setTimeout(resolve, 750))
      result = processSchema.parse(await (await this.request(this.sandboxUrl(sandbox, `/process/${encodeURIComponent(process.name)}`), 'GET', null, 'read judge process')).json())
    }
    if (result.exitCode !== 0) throw new Error(`Judge supervisor exited ${result.exitCode}: ${result.stderr.slice(0, 2000)}`)
    const file = z.object({ content: z.string(), size: z.number().int().max(2100000) }).parse(await (await this.request(this.sandboxUrl(sandbox, '/filesystem/%2Ftmp/manor-judge-result.json'), 'GET', null, 'read judge result')).json())
    return judgeOutputSchema.parse(JSON.parse(file.content))
  }

  async editorSession(sandbox: BlaxelSandbox, language: string, expiresAt: string): Promise<{ webSocketUrl: string; token: string }> {
    if (!['cpp', 'c', 'python', 'javascript', 'java', 'go'].includes(language)) throw new Error('Invalid editor language')
    await this.startProcess(sandbox, `node /opt/manor/lsp.mjs ${language}`, 'language-server', false, 2400)
    const preview = z.object({ spec: z.object({ url: z.url() }) }).parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${sandbox.metadata.name}/previews`, 'POST', JSON.stringify({ metadata: { name: 'editor' }, spec: { port: 3000, public: false, expires: expiresAt } }), 'create editor preview')).json())
    const token = z.object({ spec: z.object({ token: z.string().min(1) }) }).parse(await (await this.request(`https://api.blaxel.ai/v0/sandboxes/${sandbox.metadata.name}/previews/editor/tokens`, 'POST', JSON.stringify({ metadata: { name: 'editor-session' }, spec: { expiresAt } }), 'create editor token')).json()).spec.token
    const url = new URL('/lsp', preview.spec.url); url.protocol = 'wss:'; url.searchParams.set('bl_preview_token', token)
    return { webSocketUrl: url.toString(), token }
  }
}
