import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const destination = process.argv[2]
if (!destination) throw new Error('Provide the destination JSON file path.')
const outputPath = resolve(destination)
const nonce = randomUUID()
const maximumBytes = 32 * 1024 * 1024
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Problem import transfer</title><body><h1>Problem import transfer</h1><form method="post" action="/${nonce}"><label for="payload">Import payload</label><textarea id="payload" name="payload" data-testid="import-payload" rows="12" cols="90"></textarea><button data-testid="save-import" type="submit">Save import data</button></form></body></html>`

/** Transfers an authorized browser extraction to a local file without exporting its login session. */
const server = createServer(async (request, response) => {
  if (request.url !== `/${nonce}`) { response.writeHead(404).end('Unavailable'); return }
  if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }).end(page); return }
  if (request.method !== 'POST') { response.writeHead(405).end('Use POST'); return }
  try {
    const chunks = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > maximumBytes) throw new Error('Import transfer exceeds 32 MiB.')
      chunks.push(chunk)
    }
    const encoded = Buffer.concat(chunks).toString('utf8')
    const payload = new URLSearchParams(encoded).get('payload')
    if (payload === null) throw new Error('The import payload is missing.')
    const parsed = JSON.parse(payload)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Import payload must be a JSON object.')
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
    await writeFile(outputPath, JSON.stringify(parsed), { mode: 0o600 })
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><html lang="en"><title>Import data saved</title><h1>Import data saved</h1></html>')
    console.log(JSON.stringify({ saved: outputPath, bytes: Buffer.byteLength(payload) }))
    server.close()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
    console.error(JSON.stringify({ operation: 'save-browser-import', error: message }))
  }
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The import transfer server has no TCP address.')
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}/${nonce}` }))
})
