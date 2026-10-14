/**
 * Local acceptance check for typed solving interfaces: assembles each case's solutions with the judge's own code,
 * shapes inputs and answers as the runner does, and compiles and runs them with the local toolchains (g++, javac,
 * go, node, python3). Run with `node harnessLocal.ts [case-name-filter] [language]` from this directory.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleProgram, parseDriverOutput } from '../../supabase/functions/_shared/problemDrivers.ts'
import { formatDriverStdout, prepareInput } from '../../supabase/functions/_shared/problemShapes.ts'
import { offeredLanguages, starterCode, validateInterface, type HarnessLanguage, type ProblemInterface } from '../../supabase/functions/_shared/problemInterface.ts'
import { harnessCases, type HarnessCase } from './harnessCases.ts'
import { smokeCases } from './harnessSmokeCases.ts'

const files: Record<HarnessLanguage, string> = { cpp: 'main.cpp', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go' }
function build(language: HarnessLanguage, directory: string): string[] | null {
  const run = (command: string, args: string[]): string | null => { const r = spawnSync(command, args, { cwd: directory, encoding: 'utf8', env: { ...process.env, GOCACHE: join(tmpdir(), 'manor-go-cache'), GOMAXPROCS: '1' } }); return r.status === 0 ? null : r.stderr + r.stdout }
  const failure = language === 'cpp' ? run('g++', ['-std=c++20', '-O2', '-pipe', 'main.cpp', '-o', 'answer']) : language === 'java' ? run('javac', ['-J-Xmx256m', 'Main.java']) : language === 'go' ? run('go', ['build', '-o', 'answer', 'main.go']) : null
  if (failure !== null) { console.log(failure.slice(0, 4000)); return null }
  return language === 'cpp' || language === 'go' ? ['./answer'] : language === 'java' ? ['java', '-Xmx256m', '-XX:ActiveProcessorCount=1', 'Main'] : language === 'python' ? ['python3', '-I', 'main.py'] : ['node', '--max-old-space-size=256', 'main.js']
}

/** A solution starting with `@types` gets the starter code's type definitions, so the cases also check that starter definitions compile with the drivers. */
function withTypes(spec: ProblemInterface, language: HarnessLanguage, source: string): string {
  if (!source.startsWith('@types\n')) return source
  const starter = starterCode(spec)[language] ?? ''
  const marker = spec.kind === 'function' ? (language === 'go' ? `func ${spec.name}(` : 'class Solution') : language === 'go' ? `type ${spec.className} struct` : `class ${spec.className}`
  const at = starter.lastIndexOf(marker)
  return (at < 0 ? starter : starter.slice(0, at)) + source.slice('@types\n'.length)
}

const [filter, only] = process.argv.slice(2)
const failures: string[] = []
let passed = 0
// The provider smoke cases run twice per batch, as harnessSmoke.ts runs them; JavaScript numbers stop at 2^53.
const all = [...smokeCases.map(c => ({ name: `smoke-${c.name}`, spec: c.spec, cases: [{ input: c.input, expected: c.expected }, { input: c.input, expected: c.expected }] as HarnessCase['cases'], solutions: c.name === 'long-and-bool' ? Object.fromEntries(Object.entries(c.solutions).filter(([l]) => l !== 'javascript')) : c.solutions })), ...harnessCases]
for (const test of all.filter(c => filter === undefined || filter === '' || c.name.includes(filter))) {
  validateInterface(test.spec)
  for (const [language, source] of Object.entries(test.solutions) as [HarnessLanguage, string][]) {
    if (only !== undefined && language !== only) continue
    if (!offeredLanguages(test.spec).includes(language)) throw new Error(`${test.name} has a ${language} solution it does not offer`)
    const directory = mkdtempSync(join(tmpdir(), 'manor-harness-'))
    try {
      writeFileSync(join(directory, files[language]), assembleProgram(language, withTypes(test.spec, language, source), test.spec))
      const command = build(language, directory)
      if (command === null) { failures.push(`${test.name}/${language}: compile`); continue }
      const inputs = test.cases.map(c => c.input.endsWith('\n') ? c.input : c.input + '\n')
      const started = Date.now()
      const r = spawnSync(command[0], command.slice(1), { cwd: directory, input: inputs.map(input => prepareInput(test.spec, input)).join(''), encoding: 'utf8', timeout: 20000, env: { ...process.env, GOMAXPROCS: '1' } })
      const answers = parseDriverOutput(formatDriverStdout(test.spec, inputs, r.stdout ?? ''))
      const wrong = test.cases.flatMap((c, i) => {
        const got = answers[i]?.output ?? null
        const ok = got !== null && (c.check ? c.check(JSON.parse(got)) : JSON.stringify(JSON.parse(got)) === JSON.stringify(JSON.parse(c.expected!)))
        return ok ? [] : [`case ${i}: got ${got?.slice(0, 300)} expected ${c.expected?.slice(0, 300)}`]
      })
      if (wrong.length > 0 || r.status !== 0) { failures.push(`${test.name}/${language}`); console.log(`FAIL ${test.name}/${language} (${Date.now() - started} ms, exit ${r.status})\n  ${wrong.join('\n  ')}\n  ${(r.stderr ?? '').slice(0, 2000)}`) }
      else passed++
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}
console.log(JSON.stringify({ passed, failed: failures.length, failures }))
if (failures.length > 0) process.exit(1)
