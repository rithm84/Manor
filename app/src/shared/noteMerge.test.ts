import { describe, expect, it } from 'vitest'

import { applyBlockOps, mergeDocuments, parseBlocks } from './noteMerge'

const para = (id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, type: 'paragraph', props: { textAlignment: 'left' }, content: [{ type: 'text', text, styles: {} }], children: [], ...extra })
const doc = (...blocks: Record<string, unknown>[]): string => JSON.stringify(blocks)
const base = doc(para('a', 'first'), para('b', 'second'), para('c', 'third'))

describe('mergeDocuments', () => {
  it('merges edits to different blocks and returns the ops that bring the editor to the merged document', () => {
    const mine = doc(para('a', 'first, edited by me'), para('b', 'second'), para('c', 'third'))
    const theirs = doc(para('a', 'first'), para('b', 'second'), para('c', 'third'), para('d', 'appended elsewhere'))
    const outcome = mergeDocuments(base, mine, theirs)
    if (outcome.status !== 'clean') throw new Error('expected a clean merge')
    expect(parseBlocks(outcome.contentJson).map((block) => block.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(outcome.ops).toEqual([{ kind: 'insert', block: para('d', 'appended elsewhere'), afterId: 'c' }])
    expect(applyBlockOps(parseBlocks(mine), outcome.ops)).toEqual(parseBlocks(outcome.contentJson))
  })

  it('reports the block when both sides changed it differently, and when one edited what the other removed', () => {
    const mine = doc(para('a', 'mine'), para('b', 'second'), para('c', 'third'))
    const theirs = doc(para('a', 'theirs'), para('b', 'second'), para('c', 'third'))
    expect(mergeDocuments(base, mine, theirs)).toEqual({ status: 'conflict', blockIds: ['a'] })
    const removed = doc(para('b', 'second'), para('c', 'third'))
    expect(mergeDocuments(base, mine, removed)).toEqual({ status: 'conflict', blockIds: ['a'] })
  })

  it('treats identical edits, removals on both sides, and server key reordering as agreement', () => {
    const mine = doc(para('a', 'same'), para('c', 'third'))
    const theirs = doc({ children: [], content: [{ styles: {}, text: 'same', type: 'text' }], id: 'a', props: { textAlignment: 'left' }, type: 'paragraph' }, para('c', 'third'))
    const outcome = mergeDocuments(base, mine, theirs)
    expect(outcome.status).toBe('clean')
    if (outcome.status === 'clean') expect(outcome.ops).toEqual([])
  })

  it('follows the one side that reordered and conflicts when both did', () => {
    const mine = doc(para('a', 'first!'), para('b', 'second'), para('c', 'third'))
    const theirs = doc(para('c', 'third'), para('a', 'first'), para('b', 'second'))
    const outcome = mergeDocuments(base, mine, theirs)
    if (outcome.status !== 'clean') throw new Error('expected a clean merge')
    expect(parseBlocks(outcome.contentJson).map((block) => [block.id, (block.content as { text: string }[])[0]?.text])).toEqual([['c', 'third'], ['a', 'first!'], ['b', 'second']])
    expect(applyBlockOps(parseBlocks(mine), outcome.ops)).toEqual(parseBlocks(outcome.contentJson))
    const mineReordered = doc(para('b', 'second'), para('a', 'first'), para('c', 'third'))
    expect(mergeDocuments(base, mineReordered, theirs)).toEqual({ status: 'conflict', blockIds: ['order'] })
  })

  it('places a foreign insertion after its nearest surviving neighbor when that neighbor was removed here', () => {
    const mine = doc(para('a', 'first'), para('c', 'third'))
    const theirs = doc(para('a', 'first'), para('b', 'second'), para('x', 'after b'), para('c', 'third'))
    const outcome = mergeDocuments(base, mine, theirs)
    if (outcome.status !== 'clean') throw new Error('expected a clean merge')
    expect(parseBlocks(outcome.contentJson).map((block) => block.id)).toEqual(['a', 'x', 'c'])
  })
})
