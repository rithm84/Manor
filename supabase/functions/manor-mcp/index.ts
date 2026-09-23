import { Server } from 'npm:@modelcontextprotocol/sdk@1.30.0/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.30.0/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolRequest } from 'npm:@modelcontextprotocol/sdk@1.30.0/types.js'
import { createRemoteJWKSet, jwtVerify, errors as jwtErrors } from 'npm:jose@6.2.12'
import { z } from 'npm:zod@4.5.0'
import { manorTools, type JsonObject, type JsonValue } from '../_shared/toolCatalog.ts'
import { markdownToNoteBlocks } from '../_shared/markdownImport.ts'
import { executeManorTool, findManorTool, type ManorToolClient } from '../_shared/toolExecution.ts'
import { OriginNotAllowedError, originHeaders, requestOrigin } from '../_shared/origins.ts'

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing MCP configuration: ${name}`)
  return value
}
const supabaseUrl = requiredEnvironment('SUPABASE_URL')
const resource = requiredEnvironment('MANOR_MCP_RESOURCE')
const issuer = `${supabaseUrl}/auth/v1`
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
const claimsSchema = z.object({ sub: z.string().uuid(), client_id: z.string().uuid(), role: z.literal('authenticated'), manor_scope: z.string(), exp: z.number(), session_id: z.string().uuid() })
const accessSchema = z.object({ read: z.boolean(), write: z.boolean() })
const apiErrorSchema = z.object({ code: z.string(), message: z.string(), details: z.string().nullable().optional(), hint: z.string().nullable().optional() })

class ManorRpcError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: string | null) { super(message); this.name = 'ManorRpcError' }
}
class UserRpcClient implements ManorToolClient {
  constructor(private readonly token: string) {}
  async rpc(name: string, parameters: JsonObject): Promise<JsonValue> {
    return this.request('rest/v1/rpc', name, parameters)
  }
  async invoke(name: string, parameters: JsonObject): Promise<JsonValue> {
    return this.request('functions/v1', name, parameters)
  }
  convertMarkdown(markdown: string, assets: Readonly<Record<string, JsonValue>>) {
    return markdownToNoteBlocks(markdown, assets)
  }
  private async request(route: string, name: string, parameters: JsonObject): Promise<JsonValue> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response
      try {
        response = await fetch(`${supabaseUrl}/${route}/${name}`, { method: 'POST', headers: { apikey: requiredEnvironment('SUPABASE_ANON_KEY'), Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parameters), signal: AbortSignal.timeout(20000) })
      } catch (error) {
        if (!(error instanceof TypeError || error instanceof DOMException) || attempt === 3) throw error
        console.warn('manor_mcp_rpc_retry', { rpc: name, attempt, reason: error.name })
        await new Promise<void>((resolve) => setTimeout(resolve, attempt * 250))
        continue
      }
      if (response.status >= 500 && attempt < 3) {
        console.warn('manor_mcp_rpc_retry', { rpc: name, attempt, status: response.status })
        await response.body?.cancel()
        await new Promise<void>((resolve) => setTimeout(resolve, attempt * 250))
        continue
      }
      const result = await response.json()
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(result)
        if (!parsed.success) throw new ManorRpcError(response.status, 'edge_request_failed', `Manor endpoint ${name} failed: ${JSON.stringify(result)}`, null)
        const error = parsed.data
        throw new ManorRpcError(response.status, error.code, error.message, error.details ?? null)
      }
      return z.json().parse(result) as JsonValue
    }
    throw new Error(`RPC retry state exhausted for ${name}`)
  }
}
function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: message }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"` } })
}

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return Response.json({ resource, authorization_servers: [issuer], scopes_supported: ['openid', 'profile', 'email'], bearer_methods_supported: ['header'], resource_name: 'Manor' })
  }
  let origin: string | null
  try { origin = requestOrigin(request) }
  catch (error) { if (error instanceof OriginNotAllowedError) return new Response(error.message, { status: 403 }); throw error }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...originHeaders(origin), 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS' } })
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return unauthorized('Connect an authorized Manor OAuth client')
  const token = authorization.slice(7)
  let claims: z.infer<typeof claimsSchema>
  try {
    const verified = await jwtVerify(token, jwks, { issuer, audience: resource, algorithms: ['ES256', 'RS256'] })
    claims = claimsSchema.parse(verified.payload)
  } catch (error) {
    if (error instanceof jwtErrors.JOSEError || error instanceof z.ZodError) return unauthorized('The OAuth access token is invalid or expired')
    throw error
  }
  if (!claims.manor_scope.split(' ').includes('manor:read')) return unauthorized('This authorization does not include Manor read access')
  const client = new UserRpcClient(token)
  const access = accessSchema.parse(await client.rpc('manor_mcp_access', {}))
  if (!access.read) return unauthorized('Manor access was revoked')
  const server = new Server({ name: 'manor', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: manorTools.filter((tool) => tool.readOnly || access.write).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { ...tool.inputSchema, type: 'object' as const }, annotations: { readOnlyHint: tool.readOnly, destructiveHint: /^(trash|delete|remove)_/.test(tool.name), idempotentHint: true, openWorldHint: false } })) }))
  server.setRequestHandler(CallToolRequestSchema, async (message: CallToolRequest) => {
    try {
      const tool = findManorTool(message.params.name)
      if (!tool.readOnly && (!access.write || !claims.manor_scope.split(' ').includes('manor:write'))) throw new ManorRpcError(403, 'write_not_authorized', 'This OAuth authorization is read-only', null)
      const input = z.fromJSONSchema(tool.inputSchema).parse(message.params.arguments ?? {}) as JsonObject
      const result = await executeManorTool(tool.name, input, client)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    } catch (error) {
      if (error instanceof ManorRpcError) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code: error.code, message: error.message, details: error.details, status: error.status }) }] }
      if (error instanceof Error) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code: error.name, message: error.message }) }] }
      throw error
    }
  })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  await server.close()
  for (const [name, value] of Object.entries(originHeaders(origin))) response.headers.set(name, value)
  return response
})
