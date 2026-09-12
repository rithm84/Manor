import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { browserToolDescriptors } from './browserTools'
import { manorTools, type JsonObject } from '../../../supabase/functions/_shared/toolCatalog'
import { assertBrowserDescriptorBudget, browserToolGroups, buildBrowserToolCatalog, resolveBrowserOperation, type BrowserToolGroup } from './browserToolCatalog'

function group(name: string): BrowserToolGroup {
  const result = browserToolGroups.find(candidate => candidate.name === name)
  if (!result) throw new Error(`Missing browser group ${name}`)
  return result
}

const update: JsonObject = {
  operation: 'update_note', input: { command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id: 'note-a', expected_revision: 3, title: 'Revised title' }
}

describe('grouped browser tool contracts', () => {
  it('keeps all shared groups and live browser descriptors below the host budget including metadata', () => {
    const descriptors = [...browserToolGroups.map(candidate => ({ name: candidate.name, description: candidate.description,
      inputSchema: candidate.inputSchema, annotations: { readOnlyHint: candidate.readOnly, untrustedContentHint: true } })), ...browserToolDescriptors()]
    expect(browserToolDescriptors()).toHaveLength(9)
    expect(() => assertBrowserDescriptorBudget(descriptors)).not.toThrow()
    const bytes = new TextEncoder().encode(JSON.stringify(descriptors)).byteLength
    expect(bytes).toBeLessThan(60_000)
    expect(bytes + descriptors.length * 200).toBeLessThanOrEqual(65_536)
    expect(() => assertBrowserDescriptorBudget([...descriptors, ...descriptors])).toThrow('supported budget')
  })

  it('partitions all shared operations exactly once and preserves read-only authorization boundaries', () => {
    const operations = browserToolGroups.flatMap(candidate => candidate.operations)
    expect(operations).toHaveLength(manorTools.length)
    expect(new Set(operations.map(tool => tool.name)).size).toBe(manorTools.length)
    for (const candidate of browserToolGroups) {
      expect(candidate.operations.every(tool => tool.readOnly === candidate.readOnly)).toBe(true)
    }
    expect(() => buildBrowserToolCatalog([...manorTools, { ...manorTools[0]!, name: 'unassigned_future_operation' }])).toThrow('lack an explicit browser domain')
    expect(() => buildBrowserToolCatalog([...manorTools, manorTools[0]!])).toThrow('duplicate operation')
  })

  it('validates the registered union and resolves to the unchanged shared command schema', () => {
    const candidate = group('write_notes')
    expect(z.fromJSONSchema(candidate.inputSchema).parse(update)).toEqual(update)
    const resolved = resolveBrowserOperation(candidate, update)
    expect(resolved.tool).toBe(manorTools.find(tool => tool.name === 'update_note'))
    expect(resolved.fields).toEqual(update.input)
    expect(() => resolveBrowserOperation(group('read_notes'), update)).toThrow('does not support')
    const missingRevision = { operation: 'update_note', input: { command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id: 'note-a', title: 'Unsafe edit' } }
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse(missingRevision)).toThrow()
    expect(() => resolveBrowserOperation(candidate, missingRevision)).toThrow()
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse({ ...update, input: { ...update.input as JsonObject, expected_revision: -1 } })).toThrow()
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse({ ...update, input: { ...update.input as JsonObject, command_id: 'not-a-uuid' } })).toThrow()
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse({ ...update, input: { ...update.input as JsonObject, surprise: true } })).toThrow()
  })

  it('keeps typed lifecycle items and rejects user-supplied operations or unknown envelope fields', () => {
    const request: JsonObject = { operation: 'trash_records', input: { items: [
      { command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', module: 'notes', id: 'note-a', expected_revision: 1 }
    ] } }
    const candidate = group('write_workspace')
    expect(z.fromJSONSchema(candidate.inputSchema).parse(request)).toEqual(request)
    expect(resolveBrowserOperation(candidate, request).tool.execution.kind).toBe('lifecycle_batch')
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse({ operation: 'trash_records', input: { items: [
      { command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', module: 'notes', id: 'note-a', expected_revision: 1, operation: 'delete_everything' }
    ] } })).toThrow()
    expect(() => z.fromJSONSchema(candidate.inputSchema).parse({ operation: 'trash_records', input: { items: [
      { command_id: 'bad', module: 'notes', id: 'note-a', expected_revision: -1 }
    ] } })).toThrow()
    expect(() => resolveBrowserOperation(candidate, { ...request, sql: 'select 1' })).toThrow()
    expect(() => resolveBrowserOperation(candidate, { operation: 'trash_records', input: { items: [
      { command_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', module: 'notes', id: 'note-a', expected_revision: 1, operation: 'delete_everything' }
    ] } })).toThrow()
  })
})
