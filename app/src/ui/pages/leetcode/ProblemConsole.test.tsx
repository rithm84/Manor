// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { ProblemSubmission } from '../../../shared/problemExecution'
import { TestcaseEditor } from './ProblemConsole'
import { ProblemTestResult, SubmissionFailure } from './ProblemTestResult'
import { testcaseFields, testcaseInput } from './problemTestcases'
import type { Testcase } from './problemTestcases'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fields = testcaseFields({ kind: 'function', name: 'twoSum', params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]', output: { mode: 'return' } })

async function mount(node: ReactNode): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

function element<T extends Element>(host: HTMLElement, testId: string): T {
  const found = host.querySelector<T>(`[data-testid="${testId}"]`)
  if (found === null) throw new Error(`Missing ${testId}`)
  return found
}

describe('TestcaseEditor', () => {
  it('edits one labeled field per parameter, duplicates the selected case, and removes cases', async () => {
    let latest: readonly Testcase[] = []
    function Harness(): ReactNode {
      const [cases, setCases] = useState<readonly Testcase[]>([{ id: 'a', values: ['[2,7,11,15]', '9'] }, { id: 'b', values: ['[3,3]', '6'] }])
      const [selected, setSelected] = useState(0)
      latest = cases
      return <TestcaseEditor fields={fields} cases={cases} selected={selected} invalid={null} disabled={false} onSelect={setSelected} onCases={(next, index) => { setCases(next); setSelected(index) }} />
    }
    const { host, unmount } = await mount(<Harness />)
    try {
      expect([...host.querySelectorAll('.problem-case-field > span')].map(label => label.textContent)).toEqual(['nums =', 'target ='])
      await act(async () => element<HTMLButtonElement>(host, 'problem-case-1').click())
      const target = element<HTMLTextAreaElement>(host, 'problem-case-field-target')
      expect(target.value).toBe('6')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(target, '10')
        target.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => element<HTMLButtonElement>(host, 'problem-case-add').click())
      expect(latest.map(testcase => testcase.values)).toEqual([['[2,7,11,15]', '9'], ['[3,3]', '10'], ['[3,3]', '10']])
      expect(element<HTMLButtonElement>(host, 'problem-case-2').getAttribute('aria-selected')).toBe('true')
      await act(async () => element<HTMLButtonElement>(host, 'problem-case-remove-0').click())
      expect(testcaseInput(latest)).toBe('[3,3]\n10\n[3,3]\n10')
    } finally {
      await unmount()
    }
  })
})

const base: ProblemSubmission = { id: '00000000-0000-4000-8000-000000000001', problemId: 'two-sum', contentVersion: 1, testsetVersion: 1, language: 'python', mode: 'run', status: 'completed', verdict: 'wrong_answer', passedCases: 1, totalCases: 2, results: [], error: null, createdAt: '2026-10-12T00:00:00Z', finishedAt: '2026-10-12T00:00:01Z' }

describe('ProblemTestResult', () => {
  it('opens on the first failing case with labeled input, printed output, and the expected answer', async () => {
    const { host, unmount } = await mount(<ProblemTestResult fields={fields} submission={{ ...base, results: [
      { id: 'one', passed: true, hidden: false, input: '[2,7]\n9', expectedOutput: '[0,1]', output: '[0,1]', stdout: null, stderr: null, durationMs: 3, memoryKb: 17_000, verdict: 'accepted' },
      { id: 'two', passed: false, hidden: false, input: '[3,3]\n6', expectedOutput: '[0,1]', output: '[1,0]', stdout: 'checking 3\n', stderr: null, durationMs: 4.4, memoryKb: 17_830, verdict: 'wrong_answer' }
    ] }} />)
    try {
      expect(element(host, 'problem-verdict').textContent).toBe('Wrong Answer')
      expect(element(host, 'problem-passed-count').textContent).toBe('Passed test cases: 1 / 2')
      expect(host.textContent).toContain('Runtime: 7 ms')
      expect(host.textContent).toContain('Memory: 17.4 MB')
      const detail = element(host, 'problem-case-detail').textContent
      expect(detail).toContain('target =6')
      expect(detail).toContain('Stdoutchecking 3')
      expect(detail).toContain('Output[1,0]')
      expect(detail).toContain('Expected[0,1]')
    } finally {
      await unmount()
    }
  })

  it('shows compiler output alone and keeps hidden submission cases private', async () => {
    const compiled = await mount(<ProblemTestResult fields={fields} submission={{ ...base, verdict: 'compile_error', results: [{ id: 'one', passed: false, hidden: false, input: null, expectedOutput: null, output: null, stderr: 'main.cpp:3: error: expected ;', durationMs: 0, verdict: 'compile_error' }] }} />)
    try {
      expect(element(compiled.host, 'problem-verdict').textContent).toBe('Compile Error')
      expect(element(compiled.host, 'problem-compile-output').textContent).toBe('main.cpp:3: error: expected ;')
      expect(compiled.host.querySelector('[data-testid="problem-case-detail"]')).toBeNull()
    } finally {
      await compiled.unmount()
    }
    const hidden = await mount(<ProblemTestResult fields={fields} submission={{ ...base, mode: 'submit', results: [{ id: 'one', passed: true, hidden: true, input: null, expectedOutput: null, output: null, stderr: null, durationMs: 2, verdict: 'accepted' }, { id: 'two', passed: false, hidden: true, input: null, expectedOutput: null, output: null, stderr: null, durationMs: 2, verdict: 'time_limit' }] }} />)
    try {
      expect(hidden.host.textContent).toContain('Failed on hidden test case 2.')
      expect(hidden.host.querySelector('[data-testid="problem-case-detail"]')).toBeNull()
    } finally {
      await hidden.unmount()
    }
  })
})

describe('SubmissionFailure', () => {
  it('names an earlier hidden failure and still shows the first failing case the account may see', async () => {
    const { host, unmount } = await mount(<SubmissionFailure fields={fields} submission={{ ...base, mode: 'submit', results: [
      { id: 'one', passed: true, hidden: false, input: '[2,7]\n9', expectedOutput: '[0,1]', output: '[0,1]', stderr: null, durationMs: 1, verdict: 'accepted' },
      { id: 'two', passed: false, hidden: true, input: null, expectedOutput: null, output: null, stderr: null, durationMs: 1, verdict: 'wrong_answer' },
      { id: 'three', passed: false, hidden: false, input: '[3,3]\n6', expectedOutput: '[0,1]', output: '[]', stderr: null, durationMs: 1, verdict: 'wrong_answer' }
    ] }} />)
    try {
      expect(host.textContent).toContain('Failed on hidden test case 2. Test case 3 also failed.')
      expect(element(host, 'problem-case-detail').textContent).toContain('Output[]')
    } finally {
      await unmount()
    }
  })
})
