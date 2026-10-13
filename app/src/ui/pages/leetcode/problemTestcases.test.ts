import { describe, expect, it } from 'vitest'
import type { ProblemInterface } from '../../../shared/problemLibrary'
import { exampleAssignments, exampleTestcases, problemTitle, firstInvalidTestcase, labeledInput, leetCodeNumber, parseExampleInput, sameTestcases, splitStatement, tagFacets, testcaseFields, testcaseInput } from './problemTestcases'

const twoSum: ProblemInterface = { kind: 'function', name: 'twoSum', params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]', output: { mode: 'return' } }
const words: ProblemInterface = { kind: 'function', name: 'join', params: [{ name: 's', type: 'string' }, { name: 'grid', type: 'list<list<string>>' }, { name: 'k', type: 'long' }], returns: 'string', output: { mode: 'return' } }
const lru: ProblemInterface = { kind: 'class', className: 'LRUCache', constructorParams: [{ name: 'capacity', type: 'int' }], methods: [{ name: 'get', params: [{ name: 'key', type: 'int' }], returns: 'int' }] }

describe('example display parsing', () => {
  it('reads named values in parameter order, including strings that contain separators and multi-line arrays', () => {
    expect(parseExampleInput(twoSum, 'nums = [2,7,11,15], target = 9')).toEqual(['[2,7,11,15]', '9'])
    expect(parseExampleInput(words, 's = "a, k = b", grid = [["x", "y"],\n ["z"]], k = 9007199254740993')).toEqual(['"a, k = b"', '[["x","y"],["z"]]', '9007199254740993'])
    expect(parseExampleInput(twoSum, 'nums = [1]\ntarget = -3')).toEqual(['[1]', '-3'])
  })

  it('accepts raw lines and class operations, and rejects text that does not match the interface', () => {
    expect(parseExampleInput(twoSum, '[3,3]\n6')).toEqual(['[3,3]', '6'])
    expect(parseExampleInput(lru, '["LRUCache", "get"]\n[[2], [1]]')).toEqual(['["LRUCache","get"]', '[[2],[1]]'])
    expect(parseExampleInput(twoSum, 'target = 9, nums = [1]')).toBeNull()
    expect(parseExampleInput(twoSum, 'nums = [1, target = 9')).toBeNull()
    expect(parseExampleInput(lru, 'LRUCache get')).toBeNull()
  })

  it('prefills one case per example, with an empty case for an unreadable example', () => {
    const cases = exampleTestcases(twoSum, [{ input: 'nums = [2,7], target = 9', output: '[0,1]', explanation: null }, { input: 'see picture', output: '[]', explanation: null }])
    expect(cases.map(testcase => testcase.values)).toEqual([['[2,7]', '9'], ['', '']])
    expect(exampleTestcases(lru, []).map(testcase => testcase.values)).toEqual([['', '']])
  })
})

describe('console test cases', () => {
  it('runs edited cases back to back as one JSON value per line and reports the first invalid field', () => {
    const fields = testcaseFields(twoSum)
    expect(fields.map(field => field.label)).toEqual(['nums =', 'target ='])
    const cases = [{ id: 'a', values: ['[2, 7]', '9'] }, { id: 'b', values: ['[\n 1,\n 2\n]', '3'] }]
    expect(testcaseInput(cases)).toBe('[2,7]\n9\n[1,2]\n3')
    expect(firstInvalidTestcase(fields, cases)).toBeNull()
    expect(firstInvalidTestcase(fields, [...cases, { id: 'c', values: ['[1]', 'nine'] }])).toEqual({ caseIndex: 2, fieldIndex: 1, message: 'Case 3: target needs a JSON value, such as [1,2] or "text".' })
    expect(sameTestcases(cases, [{ id: 'x', values: ['[2,7]', '9'] }, { id: 'y', values: ['[1,2]', '3'] }])).toBe(true)
    expect(sameTestcases(cases, cases.slice(1))).toBe(false)
  })

  it('labels a result input only when it holds exactly one case', () => {
    const fields = testcaseFields(twoSum)
    expect(labeledInput(fields, '[2,7]\n9\n')?.map(item => `${item.field.label} ${item.value}`)).toEqual(['nums = [2,7]', 'target = 9'])
    expect(labeledInput(fields, '[2,7]\n9\n[1]\n2')).toBeNull()
  })
})

describe('problem presentation helpers', () => {
  it('derives the LeetCode number only for stock keys', () => {
    expect(leetCodeNumber({ sourceType: 'stock', externalKey: 'leetcode:146' })).toBe(146)
    expect(leetCodeNumber({ sourceType: 'imported', externalKey: 'leetcode:146' })).toBeNull()
    expect(leetCodeNumber({ sourceType: 'stock', externalKey: 'two-sum' })).toBeNull()
  })

  it('groups evidence tags by facet in a fixed order', () => {
    expect(tagFacets(['Technology: Python', 'Round: Onsite', 'Legacy', 'Round: Phone screen', 'Role: Backend'])).toEqual([
      { facet: 'Round', values: [{ tag: 'Round: Onsite', label: 'Onsite' }, { tag: 'Round: Phone screen', label: 'Phone screen' }] },
      { facet: 'Role', values: [{ tag: 'Role: Backend', label: 'Backend' }] },
      { facet: 'Technology', values: [{ tag: 'Technology: Python', label: 'Python' }] },
      { facet: 'Other', values: [{ tag: 'Legacy', label: 'Legacy' }] }
    ])
  })

  it('places examples before Constraints unless the statement already includes them', () => {
    expect(splitStatement('Find two numbers.\n\n**Constraints:**\n\n- `2 <= n`\n\n**Follow-up:** Faster?')).toEqual({ description: 'Find two numbers.', rest: '**Constraints:**\n\n- `2 <= n`\n\n**Follow-up:** Faster?', hasInlineExamples: false })
    expect(splitStatement('Text\n\n**Example 1:**\n\nInput\n\n## Constraints').rest).toBe('')
    expect(splitStatement('No sections here').description).toBe('No sections here')
  })
})

describe('exampleAssignments', () => {
  it('splits between top-level name = value pairs and keeps commas inside values', () => {
    expect(exampleAssignments('weights = [1,3,4], values = [15, 20, 30], capacity = 4')).toEqual(['weights = [1,3,4],', 'values = [15, 20, 30],', 'capacity = 4'])
    expect(exampleAssignments('s = "a, b = c", k = 2')).toEqual(['s = "a, b = c",', 'k = 2'])
    expect(exampleAssignments('[1,2,3]')).toEqual(['[1,2,3]'])
  })
})

describe('problemTitle', () => {
  it('puts the LeetCode number inside a stock title and leaves other titles as stored', () => {
    expect(problemTitle({ sourceType: 'stock', externalKey: 'leetcode:636', name: 'Exclusive Time of Functions' })).toBe('636. Exclusive Time of Functions')
    expect(problemTitle({ sourceType: 'custom', externalKey: null, name: '0/1 Knapsack' })).toBe('0/1 Knapsack')
  })
})
