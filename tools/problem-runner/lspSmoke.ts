/**
 * Verify real completion responses from every language server through private previews, all in one account-style
 * editor sandbox whose bridge keeps a server running per language. Each language opens problem A with a completion
 * sent right behind the document, then switches the same document to problem B. Python hovers must show short
 * signatures on one line. Reconnecting must reattach to the running server instead of starting another; once every
 * server is warm, a language switch is timed for each language, and peak memory with every server running is reported
 * against the sandbox's memory. The run also checks that a connection kept alive by small notifications stays open
 * past Blaxel's idle limit, and that a sandbox resumed from standby serves completions again without restarting its
 * servers. Timings are printed as JSON lines.
 */
import { BlaxelClient, type BlaxelSandbox, type EditorLanguage } from '../../supabase/functions/_shared/blaxelClient.ts'
import { z, type Json } from '../../supabase/functions/_shared/integrationRuntime.ts'

const image = Deno.args[0]
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!image || !key || !workspace) throw new Error('Supply runtime image and Blaxel workspace credentials')
const client = new BlaxelClient(key, workspace, image)
const rpcMessage = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.json().optional() })
interface Problem { readonly source: string; readonly prefix: string }
const examples: readonly { language: EditorLanguage; filename: string; a: Problem; b: Problem }[] = [
  { language: 'cpp', filename: 'main.cpp', a: { source: '#include <string>\nint main(){std::string message; message.}', prefix: 'message.' }, b: { source: '#include <vector>\nint main(){std::vector<int> values; values.}', prefix: 'values.' } },
  { language: 'c', filename: 'main.c', a: { source: 'int main(){int sample_value=1; samp}', prefix: 'samp' }, b: { source: 'int main(){int other_total=2; other_}', prefix: 'other_' } },
  { language: 'python', filename: 'main.py', a: { source: 'import math\nmath.', prefix: 'math.' }, b: { source: 'import collections\ncollections.', prefix: 'collections.' } },
  { language: 'javascript', filename: 'main.js', a: { source: 'const message = "hello";\nmessage.', prefix: 'message.' }, b: { source: 'const values = [1, 2];\nvalues.', prefix: 'values.' } },
  { language: 'java', filename: 'Main.java', a: { source: 'public class Main { public static void main(String[] args){String message="hello"; message. }}', prefix: 'message.' }, b: { source: 'import java.util.*;\npublic class Main { public static void main(String[] args){List<Integer> values=new ArrayList<>(); values. }}', prefix: 'values.' } },
  { language: 'go', filename: 'main.go', a: { source: 'package main\nimport "fmt"\nfunc main(){fmt.}', prefix: 'fmt.' }, b: { source: 'package main\nimport "strings"\nfunc main(){strings.}', prefix: 'strings.' } },
]
const prestarted: readonly EditorLanguage[] = ['python', 'javascript', 'cpp', 'java', 'go']
/** A command-line fragment that identifies each language's server process. */
const servers: Readonly<Record<EditorLanguage, string>> = { cpp: 'clangd', c: 'clangd', python: 'pyright-langserver', javascript: 'typescript-language-server', java: 'org.eclipse.equinox.launcher', go: 'gopls serve' }

