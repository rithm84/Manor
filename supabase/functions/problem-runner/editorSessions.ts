/**
 * Editor capabilities. Each account has one resumable editor sandbox, reused across problems and languages, whose
 * lease is extended by every editor request and expires after idle. The sandbox only ever receives the code the
 * editor sends; hidden tests, expected answers, and reference solutions never enter it.
 */
import { adminClient, z, type Json } from '../_shared/integrationRuntime.ts'
import { BlaxelClient } from '../_shared/blaxelClient.ts'
import { languages, runnerStore } from './runtime.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<void>): void }
export const editorRequestSchemas = [
  z.object({ action: z.literal('editor-session'), language: z.enum(languages), problemId: z.string().min(1).max(200).nullable() }),
  z.object({ action: z.literal('close-editor-session'), sessionId: z.uuid() }),
] as const
type EditorRequest = z.infer<typeof editorRequestSchemas[number]>
type Client = ReturnType<typeof adminClient>

/** Idle window of the account's lease; the token for a connection lasts as long as the lease it was issued under. */
const idleSeconds = 1800
const leaseSchema = z.object({ id: z.uuid(), sandboxName: z.string(), expiresAt: z.string(), stale: z.array(z.object({ id: z.uuid(), sandboxName: z.string() })) })

/** Deletes leases left by earlier sandboxes after the response, so cleanup never delays the editor. */
function removeStale(client: Client, provider: BlaxelClient, owner: string, stale: z.infer<typeof leaseSchema>['stale']): void {
  if (stale.length === 0) return
  EdgeRuntime.waitUntil(Promise.all(stale.map(async session => {
    await provider.deleteSandbox(session.sandboxName)
    await runnerStore(client, 'editor_delete', owner, { id: session.id })
  })).then(() => {}).catch(error => {
    console.error('Stale editor sandbox cleanup failed', { owner, sandboxes: stale.map(session => session.sandboxName), error: error instanceof Error ? error.message : String(error) })
    throw error
  }))
}

/**
 * Prewarming and opening are the same idempotent request: it renews the lease (binding the open problem, so an
 * active editor still protects it from grouping), resumes or creates the sandbox, keeps its language servers running
 * (starting the requested language first), and returns a fresh short-lived token with every language's address, so
 * the editor switches languages without asking again.
 */
async function openEditor(client: Client, owner: string, language: typeof languages[number], problemId: string | null): Promise<Json> {
  const result = await client.rpc('manor_problem_editor_lease', { p_owner: owner, p_problem_id: problemId, p_language: language, p_idle_seconds: idleSeconds })
  if (result.error) throw new Error(`Renew editor lease for ${language}${problemId === null ? '' : ` on problem ${problemId}`}: ${result.error.message}`)
  const lease = leaseSchema.parse(result.data)
  const provider = BlaxelClient.configured()
  removeStale(client, provider, owner, lease.stale)
  const expiresAt = new Date(lease.expiresAt).toISOString()
  const sandbox = await provider.ensureEditorSandbox(lease.sandboxName)
  const [connection] = await Promise.all([provider.editorConnection(lease.sandboxName, expiresAt), provider.ensureLanguageServers(sandbox, language)])
  return { id: lease.id, ...connection, expiresAt, workspaceUri: 'file:///workspace' }
}

/** Releases a lease and its sandbox explicitly; idle leases are otherwise removed by the minute cleanup. */
async function closeEditor(client: Client, owner: string, sessionId: string): Promise<Json> {
  const session = z.object({ sandboxName: z.string(), expiresAt: z.string() }).nullable().parse(await runnerStore(client, 'editor_read', owner, { id: sessionId }))
  if (session === null) return { closed: true }
  await BlaxelClient.configured().deleteSandbox(session.sandboxName)
  await runnerStore(client, 'editor_delete', owner, { id: sessionId })
  return { closed: true }
}

export function editorAction(client: Client, owner: string, input: EditorRequest): Promise<Json> {
  return input.action === 'editor-session' ? openEditor(client, owner, input.language, input.problemId) : closeEditor(client, owner, input.sessionId)
}
