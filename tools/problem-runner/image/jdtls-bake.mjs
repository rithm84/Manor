/**
 * Image build step: starts jdtls once on a warm-up program in /workspace and exits it cleanly, leaving an initialized
 * configuration, a workspace with the JDK already indexed, and a class-data archive of its startup classes. lsp.mjs
 * copies the first two into /workspace and starts jdtls with the archive and the same JVM options.
 */
import { spawn } from 'node:child_process'
import { cp, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jdtlsJvmOptions, jdtlsLauncher } from './jdtls-options.mjs'

const text = 'import java.util.*;\npublic class Main { public static void main(String[] args) { List<Integer> values = new ArrayList<>(); values. } }\n'
await cp('/opt/jdtls/config_linux', '/opt/manor/jdtls-config', { recursive: true })
await writeFile('/workspace/Main.java', text)
const child = spawn('java', [...jdtlsJvmOptions, '-XX:ArchiveClassesAtExit=/opt/manor/jdtls.jsa', ...jdtlsLauncher, '-configuration', '/opt/manor/jdtls-config', '-data', '/opt/manor/jdtls-data'], { stdio: ['pipe', 'pipe', 'inherit'] })
const exited = new Promise((resolve, reject) => child.on('exit', code => code === 0 ? resolve() : reject(new Error(`jdtls exited ${code}`))))
let buffer = Buffer.alloc(0)
const waiting = new Map()
let nextId = 1
child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (let boundary; (boundary = buffer.indexOf('\r\n\r\n')) >= 0;) {
    const size = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, boundary).toString())[1])
    if (buffer.length < boundary + 4 + size) return
    const message = JSON.parse(buffer.subarray(boundary + 4, boundary + 4 + size).toString())
    buffer = buffer.subarray(boundary + 4 + size)
    if (message.id !== undefined && message.method === undefined) { waiting.get(message.id)?.(message); waiting.delete(message.id) }
    else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? message.params.items.map(() => null) : null })
  }
})
function send(message) { const body = JSON.stringify(message); child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`) }
function request(method, params) { const id = nextId++; return new Promise(resolve => { waiting.set(id, resolve); send({ jsonrpc: '2.0', id, method, params }) }) }

await request('initialize', { processId: null, rootUri: 'file:///workspace', workspaceFolders: [{ uri: 'file:///workspace', name: 'Problem' }], capabilities: {} })
send({ jsonrpc: '2.0', method: 'initialized', params: {} })
send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///workspace/Main.java', languageId: 'java', version: 1, text } } })
const position = { line: 1, character: text.split('\n')[1].indexOf('values.') + 7 }
for (const deadline = Date.now() + 240000; ;) {
  const response = await request('textDocument/completion', { textDocument: { uri: 'file:///workspace/Main.java' }, position })
  if ((Array.isArray(response.result) ? response.result : response.result?.items ?? []).length > 0) break
  if (Date.now() > deadline) throw new Error('jdtls returned no completions while baking')
  await new Promise(resolve => setTimeout(resolve, 500))
}
// Completing a JDK type name searches the JDK index, so it succeeds only once jdtls has built it.
const typed = 'import java.util.*;\npublic class Main { public static void main(String[] args) { ArrayDe } }\n'
send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: 'file:///workspace/Main.java', version: 2 }, contentChanges: [{ text: typed }] } })
for (const deadline = Date.now() + 240000; ;) {
  const types = await request('textDocument/completion', { textDocument: { uri: 'file:///workspace/Main.java' }, position: { line: 1, character: typed.split('\n')[1].indexOf('ArrayDe') + 7 } })
  if ((Array.isArray(types.result) ? types.result : types.result?.items ?? []).some(item => item.label.startsWith('ArrayDeque'))) break
  if (Date.now() > deadline) throw new Error('jdtls did not index the JDK while baking')
  await new Promise(resolve => setTimeout(resolve, 500))
}
// jdtls finishes indexing the JDK in the background after it answers, so the workspace is kept until it stops growing.
async function size(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const entry of await readdir(path)) total += await size(join(path, entry))
  return total
}
for (let previous = -1, steady = 0, deadline = Date.now() + 240000; steady < 5; ) {
  await new Promise(resolve => setTimeout(resolve, 2000))
  const current = await size('/opt/manor/jdtls-data')
  steady = current === previous && current > 10000000 ? steady + 1 : 0
  previous = current
  if (Date.now() > deadline) throw new Error(`jdtls workspace did not settle while baking; it holds ${current} bytes`)
}
send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///workspace/Main.java' } } })
await request('shutdown', null)
send({ jsonrpc: '2.0', method: 'exit' })
await exited
