import { adminClient, authorizeConnection, corsHeaders, identity, required, z, type Json } from '../_shared/integrationRuntime.ts'
import { BlaxelClient } from '../_shared/blaxelClient.ts'
import { languages, runOneJob, runnerStore, submissionSchema } from './runtime.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<void>): void }
const executeSchema = z.object({ action: z.literal('execute'), problemId: z.string().min(1).max(200), language: z.enum(languages), code: z.string().min(1).max(262144), mode: z.enum(['run', 'submit']), customInput: z.string().max(1048576).optional(), requestId: z.uuid() })
const requestSchema = z.discriminatedUnion('action', [executeSchema, z.object({ action: z.literal('submission'), submissionId: z.uuid() }), z.object({ action: z.literal('submissions'), problemId: z.string().min(1).max(200) }), z.object({ action: z.literal('editor-session'), problemId: z.string().min(1).max(200), language: z.enum(languages) }), z.object({ action: z.literal('close-editor-session'), sessionId: z.uuid() })])
const filenames = { cpp: 'main.cpp', c: 'main.c', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go' }

function kickWorker(): void {
  EdgeRuntime.waitUntil(runOneJob(adminClient()).then(() => {}).catch(error => { console.error('Problem worker failed', { error: error instanceof Error ? error.message : String(error) }); throw error }))
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'POST' && request.headers.get('x-manor-worker-secret') === required('MANOR_WORKER_SECRET')) {
    const processed = await runOneJob(adminClient())
    return Response.json({ processed })
  }
  let headers: HeadersInit
  try { headers = corsHeaders(request) } catch { return new Response('Origin is not allowed', { status: 403 }) }
  const reply = (status: number, value: Json): Response => new Response(JSON.stringify(value), { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST' })
  const client = adminClient()
  let owner: string
  try { owner = await identity(client, request); await authorizeConnection(request, false) }
  catch (error) { return reply(401, { error: error instanceof Error ? error.message : String(error) }) }
  try {
    const raw = await request.text()
    if (raw.length > 1400000) return reply(413, { error: 'Execution request exceeds its size limit' })
    const input = requestSchema.parse(JSON.parse(raw))
    if (input.action !== 'submission' && input.action !== 'submissions') await authorizeConnection(request, true)
    if (input.action === 'execute') {
      const { action: _, ...body } = input
      const submission = submissionSchema.parse(await runnerStore(client, 'enqueue', owner, body))
      kickWorker()
      return reply(202, submission)
    }
    if (input.action === 'submission') {
      const submission = submissionSchema.parse(await runnerStore(client, 'read', owner, { submissionId: input.submissionId }))
      if (submission.status === 'queued') kickWorker()
      return reply(200, submission)
    }
    if (input.action === 'submissions') return reply(200, await runnerStore(client, 'list', owner, { problemId: input.problemId }))
    const provider = BlaxelClient.configured()
    if (input.action === 'close-editor-session') {
      const session = z.object({ sandboxName: z.string(), expiresAt: z.string() }).nullable().parse(await runnerStore(client, 'editor_read', owner, { id: input.sessionId }))
      if (session === null) return reply(200, { closed: true })
      await provider.deleteSandbox(session.sandboxName)
      await runnerStore(client, 'editor_delete', owner, { id: input.sessionId })
      return reply(200, { closed: true })
    }
    const problem = await client.from('leetcode_problems').select('id').eq('user_id', owner).eq('id', input.problemId).maybeSingle()
    if (problem.error) throw new Error(`Read editor problem: ${problem.error.message}`)
    if (problem.data === null) return reply(404, { error: 'Problem not found' })
    const id = crypto.randomUUID()
    const name = 'manor-editor-' + id.replaceAll('-', '')
    const expiresAt = new Date(Date.now() + 40 * 60000).toISOString()
    await runnerStore(client, 'editor_save', owner, { id, problemId: input.problemId, language: input.language, sandboxName: name, expiresAt })
    try {
      const sandbox = await provider.createSandbox(name, 'editor')
      const connection = await provider.editorSession(sandbox, input.language, expiresAt)
      return reply(200, { id, ...connection, expiresAt, workspaceUri: 'file:///workspace', documentUri: 'file:///workspace/' + filenames[input.language] })
    } catch (error) {
      try { await provider.deleteSandbox(name); await runnerStore(client, 'editor_delete', owner, { id }) }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], `Editor session creation failed: ${error instanceof Error ? error.message : String(error)}. Sandbox cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`) }
      throw error
    }
  } catch (error) {
    console.warn('Problem runner request failed', { owner, error: error instanceof Error ? error.message : String(error) })
    return reply(400, { error: error instanceof Error ? error.message : String(error) })
  }
})
