import { LosslessNumber, parse, splitNumber } from 'npm:lossless-json@4.3.1'
import { z } from 'npm:zod@4.1.12'

export const checkers = ['exact', 'trimmed', 'json', 'numeric', 'json_unordered', 'json_unordered_deep', 'json_tolerant', 'special'] as const
export type Checker = typeof checkers[number]
type Json = string | boolean | null | LosslessNumber | Json[] | { [key: string]: Json }
const jsonSchema: z.ZodType<Json> = z.custom<Json>(value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value instanceof LosslessNumber) return true
  if (Array.isArray(value)) return value.every(child => jsonSchema.safeParse(child).success)
  return typeof value === 'object' && Object.values(value).every(child => jsonSchema.safeParse(child).success)
})

const numericToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const numericTolerance = 1e-6

function canonicalJson(value: Json): string {
  if (value instanceof LosslessNumber) {
    const number = splitNumber(value.value)
    if (!Number.isSafeInteger(number.exponent)) throw new RangeError('JSON judge output has an exponent outside the exact supported range')
    return number.sign + number.digits + 'e' + number.exponent
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
}

function jsonAnswer(text: string): Json {
  return jsonSchema.parse(parse(text, null, { onDuplicateKey: ({ newValue }) => newValue }))
}

function unorderedJson(value: Json): string {
  if (!Array.isArray(value)) throw new TypeError('Unordered JSON testset expected output must be a top-level array')
  return '[' + value.map(canonicalJson).sort().join(',') + ']'
}

/** Every array level is a multiset, for answers whose groups and members may appear in any order. */
function deepUnorderedJson(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(deepUnorderedJson).sort().join(',') + ']'
  if (value !== null && typeof value === 'object' && !(value instanceof LosslessNumber)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + deepUnorderedJson(value[key])).join(',') + '}'
  return canonicalJson(value)
}

/** Structure must match exactly; each number may differ by the numeric checker's tolerance. */
function tolerantEqual(actual: Json, expected: Json): boolean {
  if (expected instanceof LosslessNumber) {
    if (!(actual instanceof LosslessNumber)) return false
    const want = Number(expected.value); const got = Number(actual.value)
    return Number.isFinite(want) && Number.isFinite(got) && Math.abs(got - want) <= numericTolerance * Math.max(1, Math.abs(want))
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => tolerantEqual(actual[index], item))
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual) || actual instanceof LosslessNumber) return false
    const keys = Object.keys(expected).sort()
    return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(keys) && keys.every(key => tolerantEqual(actual[key], expected[key]))
  }
  return canonicalJson(actual) === canonicalJson(expected)
}

function jsonMatches(output: string, expected: string, checker: 'json' | 'json_unordered' | 'json_unordered_deep' | 'json_tolerant'): boolean {
  const answer = jsonAnswer(expected)
  const expectedCanonical = checker === 'json_unordered' ? unorderedJson(answer) : checker === 'json_unordered_deep' ? deepUnorderedJson(answer) : checker === 'json_tolerant' ? '' : canonicalJson(answer)
  try {
    const actual = jsonAnswer(output)
    if (checker === 'json_tolerant') return tolerantEqual(actual, answer)
    if (checker === 'json_unordered_deep') return deepUnorderedJson(actual) === expectedCanonical
    if (checker === 'json_unordered') {
      if (!Array.isArray(actual)) return false
      return unorderedJson(actual) === expectedCanonical
    }
    return canonicalJson(actual) === expectedCanonical
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError || error instanceof z.ZodError) return false
    throw error
  }
}

function numbers(text: string): number[] | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const tokens = trimmed.split(/\s+/)
  if (tokens.some(token => !numericToken.test(token))) return null
  const values = tokens.map(Number)
  return values.every(Number.isFinite) ? values : null
}

/** Numeric output uses absolute tolerance 1e-6 near zero and relative tolerance 1e-6 otherwise. */
function numericMatches(output: string, expected: string): boolean {
  const answer = numbers(expected)
  if (answer === null) throw new TypeError('Numeric testset expected output must contain finite decimal numbers separated by whitespace')
  const actual = numbers(output)
  return actual !== null && actual.length === answer.length && actual.every((value, index) => Math.abs(value - answer[index]) <= numericTolerance * Math.max(1, Math.abs(answer[index])))
}

/** Unordered JSON compares a top-level multiset; nested array order and duplicate counts remain significant. */
export function matches(output: string, expected: string | null, checker: Checker): boolean {
  if (expected === null) return true
  if (checker === 'exact') return output === expected
  if (checker === 'trimmed') return output.replaceAll('\r\n', '\n').trim() === expected.replaceAll('\r\n', '\n').trim()
  if (checker === 'numeric') return numericMatches(output, expected)
  if (checker === 'special') throw new Error('Special checkers are decided by their judge, not by output comparison')
  return jsonMatches(output, expected, checker)
}