async function processApi(sandbox: BlaxelSandbox, body: object): Promise<Json> {
  const response = await fetch(new URL('/process', sandbox.metadata.url), { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Blaxel-Authorization': `Bearer ${key}`, 'X-Blaxel-Workspace': workspace!, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Process ${JSON.stringify(body)} returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`)
  return z.json().parse(await response.json())
}
/** Runs a root command in the sandbox, outside the jails, and returns its standard output. */
async function inspect(sandbox: BlaxelSandbox, command: string): Promise<string> {
  return z.object({ stdout: z.string() }).parse(await processApi(sandbox, { command, workingDir: '/', waitForCompletion: true, timeout: 50 })).stdout
}
/** The bracketed first letter keeps pgrep from matching the inspection's own command line. */
const serverPids = async (sandbox: BlaxelSandbox, language: EditorLanguage): Promise<string> => (await inspect(sandbox, `pgrep -f '[${servers[language][0]}]${servers[language].slice(1)}' || true`)).trim()

/** A JSON-RPC client over the private preview WebSocket, answering server requests the way the editor does. */
class LanguageConnection {
  private sequence = 0
  private readonly waiting = new Map<number, { resolve(value: Json): void; reject(error: Error): void; timer: number }>()
  private constructor(private readonly socket: WebSocket, private readonly language: string) {
    socket.onclose = event => { for (const item of this.waiting.values()) { clearTimeout(item.timer); item.reject(new Error(`Language server closed (${event.code}): ${event.reason}`)) }; this.waiting.clear() }
    socket.onmessage = event => {
      const message = rpcMessage.parse(JSON.parse(String(event.data)))
      if (message.id !== undefined && !message.method) {
        const item = this.waiting.get(Number(message.id))
        if (!item) return
        this.waiting.delete(Number(message.id))
        clearTimeout(item.timer)
        if (message.error) item.reject(new Error(JSON.stringify(message.error)))
        else item.resolve(message.result ?? null)
      } else if (message.id !== undefined && message.method) {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? z.object({ items: z.array(z.json()) }).parse(message.params).items.map(() => null) : null }))
      }
    }
  }

  static async open(webSocketUrl: string, language: string): Promise<LanguageConnection> {
    const socket = new WebSocket(webSocketUrl)
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error(`${language} private editor WebSocket failed to connect`)) })
    const connection = new LanguageConnection(socket, language)
    await connection.request('initialize', { processId: null, rootUri: 'file:///workspace', capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } }, workspace: { configuration: true } } })
    connection.notify('initialized', {})
    return connection
  }

  request(method: string, params: object): Promise<Json> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${this.language} ${method} timed out`)) }, 45000)
      this.waiting.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params: object): void { this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params })) }

  /**
   * Requests completion at the end of the problem's prefix until the server returns candidates. Errors are not
   * retried: a completion that reaches a server before its document fails, so an error means the bridge reordered
   * them. A server that is still starting may answer empty, which is retried until the deadline.
   */
  async complete(uri: string, problem: Problem): Promise<number> {
    const end = problem.source.lastIndexOf(problem.prefix) + problem.prefix.length
    const previous = problem.source.slice(0, end).split('\n')
    const position = { line: previous.length - 1, character: previous.at(-1)!.length }
    const deadline = Date.now() + 60000
    while (true) {
      const result = await this.request('textDocument/completion', { textDocument: { uri }, position, context: { triggerKind: 1 } })
      const entries = Array.isArray(result) ? result : result && typeof result === 'object' && 'items' in result && Array.isArray(result.items) ? result.items : []
      if (entries.length > 0) return entries.length
      if (Date.now() > deadline) throw new Error(`${this.language} returned no completion candidates: ${JSON.stringify(result)}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /** Opens the problem and requests completion immediately behind the document, as the editor does after a switch. */
  open(filename: string, language: EditorLanguage, problem: Problem): Promise<number> {
    const uri = 'file:///workspace/' + filename
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text: problem.source } })
    return this.complete(uri, problem)
  }

  close(): void { this.socket.close() }
}

async function connect(sandbox: BlaxelSandbox, language: EditorLanguage): Promise<LanguageConnection> {
  const [connection] = await Promise.all([client.editorConnection(sandbox.metadata.name, new Date(Date.now() + 600000).toISOString()), client.ensureLanguageServers(sandbox, language)])
  return LanguageConnection.open(connection.webSocketUrls[language], language)
}

