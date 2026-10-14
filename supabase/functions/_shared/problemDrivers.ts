/** Hidden drivers for interpreted languages and program assembly for every harness language. */
import type { HarnessLanguage, ProblemInterface } from './problemInterface.ts'
import { goDriver, goPrelude } from './problemGo.ts'
import { javaDriver } from './problemJava.ts'
import { cppDriver, cppPrelude } from './problemCpp.ts'
import { javascriptProgram } from './problemJavascript.ts'
import { pythonProgram } from './problemPython.ts'

/** Leading code that the driver needs before the solution; kept on the first line where the language allows it so reported line numbers match the editor. */
export function assembleProgram(language: HarnessLanguage, source: string, spec: ProblemInterface): string {
  if (language === 'python') return pythonProgram(source, spec)
  if (language === 'javascript') return javascriptProgram(source, spec)
  if (language === 'cpp') return '#include <bits/stdc++.h>\nusing namespace std;\n' + cppPrelude(spec) + '#line 1\n' + source + cppDriver(spec)
  if (language === 'java') return 'import java.util.*;import java.util.function.*;import java.util.stream.*;' + source.replace(new RegExp(`\\bpublic(\\s+(?:final\\s+)?class\\s+${spec.kind === 'codec' ? `(?:Solution|${spec.className})` : 'Solution'}\\b)`), '$1') + javaDriver(spec)
  const prelude = goPrelude(spec)
  const packageLine = /^\s*package\s+main\s*;?[ \t]*(\r?\n|$)/
  return (packageLine.test(source) ? source.replace(packageLine, prelude + '$1') : prelude + '\n' + source) + goDriver(spec)
}

export interface DriverCaseOutput { readonly index: number; readonly durationMs: number; readonly output: string | null; readonly stdout: string }
const marker = '\u001eMANOR '

/** Splits batched driver output into per-case answers; text before a case's marker is that case's own printed output. A missing marker means the process stopped before finishing that case. */
export function parseDriverOutput(stdout: string): DriverCaseOutput[] {
  const cases: DriverCaseOutput[] = []
  let rest = stdout
  while (true) {
    const at = rest.indexOf(marker)
    if (at < 0) break
    const end = rest.indexOf('\n', at)
    const line = rest.slice(at + marker.length, end < 0 ? undefined : end)
    const match = /^(\d+) (\d+) (.*)$/s.exec(line)
    if (match === null) throw new Error('Driver produced a malformed result marker')
    const index = Number(match[1])
    if (index !== cases.length) throw new Error('Driver results arrived out of order')
    cases.push({ index, durationMs: Number(match[2]), output: match[3] === '!' ? null : match[3], stdout: rest.slice(0, at) })
    rest = end < 0 ? '' : rest.slice(end + 1)
  }
  return cases
}
/** Peak resident memory of the batch process in KiB, reported by the driver after its last case; null when the process stopped first. */
export function driverPeakKb(stdout: string): number | null {
  const match = /\u001eMANOR-PEAK (\d+)\n/.exec(stdout)
  return match === null ? null : Number(match[1])
}
/** Output printed after the last finished case belongs to the case that was running when the process stopped. */
export function trailingDriverOutput(stdout: string): string {
  const at = stdout.lastIndexOf(marker)
  if (at < 0) return stdout
  const end = stdout.indexOf('\n', at)
  return end < 0 ? '' : stdout.slice(end + 1).replace(/\u001eMANOR-PEAK \d+\n/, '')
}
