/**
 * Prints a runnable program for a typed interface, the interface's starter code, or a special judge program, using the
 * same code as the judge. Input: a JSON file with interface, language, and optional source, or with judge source. With
 * `op`, it instead prints JSON: `lines` lists a case's friendly input lines, `prepare` shapes friendly case inputs into
 * program inputs, and `format` rewrites a batch's driver output into friendly answers, as the runner does.
 */
import { readFileSync } from 'node:fs'
import { assembleProgram } from '../../supabase/functions/_shared/problemDrivers.ts'
import { starterCode, validateInterface } from '../../supabase/functions/_shared/problemInterface.ts'
import { judgeProgram } from '../../supabase/functions/_shared/problemJudge.ts'
import { caseLines, driverMeta } from '../../supabase/functions/_shared/problemDriverMeta.ts'
import { formatDriverStdout, prepareInput } from '../../supabase/functions/_shared/problemShapes.ts'

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (request.judge !== undefined) { process.stdout.write(judgeProgram(request.judge)); process.exit(0) }
validateInterface(request.interface)
if (request.op === 'lines') { process.stdout.write(JSON.stringify({ lines: caseLines(request.interface), table: driverMeta(request.interface).table })); process.exit(0) }
if (request.op === 'prepare') {
  const prepared = request.inputs.map(input => { try { return { input: prepareInput(request.interface, input) } } catch (error) { return { error: error instanceof Error ? error.message : String(error) } } })
  process.stdout.write(JSON.stringify(prepared)); process.exit(0)
}
if (request.op === 'format') { process.stdout.write(JSON.stringify(formatDriverStdout(request.interface, request.inputs, request.stdout))); process.exit(0) }
process.stdout.write(request.source === undefined ? JSON.stringify(starterCode(request.interface)) : assembleProgram(request.language, request.source, request.interface))
