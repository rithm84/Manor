/**
 * Authenticated editor-only JSON-RPC bridge. Judge jobs never use this process.
 *
 * One bridge serves every language at `/lsp/<language>` on one port. Each language server is started once, initialized
 * and warmed by the bridge, and keeps running across WebSocket connections, so switching languages or reconnecting
 * attaches to a warm server. The language named on the command line starts first; the other prestarted languages
 * follow one at a time so they do not compete with it for the sandbox's CPU.
 *
 * A reconnecting client's `initialize` is answered from the server's first result, its request IDs are remapped so a
 * late response from an earlier connection never reaches it, and capability registrations are replayed to it. When a
 * connection closes, its document is closed on the server and the bridge answers the server's requests itself.
 */
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { access, chmod, cp, mkdir, writeFile } from 'node:fs/promises'
import { WebSocketServer } from '/opt/languages/node_modules/ws/wrapper.mjs'
import { jdtlsJvmOptions, jdtlsLauncher } from './jdtls-options.mjs'

const port = 3000
const filenames = { cpp: 'main.cpp', c: 'main.c', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go' }
const prestarted = ['python', 'javascript', 'cpp', 'java', 'go']
const first = process.argv[2]
if (!filenames[first]) throw new Error(`Unsupported editor language: ${first}`)
const commands = {
  cpp: ['clangd', '--background-index=false', '--clang-tidy=false'],
  c: ['clangd', '--background-index=false', '--clang-tidy=false'],
  python: ['node', '/opt/languages/node_modules/pyright/dist/pyright-langserver.js', '--stdio'],
  javascript: ['node', '/opt/languages/node_modules/typescript-language-server/lib/cli.mjs', '--stdio'],
  java: ['java', ...jdtlsJvmOptions, '-XX:SharedArchiveFile=/opt/manor/jdtls.jsa', ...jdtlsLauncher, '-configuration', '/workspace/.jdtls-config', '-data', '/workspace/.jdtls-data'],
  go: ['gopls', 'serve'],
}
/** Short programs each server completes once at start, so its standard library is loaded before the editor asks. */
const warmups = {
  cpp: { text: '#include <bits/stdc++.h>\nusing namespace std;\nint main() { vector<int> values; values. }\n', prefix: 'values.' },
  c: { text: '#include <stdio.h>\nint main(void) { int total = 0; tot }\n', prefix: 'tot' },
  python: { text: 'import collections\ncollections.', prefix: 'collections.' },
  javascript: { text: 'const values = [1, 2];\nvalues.', prefix: 'values.' },
  java: { text: 'import java.util.*;\npublic class Main { public static void main(String[] args) { List<Integer> values = new ArrayList<>(); values. } }\n', prefix: 'values.' },
  go: { text: 'package main\n\nimport "strings"\n\nfunc main() { strings. }\n', prefix: 'strings.' },
}
const permitted = new Set(['initialize', 'initialized', 'shutdown', 'exit', '$/cancelRequest', 'textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave', 'textDocument/completion', 'completionItem/resolve', 'textDocument/hover', 'textDocument/signatureHelp', 'textDocument/definition', 'textDocument/documentSymbol', 'textDocument/formatting', 'textDocument/references', 'textDocument/semanticTokens/full', 'textDocument/semanticTokens/range', 'workspace/didChangeConfiguration', 'workspace/didChangeWatchedFiles', 'workspace/symbol', 'workspace/diagnostic', 'workspaceSymbol/resolve', '$/setTrace', 'window/workDoneProgress/cancel', 'codeAction/resolve', 'codeLens/resolve', 'inlayHint/resolve', 'documentLink/resolve'])
/**
 * What the bridge declares when it initializes a server; reconnecting editors receive that first result. It omits
 * `workspace.workspaceFolders`, with which Pyright 1.1.405 never asks for its settings and answers no completions;
 * the one workspace folder is passed in `initialize` instead.
 */
const clientCapabilities = {
  workspace: { applyEdit: true, configuration: true, didChangeConfiguration: { dynamicRegistration: true }, didChangeWatchedFiles: { dynamicRegistration: true }, symbol: { dynamicRegistration: true }, executeCommand: { dynamicRegistration: true }, semanticTokens: { refreshSupport: true }, diagnostics: { refreshSupport: true } },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true, willSave: false, willSaveWaitUntil: false },
    completion: { dynamicRegistration: true, contextSupport: true, completionItem: { snippetSupport: true, commitCharactersSupport: true, documentationFormat: ['markdown', 'plaintext'], deprecatedSupport: true, preselectSupport: true, insertReplaceSupport: true, labelDetailsSupport: true, resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }, insertTextModeSupport: { valueSet: [1, 2] }, tagSupport: { valueSet: [1] } }, completionItemKind: { valueSet: Array.from({ length: 25 }, (_, index) => index + 1) } },
    hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { dynamicRegistration: true, contextSupport: true, signatureInformation: { documentationFormat: ['markdown', 'plaintext'], activeParameterSupport: true, parameterInformation: { labelOffsetSupport: true } } },
    definition: { dynamicRegistration: true, linkSupport: true }, references: { dynamicRegistration: true }, documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true }, formatting: { dynamicRegistration: true },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: true, codeDescriptionSupport: true, dataSupport: true },
    semanticTokens: { dynamicRegistration: true, requests: { range: true, full: { delta: false } }, tokenTypes: [], tokenModifiers: [], formats: ['relative'], overlappingTokenSupport: false, multilineTokenSupport: false },
  },
  window: { workDoneProgress: true, showMessage: { messageActionItem: { additionalPropertiesSupport: true } } },
  general: { positionEncodings: ['utf-16'], markdown: { parser: 'marked', version: '1.1.0' } },
}
const jail = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv', '--setenv', 'PATH', '/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'GOCACHE', '/tmp/go-cache', '--setenv', 'GOPATH', '/tmp/go', '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--ro-bind', '/opt', '/opt', '--ro-bind', '/etc', '/etc', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/workspace', '/workspace', '--chdir', '/workspace', '--uid', '10001', '--gid', '10001', '--']

