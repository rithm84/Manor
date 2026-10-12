/** Prints a runnable program for a typed interface, the interface's starter code, or a special judge program, using the same code as the judge. Input: a JSON file with interface, language, and optional source, or with judge source. */
import { readFileSync } from 'node:fs'
import { assembleProgram } from '../../supabase/functions/_shared/problemDrivers.ts'
import { starterCode, validateInterface } from '../../supabase/functions/_shared/problemInterface.ts'
import { judgeProgram } from '../../supabase/functions/_shared/problemJudge.ts'

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (request.judge !== undefined) { process.stdout.write(judgeProgram(request.judge)); process.exit(0) }
validateInterface(request.interface)
process.stdout.write(request.source === undefined ? JSON.stringify(starterCode(request.interface)) : assembleProgram(request.language, request.source, request.interface))
