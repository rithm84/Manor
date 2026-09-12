import { FILE_VERIFICATION_CHUNK_BYTES, MAX_FILE_UPLOAD_BYTES } from './fileUploadPolicy.ts'
import { manorTools, type JsonObject, type JsonValue, type ManorTool } from './toolCatalog.ts'

export interface ManorToolClient { rpc(name: string, parameters: JsonObject): Promise<JsonValue>; invoke(name: string, parameters: JsonObject): Promise<JsonValue> }
export function findManorTool(name: string): ManorTool {
  const tool = manorTools.find((candidate: ManorTool): boolean => candidate.name === name)
  if (!tool) throw new Error(`Unsupported Manor tool: ${name}`)
  return tool
}
function object(value: JsonValue): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Tool arguments must be objects')
  return value
}
/** Advance private server checkpoints within one host tool call; never accept caller state. */
async function finalizeFile(input: JsonObject, client: ManorToolClient): Promise<JsonValue> {
  const id = input.id
  if (typeof id !== 'string') throw new TypeError('File verification requires an upload ID')
  let verifiedBytes = 0
  let totalBytes: number | null = null
  let maximumSteps = Math.ceil(MAX_FILE_UPLOAD_BYTES / FILE_VERIFICATION_CHUNK_BYTES) + 1
  for (let step = 0; step < maximumSteps; step++) {
    const result = object(await client.invoke('file-finalize', { id }))
    if (result.id !== id) throw new Error('File verification returned a different upload ID')
    if (result.status === 'ready') {
      if (typeof result.size !== 'number' || !Number.isSafeInteger(result.size) || result.size < 1 || result.size > MAX_FILE_UPLOAD_BYTES || (totalBytes !== null && result.size !== totalBytes)) throw new Error('Finalized file size differs from verification progress')
      return result
    }
    if (result.status !== 'verifying') throw new Error('The uploaded file has not been finalized')
    const total = result.total_bytes
    const verified = result.verified_bytes
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 1 || total > MAX_FILE_UPLOAD_BYTES || (totalBytes !== null && total !== totalBytes)) throw new Error('File verification returned an invalid total size')
    if (typeof verified !== 'number' || !Number.isSafeInteger(verified) || verified <= verifiedBytes || verified >= total) throw new Error('File verification did not advance. Retry finalization to resume the saved checkpoint.')
    totalBytes = total
    verifiedBytes = verified
    maximumSteps = Math.ceil(total / FILE_VERIFICATION_CHUNK_BYTES) + 1
  }
  throw new Error('File verification exceeded its bounded steps. Retry finalization to resume the saved checkpoint.')
}

/** Call only after validating input against the selected tool's shared JSON Schema. */
export async function executeManorTool(name: string, input: JsonObject, client: ManorToolClient): Promise<JsonValue> {
  const tool = findManorTool(name)
  const execution = tool.execution
  if (name === 'finalize_file_upload') return finalizeFile(input, client)
  if (execution.kind === 'edge') return client.invoke(execution.function, { ...input, ...execution.fixedInput })
  if (execution.kind === 'query') return client.rpc(execution.rpc, { p_query: execution.query, p_input: input })
  if (execution.kind === 'rpc') {
    const parameters: JsonObject = {}
    for (const [key, parameter] of Object.entries(execution.argumentMap)) parameters[parameter] = input[key]
    return client.rpc(execution.rpc, parameters)
  }
  if (execution.kind === 'lifecycle_batch') {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new TypeError('Lifecycle batch requires 1 to 50 items')
    const commands: JsonValue[] = input.items.map((item: JsonValue): JsonObject => {
      const fields = object(item)
      if (Object.keys(fields).some(key => !['command_id', 'module', 'id', 'expected_revision'].includes(key))) throw new TypeError('Lifecycle items accept only command_id, module, id, and expected_revision')
      const { command_id, module, id, expected_revision } = fields
      if (typeof module !== 'string' || !Object.hasOwn(execution.operations, module)) throw new TypeError('This lifecycle tool does not support the selected module')
      return { command_id, operation: execution.operations[module], input: { id, expected_revision } }
    })
    return client.rpc('manor_batch', { p_commands: commands })
  }
  if (execution.kind === 'batch') {
    if (!Array.isArray(input.items)) throw new TypeError('Batch requires an items array')
    const commands: JsonValue[] = input.items.map((item: JsonValue): JsonObject => {
      const { command_id, ...fields } = object(item)
      return { command_id, operation: execution.operation, input: fields }
    })
    return client.rpc('manor_batch', { p_commands: commands })
  }
  const { command_id, ...fields } = input
  return client.rpc('manor_command', { p_command_id: command_id, p_operation: execution.operation, p_input: fields })
}
