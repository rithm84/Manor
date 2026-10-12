/** Upload the credential-free runtime image through Blaxel's documented remote build API. */
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'

const root = dirname(fileURLToPath(import.meta.url))
const env = parseEnv(await readFile(join(root, '../../.env.local'), 'utf8'))
const key = env.BLAXEL_API_KEY
const workspace = env.BLAXEL_WORKSPACE
if (!key || !workspace) throw new Error('BLAXEL_API_KEY and BLAXEL_WORKSPACE are required in the repository .env.local')
const name = process.argv[2]
if (!name || !/^manor-[a-z0-9-]+$/.test(name)) throw new Error('Supply an explicit manor-prefixed runtime build name')
const headers = { Authorization: `Bearer ${key}`, 'X-Blaxel-Workspace': workspace, 'Content-Type': 'application/json' }
const directory = await mkdtemp(join(tmpdir(), 'manor-runtime-build-'))
try {
  const zip = join(directory, 'image.zip')
  execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: join(root, 'image') })
  const labels = { 'x-blaxel-builder': 'sandbox', 'x-blaxel-build-region': 'us-was-1' }
  const create = await fetch('https://api.blaxel.ai/v0/images?upload=true', { method: 'POST', headers, body: JSON.stringify({ name, resourceType: 'sandbox', generation: 'mk3', labels }) })
  if (!create.ok) throw new Error(`Blaxel image creation returned ${create.status}: ${(await create.text()).slice(0, 2000)}`)
  const uploadUrl = create.headers.get('x-blaxel-upload-url')
  if (!uploadUrl) throw new Error('Blaxel did not return the image upload URL')
  const signedHeaders = new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? []
  const uploadHeaders = { 'Content-Type': 'application/zip' }
  for (const [label, value] of Object.entries(labels)) if (signedHeaders.includes('x-amz-meta-' + label)) uploadHeaders['x-amz-meta-' + label] = value
  const upload = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: await readFile(zip) })
  if (!upload.ok) throw new Error(`Blaxel image upload returned ${upload.status}: ${(await upload.text()).slice(0, 1000)}`)
  await writeFile(join(directory, 'resource.json'), JSON.stringify({ name }))
  console.log(JSON.stringify({ name, status: 'uploaded' }))
} finally { await rm(directory, { recursive: true, force: true }) }
