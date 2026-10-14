/**
 * Compiles each spec's starter code with its driver in every offered language and runs the examples, so every real
 * interface is checked to assemble, compile, and run end to end (starter answers are placeholders and are not graded).
 * Usage: node harnessStarters.ts <validated.json>...
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleProgram, parseDriverOutput } from '../../supabase/functions/_shared/problemDrivers.ts'
import { prepareInput } from '../../supabase/functions/_shared/problemShapes.ts'
import type { HarnessLanguage, ProblemInterface } from '../../supabase/functions/_shared/problemInterface.ts'

const files: Record<HarnessLanguage, string> = { cpp: 'main.cpp', python: 'main.py', javascript: 'main.js', java: 'Main.java', go: 'main.go' }
const failures: string[] = []
let runs = 0
for (const path of process.argv.slice(2)) {
  const spec = JSON.parse(readFileSync(path, 'utf8'))
  const face = spec.content.interface as ProblemInterface
  const inputs = (spec.testset.cases as { input: string; hidden: boolean }[]).filter(c => !c.hidden).map(c => prepareInput(face, c.input))
  for (const [language, starter] of Object.entries(spec.content.starter_code) as [HarnessLanguage, string][]) {
    const directory = mkdtempSync(join(tmpdir(), 'manor-starter-'))
    try {
      writeFileSync(join(directory, files[language]), assembleProgram(language, starter, face))
      const sh = (command: string, args: string[], input?: string) => spawnSync(command, args, { cwd: directory, input, encoding: 'utf8', timeout: 30000, env: { ...process.env, GOCACHE: join(tmpdir(), 'manor-go-cache'), GOMAXPROCS: '1' } })
      const compiled = language === 'cpp' ? sh('g++', ['-std=c++20', '-O2', 'main.cpp', '-o', 'answer']) : language === 'java' ? sh('javac', ['Main.java']) : language === 'go' ? sh('go', ['build', '-o', 'answer', 'main.go']) : null
      if (compiled && compiled.status !== 0) { failures.push(`${spec.key}/${language}: compile ${(compiled.stderr + compiled.stdout).slice(0, 600)}`); continue }
      const run = language === 'cpp' || language === 'go' ? ['./answer'] : language === 'java' ? ['java', 'Main'] : language === 'python' ? ['python3', '-I', 'main.py'] : ['node', 'main.js']
      const r = sh(run[0], run.slice(1), inputs.join(''))
      runs++
      // Placeholder answers may fail a case, but the batch must finish: every case reports and the process exits.
      if (parseDriverOutput(r.stdout ?? '').length !== inputs.length) failures.push(`${spec.key}/${language}: ran ${parseDriverOutput(r.stdout ?? '').length}/${inputs.length} cases, exit ${r.status} ${(r.stderr ?? '').slice(0, 400)}`)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}
console.log(JSON.stringify({ runs, failures: failures.length }))
for (const failure of failures) console.log(failure)