await mkdir('/workspace', { recursive: true })
await chmod('/workspace', 0o777)
await writeFile('/workspace/go.mod', 'module manor.local/problem\n\ngo 1.24\n', { mode: 0o666 })
// Pyright reads its signature layout only from a project config; compact keeps short signatures on one hover line.
await writeFile('/workspace/pyrightconfig.json', JSON.stringify({ functionSignatureDisplay: 'compact' }), { mode: 0o644 })
async function prepareJava() {
  // The image carries a jdtls configuration and workspace already initialized for /workspace; jdtls writes to both.
  for (const [from, to] of [['/opt/manor/jdtls-config', '/workspace/.jdtls-config'], ['/opt/manor/jdtls-data', '/workspace/.jdtls-data']]) {
    try { await access(to); continue } catch (error) { if (error.code !== 'ENOENT') throw error }
    await cp(from, to, { recursive: true })
    execFileSync('chown', ['-R', '10001:10001', to])
  }
}

function log(event, fields) { console.info(JSON.stringify({ event, ...fields })) }

class LanguageServer {
  constructor(language) {
    this.language = language
    this.uri = `file:///workspace/${filenames[language]}`
    this.socket = null
    this.queue = Promise.resolve()
    /** Bridge request ID to its origin: an editor connection and the ID it used, or the bridge's own request. */
    this.pending = new Map()
    this.nextId = 1
    this.registrations = new Map()
    /** Server requests forwarded to the attached editor and not yet answered, by server request ID. */
    this.forwarded = new Map()
    this.documentOwner = null
    this.diagnostics = ''
    this.exited = false
    this.initialized = this.start()
    this.ready = this.initialized.then(() => this.warm()).then(() => log('language-server-warm', { language: this.language, ms: Date.now() - this.startedAt }))
  }

