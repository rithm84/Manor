import { FileVerificationError, verifyFileRange } from '../_shared/streamChecksum.ts'
import { FILE_VERIFICATION_CHUNK_BYTES, MAX_FILE_UPLOAD_BYTES } from '../_shared/fileUploadPolicy.ts'
import {authorizeConnection} from '../_shared/integrationRuntime.ts'
import {fileClient,readAccessibleFile} from '../_shared/fileAccess.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { z } from 'npm:zod@4.1.12'
import { OriginNotAllowedError, originHeaders, requestOrigin } from '../_shared/origins.ts'

function required(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing server configuration ${name}`)
  return value
}

const fileSchema = z.object({ id: z.uuid(), status: z.enum(['allocated','ready','purging']), storage_path: z.string(), mime_type: z.string(), size: z.number().int().positive().max(MAX_FILE_UPLOAD_BYTES), sha256: z.string() }).passthrough()

Deno.serve(async (request: Request): Promise<Response> => {
  let origin: string | null
  try { origin = requestOrigin(request) }
  catch (error) { if (error instanceof OriginNotAllowedError) return Response.json({ error: error.message }, { status: 403 }); throw error }
  const headers = { 'Content-Type': 'application/json', ...originHeaders(origin), 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
  const reply = (status: number, body: object): Response => new Response(JSON.stringify(body), { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST' })
  const bearer = request.headers.get('authorization')
  if (!bearer?.startsWith('Bearer ')) return reply(401, { error: 'Sign in before finalizing an upload' })
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: identity, error: authError } = await client.auth.getUser(bearer.slice(7))
  if (authError || !identity.user) return reply(401, { error: 'Your session expired. Sign in again.' })
  try { await authorizeConnection(request, true) }
  catch (error) { return reply(403, { error: error instanceof Error ? error.message : String(error) }) }
  const raw = await request.text()
  if (raw.length > 1024) return reply(413, { error: 'Request is too large' })
  let input: { id: string }
  try { input = z.object({ id: z.uuid() }).parse(JSON.parse(raw)) }
  catch { return reply(400, { error: 'Supply a valid upload ID' }) }
  let file: z.infer<typeof fileSchema>
  try { file = fileSchema.parse(await readAccessibleFile(fileClient(bearer), identity.user.id, input.id)) }
  catch (error) { return reply(404, { error: error instanceof Error ? error.message : String(error) }) }
  if (file.status === 'ready') return reply(200, file)
  const checkpoint = await client.rpc('manor_file_verification_state', { p_owner: identity.user.id, p_id: input.id })
  if (checkpoint.error) return reply(409, { error: checkpoint.error.message })
  const saved = z.object({ verified_bytes: z.number().int().nonnegative(), hash_state: z.string().nullable(), object_etag: z.string().nullable() }).parse(checkpoint.data)
  const offset = saved.verified_bytes
  const end = Math.min(file.size, offset + FILE_VERIFICATION_CHUNK_BYTES) - 1
  const storageUrl = new URL(`/storage/v1/object/authenticated/manor-files/${file.storage_path.split('/').map(encodeURIComponent).join('/')}`, required('SUPABASE_URL'))
  let verified: { size: number; state: string; sha256: string | null }
  let objectEtag: string
  try {
    const response = await fetch(storageUrl, {
      headers: { Authorization: `Bearer ${required('SUPABASE_SERVICE_ROLE_KEY')}`, apikey: required('SUPABASE_SERVICE_ROLE_KEY'), Range: `bytes=${offset}-${end}`, ...(saved.object_etag === null ? {} : { 'If-Match': saved.object_etag }) },
      signal: AbortSignal.timeout(120000), redirect: 'error'
    })
    if (!response.ok) {
      await response.body?.cancel()
      return reply(response.status >= 500 ? 503 : 409, { error: 'Upload the file bytes before finalizing', storage_status: response.status })
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (mimeType !== file.mime_type) {
      await response.body?.cancel()
      return reply(422, { error: 'Uploaded file type differs from the upload intent' })
    }
    objectEtag = response.headers.get('etag') ?? ''
    if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${end}/${file.size}` || objectEtag.length === 0 || (saved.object_etag !== null && objectEtag !== saved.object_etag)) {
      await response.body?.cancel()
      return reply(422, { error: 'Storage returned a different file version or byte range', code: 'range_mismatch' })
    }
    const length = response.headers.get('content-length')
    if (length !== null && Number(length) !== end - offset + 1) {
      await response.body?.cancel()
      return reply(422, { error: 'Uploaded file size differs from the upload intent' })
    }
    if (response.body === null) return reply(409, { error: 'Uploaded file bytes are unavailable' })
    verified = await verifyFileRange(response.body, end - offset + 1, saved.hash_state, end + 1 === file.size ? file.sha256 : null)
  } catch (error) {
    if (error instanceof FileVerificationError) return reply(422, { error: error.message, code: error.code })
    if (error instanceof DOMException || error instanceof TypeError) {
      console.warn('file_verification_interrupted', { file_id: input.id, reason: error.name, message: error.message })
      return reply(503, { error: 'File verification could not finish. Retry to verify the uploaded bytes.', code: 'verification_interrupted', reason: error.name })
    }
    throw error
  }
  const result = await client.rpc('manor_checkpoint_file_verification', {
    p_owner: identity.user.id, p_id: input.id, p_offset: offset, p_next_offset: end + 1,
    p_hash_state: verified.state, p_object_etag: objectEtag, p_sha256: verified.sha256
  })
  if (result.error) return reply(409, { error: 'File verification checkpoint failed', detail: result.error.message })
  const output = z.object({ status: z.string() }).passthrough().parse(result.data)
  return reply(output.status === 'verifying' ? 202 : 200, { ...output, id: input.id })
})
