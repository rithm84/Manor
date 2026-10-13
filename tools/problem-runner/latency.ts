/**
 * Measures the deployed problem runner the way the app calls it, as a signed-in user of a staging project.
 *
 * The script reads the project's keys through the Management API with `SUPABASE_ACCESS_TOKEN`, mints a session for
 * the given user with an admin magic link, and then makes the app's own calls: the `read_problem` query, editor-session
 * creation (closed again right away), and Run and Submit in every harness language, polling `submission` until a
 * verdict. The problem must be a typed Two Sum, because the script submits known accepted solutions to it. Each Run and
 * Submit writes a submission to the account, and an accepted Submit records an attempt, so use a test account.
 *
 * Every round waits `--idle-seconds`, then makes one pass over the operations, which the table reports as cold (the
 * first call of each operation after the idle gap), followed by `--warm` passes reported as warm. Client times run from
 * the request to the poll that saw the verdict; server times are the submission's own `createdAt` to `finishedAt`. The
 * run fails when the deployed function version changes while it measures.
 *
 * `--region` pins the function's region as `ProblemExecutionService` does; `any` runs it nearest the caller.
 *
 * Usage: deno run --allow-env --allow-net latency.ts --project-ref <ref> --user-id <uuid> --problem-id <id>
 *        [--rounds 3] [--warm 2] [--idle-seconds 120] [--poll-ms 250] [--region us-east-1]
 */
import { FunctionRegion, createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { z } from 'npm:zod@4.1.12'

const LANGUAGES = ['python', 'cpp', 'javascript', 'java', 'go'] as const
type Language = typeof LANGUAGES[number]
const PRODUCTION_REF = 'pxdxqueevzttpmxjsqes'
const VERDICT_TIMEOUT_MS = 120_000
const TWO_SUM: Readonly<Record<Language, string>> = {
  python: 'from typing import List\n\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        unordered_map<int, int> seen;\n        for (int i = 0; i < (int)nums.size(); i++) {\n            auto found = seen.find(target - nums[i]);\n            if (found != seen.end()) return {found->second, i};\n            seen[nums[i]] = i;\n        }\n        return {};\n    }\n};\n',
  javascript: 'var twoSum = function(nums, target) {\n    const seen = new Map();\n    for (let i = 0; i < nums.length; i++) {\n        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n        seen.set(nums[i], i);\n    }\n    return [];\n};\n',
  java: 'import java.util.*;\n\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        HashMap<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            Integer j = seen.get(target - nums[i]);\n            if (j != null) return new int[]{j, i};\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n',
  go: 'package main\n\nfunc twoSum(nums []int, target int) []int {\n    seen := map[int]int{}\n    for i, x := range nums {\n        if j, ok := seen[target-x]; ok {\n            return []int{j, i}\n        }\n        seen[x] = i\n    }\n    return nil\n}\n',
}

const optionsSchema = z.object({
  projectRef: z.string().regex(/^[a-z]{20}$/).refine(ref => ref !== PRODUCTION_REF, 'Measure a staging project; this script writes submissions'),
  userId: z.uuid(), problemId: z.string().min(1),
  rounds: z.coerce.number().int().min(1), warm: z.coerce.number().int().min(0),
  idleSeconds: z.coerce.number().int().min(0), pollMs: z.coerce.number().int().min(50), region: z.enum(FunctionRegion),
})
type Options = z.infer<typeof optionsSchema>
const keySchema = z.array(z.object({ name: z.string(), api_key: z.string().nullable() }))
const functionSchema = z.object({ slug: z.string(), version: z.number().int(), updated_at: z.number(), ezbr_sha256: z.string().optional() })
const detailSchema = z.object({ can_execute: z.boolean(), grading_available: z.boolean(), content: z.object({ interface: z.object({ name: z.string() }).nullable() }).nullable() })
const submissionSchema = z.object({ id: z.uuid(), status: z.enum(['queued', 'running', 'completed', 'failed']), verdict: z.string().nullable(), passedCases: z.number().int(), totalCases: z.number().int(), error: z.string().nullable(), createdAt: z.string(), finishedAt: z.string().nullable() })
const editorSchema = z.object({ id: z.uuid(), webSocketUrls: z.record(z.enum(['cpp', 'c', 'python', 'javascript', 'java', 'go']), z.url()) })
type Submission = z.infer<typeof submissionSchema>

interface Sample { readonly ms: number; readonly serverMs: number | null }
interface Operation { readonly name: string; readonly measure: () => Promise<Sample> }

/** Parses `--flag value` pairs into validated options. */
function parseCommandLine(argv: readonly string[]): Options {
  const values: Record<string, string> = { rounds: '3', warm: '2', idleSeconds: '120', pollMs: '250', region: FunctionRegion.UsEast1 }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag.startsWith('--') || value === undefined) throw new Error(`Expected --flag value pairs, received ${argv.join(' ')}`)
    values[flag.slice(2).replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())] = value
  }
  return optionsSchema.parse(values)
}

