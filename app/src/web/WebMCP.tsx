import { useEffect } from 'react'
import { z } from 'zod'
import { type JsonObject, type JsonValue, type ToolSchema } from '../../../supabase/functions/_shared/toolCatalog'
import { executeManorTool } from '../../../supabase/functions/_shared/toolExecution'
import { ManorGateway, ManorRequestError } from './ManorGateway'
import type { NotesApi } from '../shared/notes'
import { assertDraftsUnaffected, createBrowserTools } from './browserTools'
import { assertBrowserDescriptorBudget, browserToolGroups, resolveBrowserOperation } from './browserToolCatalog'

interface SiteTool {
  name: string
  description: string
  inputSchema: ToolSchema
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute(input: JsonObject): Promise<JsonValue>
}
interface SiteModelContext {
  registerTool(tool: SiteTool, options: { signal: AbortSignal }): Promise<void>
}
declare global { interface Document { modelContext?: SiteModelContext } }

/** Live tools share the remote contracts, while browser-only tools expose protected draft state. */
export function WebMCP({ gateway, notes, onFailure }: {
  gateway: ManorGateway; notes: NotesApi; onFailure(message: string): void
}): null {
  useEffect(() => {
    const context = document.modelContext
    if (typeof context?.registerTool !== 'function') return
    const registration = new AbortController()
    const rpc = async (name: string, parameters: JsonObject): Promise<JsonValue> => {
      registration.signal.throwIfAborted()
      const { data, error } = await gateway.client.rpc(name, parameters)
      if (error) throw new ManorRequestError(name, error.code, error.message)
      return z.json().parse(data)
    }
    const invoke = async (name: string, parameters: JsonObject): Promise<JsonValue> => {
      registration.signal.throwIfAborted()
      const { data, error } = await gateway.client.functions.invoke(name, { body: parameters })
      if (error) throw new ManorRequestError(name, 'EDGE_REQUEST_FAILED', error.message)
      return z.json().parse(data)
    }
    const register = async (): Promise<void> => {
      const tools: SiteTool[] = browserToolGroups.map(group => ({
        name: group.name, description: group.description, inputSchema: group.inputSchema,
        annotations: { readOnlyHint: group.readOnly, untrustedContentHint: true },
        execute: async input => {
          registration.signal.throwIfAborted()
          const { tool, fields } = resolveBrowserOperation(group, input)
          if (!tool.readOnly) await assertDraftsUnaffected(tool.name, fields, notes)
          const result = await executeManorTool(tool.name, fields, { rpc, invoke })
          if (!tool.readOnly) {
            const operations = tool.execution.kind === 'lifecycle_batch' ? Object.values(tool.execution.operations)
              : [tool.execution.kind === 'command' || tool.execution.kind === 'batch' ? tool.execution.operation : tool.name]
            await Promise.all([...new Set(operations)].map(operation => gateway.invalidateOperation(operation)))
            window.dispatchEvent(new CustomEvent('manor:committed', { detail: { operation: tool.name } }))
          }
          return result
        }
      }))
      tools.push(...createBrowserTools(gateway, notes))
      assertBrowserDescriptorBudget(tools)
      for (const tool of tools) {
        if (registration.signal.aborted) return
        await context.registerTool(tool, { signal: registration.signal })
      }
    }
    void register().catch((error: unknown) => {
      registration.abort()
      onFailure(error instanceof Error ? error.message : 'Manor site tools could not register')
    })
    return () => registration.abort()
  }, [gateway, notes, onFailure])
  return null
}
