import { adminClient, corsHeaders, identity, requireAgentAccess, required, verifiedCaller, z, type Json, type VerifiedCaller } from '../_shared/integrationRuntime.ts'
import { SessionExpiredError, enqueueExecution, languages, runLeased, runOneJob, runSubmission, runnerStore, submissionSchema, type ExecutionStep } from './runtime.ts'
import { editorAction, editorRequestSchemas } from './editorSessions.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<void>): void }
const executeSchema = z.object({ action: z.literal('execute'), problemId: z.string().min(1).max(200), language: z.enum(languages), code: z.string().min(1).max(262144), mode: z.enum(['run', 'submit']), customInput: z.string().max(1048576).optional(), requestId: z.uuid() })
const requestSchema = z.discriminatedUnion('action', [executeSchema, z.object({ action: z.literal('submission'), submissionId: z.uuid() }), z.object({ action: z.literal('submissions'), problemId: z.string().min(1).max(200) }), ...editorRequestSchemas])

/** How long Run and Submit hold their request open for the verdict before answering with the queued submission. */
const inlineWaitMs = 9000

type Submission = z.infer<typeof submissionSchema>
type Client = ReturnType<typeof adminClient>

/** Keeps a run going after the response, logging a failure and leaving the submission to the worker. */
function keepRunning<T>(run: Promise<T>, owner: string, submissionId: string): Promise<T> {
  const logged = run.catch(error => { console.error('Inline problem execution failed', { owner, submissionId, error: error instanceof Error ? error.message : String(error) }); throw error })
  EdgeRuntime.waitUntil(logged.then(() => undefined, () => undefined))
  return logged
}

/**
 * Runs a leased submission inside this request and keeps running it after the response if it outlasts the inline
 * wait. Resolves with the finished submission, or null when the wait ran out or the run failed.
 */
function runInline(client: Client, owner: string, leased: NonNullable<ExecutionStep['job']>, waitMs: number): Promise<Submission | null> {
  const run = keepRunning(runLeased(client, leased), owner, leased.submission.id)
  let timer = 0
  const waited = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
  return Promise.race([run.then(submission => submission, () => null), waited]).finally(() => clearTimeout(timer))
}

const finished = (submission: Submission): boolean => submission.status === 'completed' || submission.status === 'failed'

/**
 * Non-execute actions confirm the session with Auth; Run and Submit confirm it inside the transaction that enqueues.
 * Agent tokens also need the account's read grant, and its write grant for anything but reading submissions.
 */
async function authorize(client: Client, request: Request, caller: VerifiedCaller, action: z.infer<typeof requestSchema>['action']): Promise<void> {
  const write = action !== 'submission' && action !== 'submissions'
  if (action === 'execute') return requireAgentAccess(caller, write)
  const [owner] = await Promise.all([identity(client, request), requireAgentAccess(caller, write)])
  if (owner !== caller.owner) throw new Error('Your session could not be verified')
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
  let caller: VerifiedCaller
  try { caller = await verifiedCaller(request) }
  catch (error) { return reply(401, { error: error instanceof Error ? error.message : String(error) }) }
  const owner = caller.owner
  try {
    const raw = await request.text()
    if (raw.length > 1400000) return reply(413, { error: 'Execution request exceeds its size limit' })
    const input = requestSchema.parse(JSON.parse(raw))
    try { await authorize(client, request, caller, input.action) }
    catch (error) { return reply(401, { error: error instanceof Error ? error.message : String(error) }) }
    if (input.action === 'execute') {
      const { action: _, ...body } = input
      const enqueued = await enqueueExecution(client, owner, caller.sessionId, body)
      // A replayed request ID returns its submission as it stands; only one still queued is leased and run here.
      const ran = enqueued.job === null ? enqueued.submission : await runInline(client, owner, enqueued.job, inlineWaitMs)
      const submission = ran ?? submissionSchema.parse(await runnerStore(client, 'read', owner, { submissionId: enqueued.submission.id }))
      return reply(finished(submission) ? 200 : 202, submission)
    }
    if (input.action === 'submission') {
      const submission = submissionSchema.parse(await runnerStore(client, 'read', owner, { submissionId: input.submissionId }))
      if (submission.status === 'queued') void keepRunning(runSubmission(client, owner, submission.id), owner, submission.id).catch(() => undefined)
      return reply(200, submission)
    }
    if (input.action === 'submissions') return reply(200, await runnerStore(client, 'list', owner, { problemId: input.problemId }))
    return reply(200, await editorAction(client, owner, input))
  } catch (error) {
    if (error instanceof SessionExpiredError) return reply(401, { error: error.message })
    console.warn('Problem runner request failed', { owner, error: error instanceof Error ? error.message : String(error) })
    return reply(400, { error: error instanceof Error ? error.message : String(error) })
  }
})
