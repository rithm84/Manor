import { deepEqual, equal } from 'node:assert/strict'
import { chunk, gradeChunk } from '../../supabase/functions/problem-runner/batch.ts'
import { matches } from '../../supabase/functions/problem-runner/checkers.ts'

const process = (stdout: string, extra: Partial<{ exitCode: number; timedOut: boolean; outputLimit: boolean; stderr: string }> = {}) => ({ stdout, stderr: extra.stderr ?? '', exitCode: extra.exitCode ?? 0, durationMs: 50, timedOut: extra.timedOut ?? false, outputLimit: extra.outputLimit ?? false })
const accepts = (test: { expectedOutput: string | null }, output: string): boolean => matches(output, test.expectedOutput, 'json')
const tests = [
  { id: 'a', input: '[1]\n', expectedOutput: '1', hidden: false },
  { id: 'b', input: '[2]\n', expectedOutput: '2', hidden: true },
  { id: 'c', input: '[3]\n', expectedOutput: '3', hidden: false },
]

Deno.test('graded chunks attribute printed output, answers, and stops to the right cases', () => {
  const results = gradeChunk(tests, process('debug a\n\u001eMANOR 0 3 1\n\u001eMANOR 1 2 5\nlooping', { timedOut: true, exitCode: -9 }), accepts)
  deepEqual(results.map(r => r.verdict), ['accepted', 'wrong_answer', 'time_limit'])
  equal(results[0].stdout, 'debug a\n'); equal(results[0].durationMs, 3)
  equal(results[1].output, null); equal(results[1].expectedOutput, null)
  equal(results[2].stdout, 'looping')
})

Deno.test('a caught exception fails its case and later cases still run', () => {
  const results = gradeChunk(tests, process('\u001eMANOR 0 1 !\n\u001eMANOR 1 1 2\n\u001eMANOR 2 1 3\n', { stderr: 'IndexError' }), accepts)
  deepEqual(results.map(r => r.verdict), ['runtime_error', 'accepted', 'accepted'])
  equal(results[0].stderr, 'IndexError')
})

Deno.test('a crash marks the running case and reports later cases as not run', () => {
  const results = gradeChunk(tests, process('\u001eMANOR 0 1 1\n', { exitCode: 139, stderr: 'Segmentation fault' }), accepts)
  deepEqual(results.map(r => r.verdict), ['accepted', 'runtime_error', 'runtime_error'])
  equal(results[2].stderr, 'Not run because the program stopped on an earlier case.')
  equal(results[1].stderr, null)
})

Deno.test('heavy inputs run alone and chunks respect the case limit', () => {
  const heavy = { id: 'h', input: 'x'.repeat(70000), expectedOutput: '1', hidden: true }
  const many = Array.from({ length: 85 }, (_, i) => ({ id: String(i), input: '[1]\n', expectedOutput: '1', hidden: true }))
  const groups = chunk([...many.slice(0, 5), heavy, ...many.slice(5)])
  deepEqual(groups.map(g => g.length), [5, 1, 40, 40])
})

Deno.test('batch peak memory reaches every case of its chunk', () => {
  const results = gradeChunk(tests, process('\u001eMANOR 0 1 1\n\u001eMANOR 1 1 2\n\u001eMANOR 2 1 3\n\u001eMANOR-PEAK 10240\n'), accepts)
  deepEqual(results.map(r => r.memoryKb), [10240, 10240, 10240])
  equal(gradeChunk(tests, process('\u001eMANOR 0 1 1\n', { exitCode: 139 }), accepts)[0].memoryKb, null)
})