  /** Starts and initializes the server; resolves once editors can use it. */
  async start() {
    if (this.language === 'java') await prepareJava()
    this.startedAt = Date.now()
    this.child = spawn('bwrap', [...jail, ...commands[this.language]], { uid: 10001, gid: 10001, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } })
    let buffer = Buffer.alloc(0)
    this.child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 4194304) { this.fail('Language server output exceeded its limit'); return }
      while (true) {
        const boundary = buffer.indexOf('\r\n\r\n')
        if (boundary < 0) return
        const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, boundary).toString())
        if (!match) { this.fail('Invalid language server framing'); return }
        const size = Number(match[1])
        if (buffer.length < boundary + 4 + size) return
        const data = buffer.subarray(boundary + 4, boundary + 4 + size).toString()
        buffer = buffer.subarray(boundary + 4 + size)
        this.fromServer(JSON.parse(data))
      }
    })
    this.child.stderr.on('data', chunk => { this.diagnostics = (this.diagnostics + chunk.toString()).slice(-4096) })
    this.child.on('error', error => this.fail(error.message))
    this.child.on('exit', code => this.fail(`Language server exited ${code}: ${this.diagnostics.slice(-80)}`))
    // Automatic type acquisition runs npm, which has no network in the jail and only costs memory.
    const initializeOptions = this.language === 'javascript' ? { preferences: {}, disableAutomaticTypingAcquisition: true, tsserver: { path: '/opt/languages/node_modules/typescript/lib/tsserver.js' } } : {}
    this.initializeResult = await this.request('initialize', { processId: null, clientInfo: { name: 'Manor' }, rootUri: 'file:///workspace', rootPath: '/workspace', workspaceFolders: [{ uri: 'file:///workspace', name: 'Problem' }], capabilities: clientCapabilities, initializationOptions: initializeOptions })
    this.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    log('language-server-initialized', { language: this.language, ms: Date.now() - this.startedAt })
  }

  /** Completes the warm-up program once, unless an editor opened the document first. */
  async warm() {
    const program = warmups[this.language]
    const before = program.text.slice(0, program.text.lastIndexOf(program.prefix) + program.prefix.length).split('\n')
    const position = { line: before.length - 1, character: before.at(-1).length }
    if (this.documentOwner !== null) return
    this.documentOwner = 'bridge'
    // jdtls builds its project from the file on disk, so the warm-up program is written first, as an editor's is.
    writeFileSync(`/workspace/${filenames[this.language]}`, program.text, { mode: 0o666 })
    this.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: this.uri, languageId: this.language, version: 1, text: program.text } } })
    const deadline = Date.now() + 60000
    while (this.documentOwner === 'bridge' && Date.now() < deadline) {
      const result = await this.request('textDocument/completion', { textDocument: { uri: this.uri }, position }).catch(() => null)
      const items = Array.isArray(result) ? result : result?.items ?? []
      if (items.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (this.documentOwner === 'bridge') { this.send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: this.uri } } }); this.documentOwner = null }
  }

  send(message) {
    if (this.exited) return
    const text = JSON.stringify(message)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  fail(reason) {
    if (this.exited) return
    this.exited = true
    this.child.kill('SIGKILL')
    for (const entry of this.pending.values()) if (entry.reject) entry.reject(new Error(reason))
    this.pending.clear()
    if (this.socket !== null && this.socket.readyState === 1) this.socket.close(1011, reason.slice(0, 120))
    servers.delete(this.language)
    log('language-server-stopped', { language: this.language, reason })
  }

  fromServer(message) {
    if (message.id !== undefined && message.method === undefined) {
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (entry.resolve) { if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result ?? null); return }
      if (entry.socket === this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify({ ...message, id: entry.id }))
      return
    }
    if (message.method === 'client/registerCapability') for (const item of message.params?.registrations ?? []) this.registrations.set(item.id, item)
    if (message.method === 'client/unregisterCapability') for (const item of message.params?.unregisterations ?? []) this.registrations.delete(item.id)
    if (this.socket !== null && this.socket.readyState === 1) {
      if (message.id !== undefined) this.forwarded.set(message.id, message)
      this.socket.send(JSON.stringify(message))
      return
    }
    if (message.id !== undefined) this.answerForEditor(message)
  }

  /** Without an editor attached, the bridge answers a server request as the editor would: no settings, one workspace folder. */
  answerForEditor(message) {
    const result = message.method === 'workspace/configuration' ? (message.params?.items ?? []).map(() => null) : message.method === 'workspace/workspaceFolders' ? [{ uri: 'file:///workspace', name: 'Problem' }] : null
    this.send({ jsonrpc: '2.0', id: message.id, result })
  }

  attach(socket) {
    if (this.socket !== null && this.socket.readyState === 1) this.socket.close(1000, 'Replaced by a newer editor connection')
    this.socket = socket
    socket.on('message', raw => { this.queue = this.queue.then(() => this.fromEditor(socket, raw)) })
    socket.on('close', () => { this.queue = this.queue.then(() => this.detach(socket)) })
  }

  detach(socket) {
    if (this.socket !== socket) return
    this.socket = null
    for (const message of this.forwarded.values()) this.answerForEditor(message)
    this.forwarded.clear()
    if (this.documentOwner === socket) { this.send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: this.uri } } }); this.documentOwner = null }
  }

  /** Handles one editor message; messages run in arrival order, so a document is written before later requests reach the server. */
  async fromEditor(socket, raw) {
    if (this.socket !== socket) return
    try {
      const message = JSON.parse(raw.toString())
      if (message.method && !permitted.has(message.method) && !message.method.startsWith('textDocument/')) throw new Error('This language server method is unavailable')
      if (message.params?.textDocument?.uri && message.params.textDocument.uri !== this.uri) throw new Error('The document does not belong to this session')
      if (message.method === undefined) {
        // Answers to the bridge's replayed registrations are the bridge's; others answer the server's requests.
        if (typeof message.id === 'string' && message.id.startsWith('manor-')) return
        this.forwarded.delete(message.id)
        this.send(message)
        return
      }
      if (message.method === 'initialize') {
        await this.initialized
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: this.initializeResult }))
        return
      }
      if (message.method === 'initialized') {
        if (this.registrations.size > 0) socket.send(JSON.stringify({ jsonrpc: '2.0', id: `manor-${this.nextId++}`, method: 'client/registerCapability', params: { registrations: [...this.registrations.values()] } }))
        return
      }
      if (message.method === 'shutdown') { socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: null })); return }
      if (message.method === 'exit') return
      await this.initialized
      if (message.method === 'textDocument/didOpen') {
        await writeFile(`/workspace/${filenames[this.language]}`, message.params.textDocument.text, { mode: 0o666 })
        if (this.documentOwner !== null) this.send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: this.uri } } })
        this.documentOwner = socket
      }
      if (message.method === 'textDocument/didClose') this.documentOwner = null
      if (message.method === '$/cancelRequest') {
        const target = [...this.pending].find(([, entry]) => entry.socket === socket && entry.id === message.params?.id)
        if (target !== undefined) this.send({ ...message, params: { id: target[0] } })
        return
      }
      if (message.id !== undefined) {
        const id = this.nextId++
        this.pending.set(id, { socket, id: message.id })
        this.send({ ...message, id })
        return
      }
      this.send(message)
    } catch (error) {
      socket.close(1008, error instanceof Error ? error.message.slice(0, 120) : 'Invalid JSON-RPC request')
    }
  }
}

const servers = new Map()
function server(language) {
  if (!servers.has(language)) {
    const created = new LanguageServer(language)
    servers.set(language, created)
    created.ready.catch(error => { log('language-server-failed', { language, error: error.message }); created.fail(error.message) })
  }
  return servers.get(language)
}

const http = createServer((_, response) => { response.writeHead(404).end() })
const sockets = new WebSocketServer({ noServer: true, maxPayload: 1048576 })
http.on('upgrade', (request, stream, head) => {
  const language = /^\/lsp\/([a-z]+)$/.exec(new URL(request.url, 'http://bridge').pathname)?.[1]
  if (language === undefined || !filenames[language]) { stream.end('HTTP/1.1 404 Not Found\r\n\r\n'); return }
  sockets.handleUpgrade(request, stream, head, socket => server(language).attach(socket))
})
http.listen(port, '0.0.0.0')

server(first).ready.catch(() => {}).finally(async () => {
  for (const language of prestarted) {
    if (language === first) continue
    await server(language).ready.catch(() => {})
  }
  log('language-servers-ready', { languages: [...servers.keys()] })
})
