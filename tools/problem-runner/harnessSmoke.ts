/**
 * Real-provider acceptance check for typed solving interfaces in every harness language. Every job runs in one standing
 * judge sandbox, with each case's languages submitted concurrently as an account's jobs can be; it is deleted in finally.
 */
import { BlaxelClient } from '../../supabase/functions/_shared/blaxelClient.ts'
import { assembleProgram, driverPeakKb, parseDriverOutput } from '../../supabase/functions/_shared/problemDrivers.ts'
import { validateInterface, type HarnessLanguage } from '../../supabase/functions/_shared/problemInterface.ts'
import { smokeCases as cases } from './harnessSmokeCases.ts'

const image = Deno.args[0]
if (!image) throw new Error('Supply the published runtime image identifier')
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!key || !workspace) throw new Error('BLAXEL_API_KEY and BLAXEL_WORKSPACE are required')
const client = new BlaxelClient(key, workspace, image)

const failures: string[] = []
const sandbox = await client.warmSandbox('judge', crypto.randomUUID())
try {
  for (const test of cases) {
    validateInterface(test.spec)
    await Promise.all(Object.entries(test.solutions).map(async ([language, source]) => {
      // JavaScript numbers cannot represent integers beyond 2^53, as on other judges.
      if (test.name === 'long-and-bool' && language === 'javascript') return
      const code = assembleProgram(language as HarnessLanguage, source, test.spec)
      const result = await client.judge(sandbox, { language, code, cases: [{ id: test.name, input: test.input + test.input }] })
      const compileFailed = result.compile !== null && result.compile.exitCode !== 0
      const answers = compileFailed ? [] : parseDriverOutput(result.cases[0]?.process.stdout ?? '')
      const same = (output: string | null): boolean => output !== null && (test.name === 'long-and-bool' ? output === test.expected : JSON.stringify(JSON.parse(output)) === JSON.stringify(JSON.parse(test.expected)))
      const peakKb = driverPeakKb(result.cases[0]?.process.stdout ?? '')
      const passed = result.cases[0]?.process.exitCode === 0 && answers.length === 2 && answers.every(answer => same(answer.output)) && (peakKb ?? 0) > 0 && result.tainted.length === 0
      console.log(JSON.stringify({ case: test.name, language, passed, peakKb, compileMs: result.compile?.durationMs ?? 0, output: passed ? undefined : result.cases[0]?.process.stdout, stderr: passed ? undefined : (compileFailed ? result.compile?.stderr : result.cases[0]?.process.stderr)?.slice(0, 1500), tainted: passed ? undefined : result.tainted }))
      if (!passed) failures.push(`${test.name}/${language}`)
    }))
  }
} finally { await client.deleteSandbox(sandbox.metadata.name) }
if (failures.length > 0) throw new Error(`Harness acceptance failed: ${failures.join(', ')}`)
console.log(JSON.stringify({ passed: cases.length }))
