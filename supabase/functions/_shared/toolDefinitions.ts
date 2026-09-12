/** Public tool contracts shared by the live browser and remote MCP adapters. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface JsonObject { [key: string]: JsonValue }
export type ToolSchema = {
  type?: 'null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string' | ('null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string')[]
  properties?: { [key: string]: ToolSchema }
  required?: string[]
  additionalProperties?: boolean
  items?: ToolSchema
  enum?: (string | number | null)[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  description?: string
}
export type ToolExecution =
  | { kind: 'edge'; function: string; fixedInput: JsonObject }
  | { kind: 'query'; query: string; rpc: string }
  | { kind: 'command'; operation: string }
  | { kind: 'batch'; operation: string }
  | { kind: 'lifecycle_batch'; operations: { [module: string]: string } }
  | { kind: 'rpc'; rpc: string; argumentMap: { [key: string]: string } }
export interface ManorTool {
  name: string
  description: string
  inputSchema: ToolSchema
  execution: ToolExecution
  readOnly: boolean
}
export const id: ToolSchema = { type: 'string', minLength: 1, maxLength: 200 }
export const uuid: ToolSchema = { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' }
export const revision: ToolSchema = { type: 'integer', minimum: 0 }
export const text: ToolSchema = { type: 'string', maxLength: 100000 }
export const date: ToolSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
export const timestamp: ToolSchema = { type: 'string', maxLength: 40 }
export const nullableText: ToolSchema = { type: ['string', 'null'], maxLength: 2000 }
export const blocks: ToolSchema = { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 10000 }
export const block: ToolSchema = { type: ['object', 'null'], additionalProperties: true }
export const paging = { limit: { type: 'integer', minimum: 1, maximum: 200 } as ToolSchema, cursor: id }
export const period = { from: date, to: date }
export function object(properties: { [key: string]: ToolSchema }, required: string[]): ToolSchema { return { type: 'object', properties, required, additionalProperties: false } }
export function query(name: string, description: string, properties: { [key: string]: ToolSchema }, required: string[]): ManorTool {
  return { name, description, inputSchema: object(properties, required), execution: { kind: 'query', query: name, rpc: 'manor_query' }, readOnly: true }
}
export function command(name: string, description: string, properties: { [key: string]: ToolSchema }, required: string[]): ManorTool {
  return { name, description, inputSchema: object({ command_id: uuid, ...properties }, ['command_id', ...required]), execution: { kind: 'command', operation: name }, readOnly: false }
}
export function batch(name: string, operation: string, description: string, properties: { [key: string]: ToolSchema }, required: string[]): ManorTool {
  return { name, description, inputSchema: object({ items: { type: 'array', minItems: 1, maxItems: 50, items: object({ command_id: uuid, ...properties }, ['command_id', ...required]) } }, ['items']), execution: { kind: 'batch', operation }, readOnly: false }
}
export const edit = { id, expected_revision: revision }

export function domainQuery(name: string, rpc: string, description: string, properties: { [key: string]: ToolSchema }, required: string[]): ManorTool {
  return { ...query(name, description, properties, required), execution: { kind: 'query', query: name, rpc } }
}
