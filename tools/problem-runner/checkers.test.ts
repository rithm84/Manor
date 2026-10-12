import { equal, throws } from 'node:assert/strict'
import { matches } from '../../supabase/functions/problem-runner/checkers.ts'

Deno.test('judge preserves exact, normalized text, and ordered JSON contracts', () => {
  equal(matches('answer\n', 'answer', 'exact'), false)
  equal(matches(' answer\r\n', 'answer\n', 'trimmed'), true)
  equal(matches('{"b":2,"a":[1,2]}', '{"a":[1,2],"b":2}', 'json'), true)
  equal(matches('[2,1]', '[1,2]', 'json'), false)
  equal(matches('invalid', 'null', 'json'), false)
  equal(matches('{"n":1e999}', '{"n":1}', 'json'), false)
  equal(matches('anything', null, 'trimmed'), true)
})

Deno.test('numeric judge accepts tolerance and rejects malformed or incorrect output', () => {
  equal(matches('0.333333333\n1e6\n-2', '0.333333 1000000.5 -2.0000001', 'numeric'), true)
  equal(matches('0.0000005', '0', 'numeric'), true)
  equal(matches('0.000002', '0', 'numeric'), false)
  equal(matches('1000002', '1000000', 'numeric'), false)
  for (const actual of ['NaN', 'Infinity', '1e999', '0x10', '', '1 extra', '1 2']) equal(matches(actual, '1', 'numeric'), false)
  for (const expected of ['NaN', '', 'not a number', '1e999']) throws(() => matches('1', expected, 'numeric'), TypeError)
})

Deno.test('unordered JSON judge preserves duplicates and nested sequence semantics', () => {
  equal(matches('[[3,4],[1,2],[1,2]]', '[[1,2],[1,2],[3,4]]', 'json_unordered'), true)
  equal(matches('[{"b":2,"a":1},3]', '[3,{"a":1,"b":2}]', 'json_unordered'), true)
  equal(matches('[]', '[]', 'json_unordered'), true)
  equal(matches('[[2,1],[3,4]]', '[[1,2],[3,4]]', 'json_unordered'), false)
  equal(matches('[1,2]', '[1,1,2]', 'json_unordered'), false)
  equal(matches('{}', '[]', 'json_unordered'), false)
  throws(() => matches('[]', '{}', 'json_unordered'), TypeError)
  throws(() => matches('[]', 'invalid', 'json_unordered'), SyntaxError)
})

Deno.test('JSON judges preserve integer and decimal precision and normalize equivalent numbers', () => {
  equal(matches('[9007199254740992]', '[9007199254740993]', 'json'), false)
  equal(matches('[9007199254740992,1]', '[1,9007199254740993]', 'json_unordered'), false)
  equal(matches('[0.100000000000000001]', '[0.1]', 'json'), false)
  equal(matches('[1000,0.1000,-0]', '[1e3,1e-1,0]', 'json'), true)
  equal(matches('[1e999]', '[10e998]', 'json'), true)
  equal(matches('{"a":1,"a":2}', '{"a":2}', 'json'), true)
  equal(matches('{"__proto__":1}', '{}', 'json'), false)
  equal(matches('["1"]', '[1]', 'json'), false)
})

Deno.test('deep unordered JSON treats every array level as a multiset', () => {
  equal(matches('[["tea","eat"],["nat","tan"],["bat"]]', '[["bat"],["eat","tea"],["tan","nat"]]', 'json_unordered_deep'), true)
  equal(matches('[["eat"],["tea"]]', '[["eat","tea"]]', 'json_unordered_deep'), false)
  equal(matches('[[1,1],[2]]', '[[1],[1,2]]', 'json_unordered_deep'), false)
})

Deno.test('tolerant JSON compares structure exactly and numbers within tolerance', () => {
  equal(matches('[null,1.5,2]', '[null,1.5,2.0]', 'json_tolerant'), true)
  equal(matches('[0.33333333]', '[0.3333333333333333]', 'json_tolerant'), true)
  equal(matches('[0.3334]', '[0.3333333333333333]', 'json_tolerant'), false)
  equal(matches('[1,2]', '[1,2,3]', 'json_tolerant'), false)
  equal(matches('["1"]', '[1]', 'json_tolerant'), false)
  equal(matches('[true,"a"]', '[true,"a"]', 'json_tolerant'), true)
})
