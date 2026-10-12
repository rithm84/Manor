import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractFunctionalSections, factAdapter, SourceAccessRequired } from './cloudProblemFacts.ts'

test('functional preludes retain APIs, definitions, and unusual requirement headings', () => {
  const capture = extractFunctionalSections('## The Challenge\nBuild a durable writer.\n### What Must Be True\nAcknowledge only durable bytes.\n### Methods to Implement\npush(bytes) blocks.\n## Part 1: Count Files\nCount only eligible files.\n### API1\nThe tree may be nested.\n## How Encoding Works\nA run records its symbol and length.\n## Solution\nUse this private implementation.\n### Example\nPrivate solution example.')
  assert.ok(capture.description?.includes('Acknowledge only durable bytes.'))
  assert.ok(capture.description?.includes('push(bytes) blocks.'))
  assert.ok(capture.description?.includes('The tree may be nested.'))
  assert.ok(capture.description?.includes('A run records its symbol and length.'))
  assert.ok(!capture.description?.includes('private implementation'))
  assert.ok(!capture.description?.includes('Private solution example.'))
})

test('follow-up requirements survive while their answers and code stay excluded', () => {
  const capture = extractFunctionalSections('## Problem\nCompute the answer.\n## Solution\nPrivate algorithm.\n## Follow-Up\nSupport another mode.\n### New Requirements\nModes have transition costs.\n### How to Solve\nPrivate follow-up algorithm.\n### Code\nprivate code\n## Part 2\nLimit the mode transitions.\n## Notes\nPrivate article notes.')
  assert.ok(capture.description?.includes('Modes have transition costs.'))
  assert.ok(capture.description?.includes('Limit the mode transitions.'))
  assert.ok(!capture.description?.includes('Private'))
  assert.ok(!capture.description?.includes('private code'))
})

test('code fences cannot change section boundaries and absent prompts remain explicit', () => {
  const capture = extractFunctionalSections('## Input Example\n```python\n# Solution\nexample_call()\n```\n## Solution\nDo not capture this answer.')
  assert.ok(capture.description?.includes('# Solution\nexample_call()'))
  assert.ok(!capture.description?.includes('Do not capture this answer.'))
  assert.equal(extractFunctionalSections('## Solution\nAnswer only.').description, null)
  assert.equal(extractFunctionalSections(null).description, null)
})

test('exercise identity stays strict while nullable source tags represent absent labels', () => {
  const id = '8de7a938-8121-411c-8fa5-ce61bd804a8a'
  const href = '/interview/problems/' + id
  const key = [['interview', 'getOJProblem'], { input: { uuid: id, idType: 'uuid' } }]
  const data = { id, slug: null, title: 'Example', description: null, difficulty: null, constraints: null,
    sample_input: null, sample_output: null, company: null, employment_type: null, test_cases: null, summary: null,
    enrichment: { locked: false, tags_en: null } }
  const adapter = factAdapter('interview.getOJProblem')
  assert.deepEqual(adapter.parse(href, new URL(href, 'https://example.com'), key, data).tags, [])
  assert.throws(() => adapter.parse(href, new URL('/interview/problems/another-id', 'https://example.com'), key, data), /identity differs/)
  assert.throws(() => adapter.parse(href, new URL(href, 'https://example.com'), key, { ...data, enrichment: { locked: true } }), SourceAccessRequired)
})