const name = 'manor-editor-' + crypto.randomUUID().replaceAll('-', '')
const started = performance.now()
const elapsed = (from: number): number => Math.round(performance.now() - from)
try {
  let sandbox = await client.ensureEditorSandbox(name)
  console.log(JSON.stringify({ step: 'sandbox', ms: elapsed(started) }))
  await processApi(sandbox, { name: 'memory-sampler', command: "sh -c 'while true; do free -m | awk \"NR==2{print \\$3}\" >> /tmp/manor-memory.log; sleep 0.5; done'", workingDir: '/', timeout: 0 })
  for (const [index, example] of examples.entries()) {
    const opening = performance.now()
    const connection = await connect(sandbox, example.language)
    const uri = 'file:///workspace/' + example.filename
    const first = await connection.open(example.filename, example.language, example.a)
    console.log(JSON.stringify({ language: example.language, problem: 'A', candidates: first, firstCompletionMs: elapsed(index === 0 ? started : opening), from: index === 0 ? 'cold sandbox' : 'language switch' }))
    const switching = performance.now()
    connection.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: example.b.source }] })
    const second = await connection.complete(uri, example.b)
    console.log(JSON.stringify({ language: example.language, problem: 'B', candidates: second, firstCompletionMs: elapsed(switching), from: 'problem switch' }))
    if (example.language === 'python') {
      const source = 'from typing import List\nclass Solution:\n    def updateMatrix(self, mat: List[List[int]]) -> List[List[int]]:\n        return mat\n'
      connection.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: source }] })
      const hoverSchema = z.object({ contents: z.object({ value: z.string() }) })
      let hover = hoverSchema.safeParse(null)
      for (const deadline = Date.now() + 30000; !hover.success && Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 250))) hover = hoverSchema.safeParse(await connection.request('textDocument/hover', { textDocument: { uri }, position: { line: 2, character: 10 } }))
      if (!hover.success) throw new Error('Python returned no hover for the method definition')
      const signature = hover.data.contents.value.split('```').find(part => part.includes('updateMatrix'))?.replace(/^python\n/, '').trim() ?? ''
      if (!signature.startsWith('(method) def updateMatrix(self') || signature.includes('\n')) throw new Error(`Python hover is not a one-line signature: ${JSON.stringify(hover.data.contents.value)}`)
      console.log(JSON.stringify({ language: example.language, hover: signature }))
    }
    connection.close()
  }

  // A reconnect reattaches to the running server: the same process answers the new connection.
  const python = examples.find(example => example.language === 'python')!
  const before = await serverPids(sandbox, 'python')
  const reconnecting = performance.now()
  const again = await connect(sandbox, 'python')
  const reattached = await again.open(python.filename, 'python', python.a)
  again.close()
  const after = await serverPids(sandbox, 'python')
  if (before === '' || before !== after) throw new Error(`Reconnecting restarted the Python server: ${before} became ${after}`)
  console.log(JSON.stringify({ language: 'python', candidates: reattached, firstCompletionMs: elapsed(reconnecting), from: 'reconnect to the running server' }))

  // Once every server is warm, the app switches languages with the session it holds: the first visit opens a
  // connection to the running server, and a return visit reopens the document on the connection it kept open.
  const session = await client.editorConnection(sandbox.metadata.name, new Date(Date.now() + 600000).toISOString())
  const kept = new Map<EditorLanguage, LanguageConnection>()
  for (const language of prestarted) {
    const example = examples.find(item => item.language === language)!
    const switching = performance.now()
    const connection = await LanguageConnection.open(session.webSocketUrls[language], language)
    const candidates = await connection.open(example.filename, language, example.a)
    connection.notify('textDocument/didClose', { textDocument: { uri: 'file:///workspace/' + example.filename } })
    kept.set(language, connection)
    console.log(JSON.stringify({ language, candidates, firstCompletionMs: elapsed(switching), from: 'warm language switch, new connection' }))
  }
  for (const language of prestarted) {
    const example = examples.find(item => item.language === language)!
    const connection = kept.get(language)!
    const switching = performance.now()
    const candidates = await connection.open(example.filename, language, example.b)
    connection.notify('textDocument/didClose', { textDocument: { uri: 'file:///workspace/' + example.filename } })
    console.log(JSON.stringify({ language, candidates, firstCompletionMs: elapsed(switching), from: 'warm language switch, open connection' }))
  }
  for (const connection of kept.values()) connection.close()
  const [peakMb, totalMb] = (await inspect(sandbox, "sh -c 'echo $(sort -n /tmp/manor-memory.log | tail -1) $(free -m | awk \"NR==2{print \\$2}\")'")).trim().split(' ').map(Number)
  console.log(JSON.stringify({ step: 'peak memory with every server running', peakMb, totalMb, share: Math.round(peakMb / totalMb * 100) / 100 }))

  const last = examples.at(-1)!
  const uri = 'file:///workspace/' + last.filename
  const idle = await connect(sandbox, last.language)
  await idle.open(last.filename, last.language, last.a)
  // Blaxel closes a preview WebSocket after about a minute without traffic; the editor's keep-alive holds it open.
  for (let beat = 0; beat < 4; beat++) { await new Promise(resolve => setTimeout(resolve, 25000)); idle.notify('$/setTrace', { value: 'off' }) }
  const afterIdle = performance.now()
  await idle.complete(uri, last.a)
  console.log(JSON.stringify({ language: last.language, idleSeconds: 100, completionMs: elapsed(afterIdle), from: 'kept-alive connection' }))
  idle.close()
  await inspect(sandbox, 'pkill -f manor-memory.log || true')
  const standing = await serverPids(sandbox, last.language)
  await new Promise(resolve => setTimeout(resolve, 90000))
  const resuming = performance.now()
  sandbox = await client.ensureEditorSandbox(name)
  const resumed = await connect(sandbox, last.language)
  const candidates = await resumed.open(last.filename, last.language, last.b)
  resumed.close()
  if (await serverPids(sandbox, last.language) !== standing) throw new Error('The language server restarted across standby')
  console.log(JSON.stringify({ language: last.language, candidates, firstCompletionMs: elapsed(resuming), from: 'resumed sandbox' }))
} finally { await client.deleteSandbox(name) }
