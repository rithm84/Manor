/** Authenticated editor-only JSON-RPC bridge. Judge jobs never use this process. */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { chmod, cp, mkdir, writeFile } from 'node:fs/promises'
import { WebSocketServer } from '/opt/languages/node_modules/ws/wrapper.mjs'

const language = process.argv[2]
const filename = { cpp: 'main.cpp', c: 'main.c', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go' }[language]
if (!filename) throw new Error('Unsupported editor language')
const commands = {
  cpp: ['clangd', '--background-index=false', '--clang-tidy=false'],
  c: ['clangd', '--background-index=false', '--clang-tidy=false'],
  python: ['node', '/opt/languages/node_modules/pyright/dist/pyright-langserver.js', '--stdio'],
  javascript: ['node', '/opt/languages/node_modules/typescript-language-server/lib/cli.mjs', '--stdio'],
  java: ['java', '-Xmx512m', '-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4', '-Declipse.product=org.eclipse.jdt.ls.core.product', '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED', '-jar', '/opt/jdtls/launcher.jar', '-configuration', '/workspace/.jdtls-config', '-data', '/tmp/jdtls'],
  go: ['gopls', 'serve'],
}
const permitted = new Set(['initialize', 'initialized', 'shutdown', 'exit', '$/cancelRequest', 'textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave', 'textDocument/completion', 'completionItem/resolve', 'textDocument/hover', 'textDocument/signatureHelp', 'textDocument/definition', 'textDocument/documentSymbol', 'textDocument/formatting', 'textDocument/references', 'textDocument/semanticTokens/full', 'textDocument/semanticTokens/range', 'workspace/didChangeConfiguration', 'workspace/didChangeWatchedFiles', 'workspace/symbol', 'workspace/diagnostic', 'workspaceSymbol/resolve', '$/setTrace', 'window/workDoneProgress/cancel', 'codeAction/resolve', 'codeLens/resolve', 'inlayHint/resolve', 'documentLink/resolve'])
await mkdir('/workspace', { recursive: true })
await chmod('/workspace', 0o777)
if (language === 'java') { await cp('/opt/jdtls/config_linux', '/workspace/.jdtls-config', { recursive: true }); await chmod('/workspace/.jdtls-config', 0o777) }
if (language === 'go') await writeFile('/workspace/go.mod', 'module manor.local/problem\n\ngo 1.24\n', { mode: 0o666 })
const server = createServer((_, response) => { response.writeHead(404).end() })
const sockets = new WebSocketServer({ server, maxPayload: 1048576, path: '/lsp' })
let active = false
sockets.on('connection', socket => {
  if (active) { socket.close(1013, 'One editor connection is allowed per session'); return }
  active = true
  const jail = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv', '--setenv', 'PATH', '/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'GOCACHE', '/tmp/go-cache', '--setenv', 'GOPATH', '/tmp/go', '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--ro-bind', '/opt', '/opt', '--ro-bind', '/etc', '/etc', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', '/workspace', '/workspace', '--chdir', '/workspace', '--uid', '10001', '--gid', '10001', '--', ...commands[language]]
  const child = spawn('bwrap', jail, { uid: 10001, gid: 10001, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } })
  let buffer = Buffer.alloc(0)
  let diagnostics = ''
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 4194304) { child.kill('SIGKILL'); socket.close(1011, 'Language server output exceeded its limit'); return }
    while (true) {
      const boundary = buffer.indexOf('\r\n\r\n')
      if (boundary < 0) return
      const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, boundary).toString())
      if (!match) { child.kill('SIGKILL'); socket.close(1011, 'Invalid language server framing'); return }
      const size = Number(match[1])
      if (buffer.length < boundary + 4 + size) return
      const data = buffer.subarray(boundary + 4, boundary + 4 + size).toString()
      buffer = buffer.subarray(boundary + 4 + size)
      if (socket.readyState === 1) socket.send(data)
    }
  })
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4096) })
  child.on('error', error => socket.close(1011, error.message.slice(0, 120)))
  child.on('exit', code => { if (socket.readyState === 1) socket.close(code === 0 ? 1000 : 1011, code === 0 ? 'Language server closed' : `Language server exited ${code}: ${diagnostics.slice(-80)}`) })
  socket.on('message', async raw => {
    try {
      const message = JSON.parse(raw.toString())
      if (message.method && !permitted.has(message.method) && !message.method.startsWith('textDocument/')) throw new Error('This language server method is unavailable')
      if (['initialize', 'textDocument/didOpen', 'textDocument/didChange', 'textDocument/completion'].includes(message.method)) console.info(JSON.stringify({ event: 'language-request', language, method: message.method, documentUri: message.params?.textDocument?.uri, version: message.params?.textDocument?.version, requestId: message.id }))
      if (message.params?.textDocument?.uri && message.params.textDocument.uri !== `file:///workspace/${filename}`) throw new Error('The document does not belong to this session')
      if (message.method === 'initialize') {
        message.params.rootUri = 'file:///workspace'
        message.params.rootPath = '/workspace'
        message.params.workspaceFolders = [{ uri: 'file:///workspace', name: 'Problem' }]
        message.params.initializationOptions = language === 'javascript' ? { preferences: {}, tsserver: { path: '/opt/languages/node_modules/typescript/lib/tsserver.js' } } : {}
      }
      if (message.method === 'textDocument/didOpen') await writeFile(`/workspace/${filename}`, message.params.textDocument.text, { mode: 0o666 })
      const text = JSON.stringify(message)
      child.stdin.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
    } catch (error) {
      socket.close(1008, error instanceof Error ? error.message.slice(0, 120) : 'Invalid JSON-RPC request')
    }
  })
  socket.on('close', () => { active = false; child.kill('SIGKILL') })
})
server.listen(3000, '0.0.0.0')
