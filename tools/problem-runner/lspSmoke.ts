/** Verify real completion responses from every language server through private previews. */
import { BlaxelClient } from '../../supabase/functions/_shared/blaxelClient.ts'
import { z, type Json } from '../../supabase/functions/_shared/integrationRuntime.ts'

const image = Deno.args[0]
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!image || !key || !workspace) throw new Error('Supply runtime image and Blaxel workspace credentials')
const client = new BlaxelClient(key, workspace, image)
const rpcMessage = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.json().optional() })
const examples = [
  { language: 'cpp', filename: 'main.cpp', source: '#include <string>\nint main(){std::string message; message.}', prefix: 'message.' },
  { language: 'c', filename: 'main.c', source: 'int main(){int sample_value=1; samp}', prefix: 'samp' },
  { language: 'python', filename: 'main.py', source: 'import math\nmath.', prefix: 'math.' },
  { language: 'javascript', filename: 'main.js', source: 'const message = "hello";\nmessage.', prefix: 'message.' },
  { language: 'java', filename: 'Main.java', source: 'public class Main { public static void main(String[] args){String message="hello"; message. }}', prefix: 'message.' },
  { language: 'go', filename: 'main.go', source: 'package main\nimport "fmt"\nfunc main(){fmt.}', prefix: 'fmt.' },
] as const
for (const example of examples) {
  const name = 'manor-editor-' + crypto.randomUUID().replaceAll('-', '')
  let socket: WebSocket | null = null
  try {
    const sandbox = await client.createSandbox(name, 'editor')
    const session = await client.editorSession(sandbox, example.language, new Date(Date.now() + 600000).toISOString())
    socket = new WebSocket(session.webSocketUrl)
    const connection = socket
    await new Promise<void>((resolve, reject) => { connection.onopen = () => resolve(); connection.onerror = () => reject(new Error('Private editor WebSocket failed to connect')) })
    let sequence = 0
    const waiting = new Map<number, { resolve(value: Json): void; reject(error: Error): void; timer: number }>()
    connection.onclose = event => { for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error(`Language server closed (${event.code}): ${event.reason}`)) }; waiting.clear() }
    connection.onmessage = event => {
      const message = rpcMessage.parse(JSON.parse(String(event.data)))
      if (message.id !== undefined && !message.method) {
        const item = waiting.get(Number(message.id))
        if (!item) return
        waiting.delete(Number(message.id))
        clearTimeout(item.timer)
        if (message.error) item.reject(new Error(JSON.stringify(message.error)))
        else item.resolve(message.result ?? null)
      } else if (message.id !== undefined && message.method) {
        connection.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? z.object({ items: z.array(z.json()) }).parse(message.params).items.map(() => null) : null }))
      }
    }
    const request = (method: string, params: object): Promise<Json> => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { if (waiting.delete(id)) reject(new Error(`${example.language} ${method} timed out`)) }, 45000)
      waiting.set(id, { resolve, reject, timer })
      connection.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
    const notify = (method: string, params: object): void => connection.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
    await request('initialize', { processId: null, rootUri: 'file:///workspace', capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } }, workspace: { configuration: false } } })
    notify('initialized', {})
    const uri = 'file:///workspace/' + example.filename
    notify('textDocument/didOpen', { textDocument: { uri, languageId: example.language === 'cpp' ? 'cpp' : example.language, version: 1, text: example.source } })
    const end = example.source.lastIndexOf(example.prefix) + example.prefix.length
    const previous = example.source.slice(0, end).split('\n')
    const position = { line: previous.length - 1, character: previous.at(-1)!.length }
    await new Promise(resolve => setTimeout(resolve, example.language === 'java' ? 5000 : 1000))
    const result = await request('textDocument/completion', { textDocument: { uri }, position, context: { triggerKind: 1 } })
    const entries = Array.isArray(result) ? result : result && typeof result === 'object' && 'items' in result && Array.isArray(result.items) ? result.items : []
    if (entries.length === 0) throw new Error(`${example.language} returned no completion candidates: ${JSON.stringify(result)}`)
    console.log(JSON.stringify({ language: example.language, candidates: entries.length, passed: true }))
  } finally { socket?.close(); await client.deleteSandbox(name) }
}
