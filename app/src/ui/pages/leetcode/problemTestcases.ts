import type { ProblemContent, ProblemInterface, ProblemRecord } from '../../../shared/problemLibrary'

type ProblemExample = ProblemContent['examples'][number]

/**
 * Typed problems take one JSON value per line per parameter, one line for a codec's value, or two
 * lines (operation names and argument arrays) for a class. The judge's driver reads that format; these helpers move between it
 * and the labeled fields the console edits.
 */
export interface TestcaseField { readonly name: string; readonly label: string }
export interface Testcase { readonly id: string; readonly values: readonly string[] }
export interface InvalidTestcase { readonly caseIndex: number; readonly fieldIndex: number; readonly message: string }

export function testcaseFields(spec: ProblemInterface): readonly TestcaseField[] {
  if (spec.kind === 'class') return [{ name: 'operations', label: 'Operations' }, { name: 'arguments', label: 'Arguments' }]
  if (spec.kind === 'codec') return [{ name: spec.encode.param.name, label: `${spec.encode.param.name} =` }]
  return spec.params.map(param => ({ name: param.name, label: `${param.name} =` }))
}

function skipString(text: string, start: number): number {
  let index = start + 1
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
  return index + 1
}

/** Removes whitespace outside strings so a value occupies one input line; digits are never reparsed, so 64-bit integers keep their exact text. */
export function compactJson(text: string): string {
  let result = ''
  for (let index = 0; index < text.length;) {
    const character = text[index]
    if (character === '"') { const end = skipString(text, index); result += text.slice(index, end); index = end; continue }
    if (!/\s/.test(character)) result += character
    index += 1
  }
  return result
}

export function isJsonValue(text: string): boolean {
  if (text.trim() === '') return false
  try { JSON.parse(text); return true } catch { return false }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** A value ends at the top-level comma or line break that introduces the next named parameter. */
function valueEnd(text: string, start: number, next: string | null): number {
  if (next === null) return text.length
  const introducesNext = new RegExp(`^[,\\s]*${escapeRegExp(next)}\\s*=`)
  let depth = 0
  for (let index = start; index < text.length;) {
    const character = text[index]
    if (character === '"') { index = skipString(text, index); continue }
    if (character === '[' || character === '{') depth += 1
    else if (character === ']' || character === '}') depth -= 1
    else if (depth === 0 && (character === ',' || character === '\n') && introducesNext.test(text.slice(index))) return index
    index += 1
  }
  return -1
}

function rawLines(text: string): string[] { return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '') }

/**
 * Converts an example's display text back into raw input lines. Function examples read
 * `nums = [2,7,11,15], target = 9` in parameter order, or one JSON value per line; class examples
 * hold the two raw lines. Returns null when the text does not match the interface.
 */
export function parseExampleInput(spec: ProblemInterface, display: string): string[] | null {
  const fields = testcaseFields(spec)
  const lines = rawLines(display)
  if (lines.length === fields.length && lines.every(isJsonValue)) return lines.map(compactJson)
  if (spec.kind === 'class') return null
  const values: string[] = []
  let position = 0
  for (const [index, field] of fields.entries()) {
    const name = new RegExp(`^[,\\s]*${escapeRegExp(field.name)}\\s*=\\s*`).exec(display.slice(position))
    if (name === null) return null
    const start = position + name[0].length
    const end = valueEnd(display, start, fields[index + 1]?.name ?? null)
    if (end < 0) return null
    const value = compactJson(display.slice(start, end).trim())
    if (!isJsonValue(value)) return null
    values.push(value)
    position = end
  }
  return values
}

/** Example cases prefill the console; an example the interface cannot read becomes an empty case to fill in. */
export function exampleTestcases(spec: ProblemInterface, examples: readonly ProblemExample[]): Testcase[] {
  const width = testcaseFields(spec).length
  const cases = examples.map((example, index) => ({ id: `example-${index}`, values: parseExampleInput(spec, example.input) ?? Array.from({ length: width }, () => '') }))
  return cases.length === 0 ? [{ id: 'example-0', values: Array.from({ length: width }, () => '') }] : cases
}

export function firstInvalidTestcase(fields: readonly TestcaseField[], cases: readonly Testcase[]): InvalidTestcase | null {
  for (const [caseIndex, testcase] of cases.entries()) {
    const fieldIndex = testcase.values.findIndex(value => !isJsonValue(value))
    if (fieldIndex >= 0) return { caseIndex, fieldIndex, message: `Case ${caseIndex + 1}: ${fields[fieldIndex].name} needs a JSON value, such as [1,2] or "text".` }
  }
  return null
}

/** Several cases run back to back: each case contributes its fields as consecutive lines. */
export function testcaseInput(cases: readonly Testcase[]): string {
  return cases.map(testcase => testcase.values.map(compactJson).join('\n')).join('\n')
}

export function sameTestcases(left: readonly Testcase[], right: readonly Testcase[]): boolean {
  return left.length === right.length && left.every((testcase, index) => testcase.values.length === right[index].values.length && testcase.values.every((value, field) => compactJson(value) === compactJson(right[index].values[field])))
}

/** A result's raw input splits back into one labeled value per field when it holds exactly one case. */
export function labeledInput(fields: readonly TestcaseField[], input: string): { readonly field: TestcaseField; readonly value: string }[] | null {
  const lines = rawLines(input)
  return lines.length === fields.length ? fields.map((field, index) => ({ field, value: lines[index] })) : null
}

/** Stock entries are keyed `leetcode:<frontend number>`. */
export function leetCodeNumber(problem: Pick<ProblemRecord, 'sourceType' | 'externalKey'>): number | null {
  if (problem.sourceType !== 'stock' || problem.externalKey === null) return null
  const match = /^leetcode:(\d+)$/.exec(problem.externalKey)
  return match === null ? null : Number(match[1])
}

export const TAG_FACETS = ['Round', 'Role', 'Technology', 'Employment'] as const
export type TagFacet = typeof TAG_FACETS[number] | 'Other'
export interface TagFacetGroup { readonly facet: TagFacet; readonly values: readonly { readonly tag: string; readonly label: string }[] }

export function tagFacet(tag: string): { readonly facet: TagFacet; readonly label: string } {
  const facet = TAG_FACETS.find(name => tag.startsWith(`${name}: `))
  return facet === undefined ? { facet: 'Other', label: tag } : { facet, label: tag.slice(facet.length + 2) }
}

/** Evidence tags group by their prefix in a fixed order; unprefixed legacy tags stay visible under Other. */
export function tagFacets(tags: readonly string[]): TagFacetGroup[] {
  return ([...TAG_FACETS, 'Other'] as const).map(facet => ({ facet, values: tags.flatMap(tag => { const parsed = tagFacet(tag); return parsed.facet === facet ? [{ tag, label: parsed.label }] : [] }) })).filter(group => group.values.length > 0)
}

const sectionHeading = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:Constraints|Follow[- ]up)\b[^\n]*$/im
const exampleHeading = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*Example\s*1\b/im

/**
 * LeetCode places examples between the description and its Constraints and Follow-up sections.
 * A statement that already writes its own examples keeps them in place.
 */
export function splitStatement(markdown: string): { readonly description: string; readonly rest: string; readonly hasInlineExamples: boolean } {
  const hasInlineExamples = exampleHeading.test(markdown)
  const match = sectionHeading.exec(markdown)
  if (match === null || hasInlineExamples) return { description: markdown, rest: '', hasInlineExamples }
  return { description: markdown.slice(0, match.index).trimEnd(), rest: markdown.slice(match.index), hasInlineExamples }
}