/** Calls the Supabase Management API and validates the JSON it returns. */
async function management<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const token = Deno.env.get('SUPABASE_ACCESS_TOKEN')
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is required to read the project keys and function version')
  const response = await fetch(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Management API GET ${path} returned ${response.status}: ${(await response.text()).slice(0, 1000)}`)
  return schema.parse(await response.json())
}

/** Signs in as the user with an admin magic link and returns a client that carries that session. */
async function signedInClient(projectRef: string, userId: string): Promise<SupabaseClient> {
  const keys = await management(`/v1/projects/${projectRef}/api-keys?reveal=true`, keySchema)
  const key = (name: string): string => {
    const found = keys.find(item => item.name === name)?.api_key
    if (!found) throw new Error(`Project ${projectRef} has no ${name} key`)
    return found
  }
  const url = `https://${projectRef}.supabase.co`
  const settings = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(url, key('service_role'), settings)
  const user = await admin.auth.admin.getUserById(userId)
  if (user.error || !user.data.user.email) throw new Error(`Read user ${userId}: ${user.error?.message ?? 'the user has no email'}`)
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.data.user.email })
  if (link.error) throw new Error(`Generate a magic link for user ${userId}: ${link.error.message}`)
  const client = createClient(url, key('anon'), settings)
  const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token })
  if (verified.error || verified.data.user?.id !== userId) throw new Error(`Verify the magic link for user ${userId}: ${verified.error?.message ?? 'signed in as another user'}`)
  return client
}

/** Invokes one problem-runner action exactly as `ProblemExecutionService` does. */
async function runner<T>(client: SupabaseClient, region: FunctionRegion, action: string, input: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await client.functions.invoke('problem-runner', { body: { action, ...input }, region })
  if (error) {
    const detail = 'context' in error && error.context instanceof Response ? await error.context.text() : ''
    throw new Error(`problem-runner ${action} failed: ${error.message} ${detail.slice(0, 1000)}`)
  }
  return schema.parse(data)
}

/** Reads the problem detail exactly as `ProblemLibraryService.loadProblem` does. */
async function readProblem(client: SupabaseClient, problemId: string): Promise<z.infer<typeof detailSchema>> {
  const { data, error, status } = await client.rpc('manor_problem_query', { p_query: 'read_problem', p_input: { id: problemId } })
  if (error) throw new Error(`Read problem ${problemId} returned ${status}: ${error.message}`)
  return detailSchema.parse(data)
}

/** Enqueues one execution and polls it to a verdict, timing from the request to the poll that saw the verdict. */
async function execute(client: SupabaseClient, region: FunctionRegion, problemId: string, language: Language, mode: 'run' | 'submit', pollMs: number): Promise<Sample> {
  const started = performance.now()
  let submission: Submission = await runner(client, region, 'execute', { problemId, language, code: TWO_SUM[language], mode, requestId: crypto.randomUUID() }, submissionSchema)
  while (submission.status === 'queued' || submission.status === 'running') {
    if (performance.now() - started > VERDICT_TIMEOUT_MS) throw new Error(`${mode} ${language} submission ${submission.id} had no verdict within ${VERDICT_TIMEOUT_MS} ms`)
    await new Promise(resolve => setTimeout(resolve, pollMs))
    submission = await runner(client, region, 'submission', { submissionId: submission.id }, submissionSchema)
  }
  const ms = performance.now() - started
  if (submission.status !== 'completed' || submission.verdict !== 'accepted') throw new Error(`${mode} ${language} submission ${submission.id} ended ${submission.status} ${submission.verdict}: ${submission.error ?? `${submission.passedCases}/${submission.totalCases} cases passed`}`)
  return { ms, serverMs: submission.finishedAt === null ? null : Date.parse(submission.finishedAt) - Date.parse(submission.createdAt) }
}

/** The operations of one pass, in the order a pass runs them. */
function operations(client: SupabaseClient, options: Options): Operation[] {
  const timed = async (call: () => Promise<unknown>): Promise<Sample> => { const started = performance.now(); await call(); return { ms: performance.now() - started, serverMs: null } }
  return [
    { name: 'Problem detail read', measure: () => timed(() => readProblem(client, options.problemId)) },
    { name: 'Editor session (python)', measure: async () => {
      const started = performance.now()
      const session = await runner(client, options.region, 'editor-session', { problemId: options.problemId, language: 'python' }, editorSchema)
      const ms = performance.now() - started
      await runner(client, options.region, 'close-editor-session', { sessionId: session.id }, z.object({ closed: z.literal(true) }))
      return { ms, serverMs: null }
    } },
    ...LANGUAGES.map(language => ({ name: `Run ${language}`, measure: () => execute(client, options.region, options.problemId, language, 'run', options.pollMs) })),
    ...LANGUAGES.map(language => ({ name: `Submit ${language}`, measure: () => execute(client, options.region, options.problemId, language, 'submit', options.pollMs) })),
  ]
}

/** Nearest-rank percentile of the samples, rounded to whole milliseconds. */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)])
}

/** Formats a series as `median / p90 ms`, or a dash when there are no samples. */
function summarize(values: readonly number[]): string {
  return values.length === 0 ? '-' : `${percentile(values, 0.5)} / ${percentile(values, 0.9)} ms`
}

/** The server's own time from enqueue to verdict for the samples that have one. */
function serverTimes(samples: readonly Sample[]): number[] {
  return samples.flatMap(sample => sample.serverMs === null ? [] : [sample.serverMs])
}

async function main(): Promise<void> {
  const options = parseCommandLine(Deno.args)
  const deployed = await management(`/v1/projects/${options.projectRef}/functions/problem-runner`, functionSchema)
  const client = await signedInClient(options.projectRef, options.userId)
  const detail = await readProblem(client, options.problemId)
  if (!detail.can_execute || !detail.grading_available || detail.content?.interface?.name !== 'twoSum') throw new Error(`Problem ${options.problemId} must be a gradable typed Two Sum`)
  const passes = operations(client, options)
  const cold = new Map<string, Sample[]>(passes.map(operation => [operation.name, []]))
  const warm = new Map<string, Sample[]>(passes.map(operation => [operation.name, []]))
  for (let round = 1; round <= options.rounds; round += 1) {
    console.error(`round ${round}/${options.rounds}: idle ${options.idleSeconds} s`)
    await new Promise(resolve => setTimeout(resolve, options.idleSeconds * 1000))
    for (let pass = 0; pass <= options.warm; pass += 1) {
      for (const operation of passes) {
        const sample = await operation.measure()
        ;(pass === 0 ? cold : warm).get(operation.name)!.push(sample)
        console.error(`round ${round} ${pass === 0 ? 'cold' : `warm ${pass}`}: ${operation.name} ${Math.round(sample.ms)} ms${sample.serverMs === null ? '' : `, server ${sample.serverMs} ms`}`)
      }
    }
  }
  const finished = await management(`/v1/projects/${options.projectRef}/functions/problem-runner`, functionSchema)
  const stamp = new Date(deployed.updated_at).toISOString()
  console.log(`## problem-runner version ${deployed.version} (deployed ${stamp}${deployed.ezbr_sha256 ? `, sha256 ${deployed.ezbr_sha256.slice(0, 12)}` : ''}) on ${options.projectRef}`)
  console.log(`Measured ${new Date().toISOString()}: ${options.rounds} rounds, each an idle gap of ${options.idleSeconds} s, one cold pass, and ${options.warm} warm passes; polled every ${options.pollMs} ms; region ${options.region}.\n`)
  console.log('| Operation | Cold median / p90 | Warm median / p90 | Cold server | Warm server | Samples (cold, warm) |\n|---|---|---|---|---|---|')
  for (const operation of passes) {
    const coldSamples = cold.get(operation.name)!
    const warmSamples = warm.get(operation.name)!
    console.log(`| ${operation.name} | ${summarize(coldSamples.map(sample => sample.ms))} | ${summarize(warmSamples.map(sample => sample.ms))} | ${summarize(serverTimes(coldSamples))} | ${summarize(serverTimes(warmSamples))} | ${coldSamples.length}, ${warmSamples.length} |`)
  }
  if (finished.version !== deployed.version) throw new Error(`problem-runner changed from version ${deployed.version} to ${finished.version} during the measurement, so the samples mix both versions`)
}

await main()
