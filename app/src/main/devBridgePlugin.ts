import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

import { closeManorStores, createBridgeChannels, createManorStores } from './bridgeChannels'
import type { BridgeChannelHandler } from './bridgeChannels'
import { createAlfredCloudChannels } from './alfredCloudChannels'
import { createGcalChannels } from './gcalChannels'
import { createKbChannels } from './kbChannels'
import { createResumeChannels } from './resumeChannels'
import { createXChannels } from './xChannels'
import { createAccountChannels, createCloudClient } from './supabaseCore'
import type { ManorCloudConfig } from './supabaseCore'
import { SyncEngine, pullOnBoot, withAccountSync, withPushScheduling } from './syncEngine'
import { BROWSER_BRIDGE_ENDPOINT } from '../shared/devBridge'
import type { SupabaseClient } from '@supabase/supabase-js'

interface BridgeRequestBody {
  channel: string
  args: readonly unknown[]
}

function parseBridgeRequest(raw: string): BridgeRequestBody {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('bridge request body must be an object')
  }
  const body = value as Record<string, unknown>
  if (typeof body['channel'] !== 'string' || body['channel'].length === 0) {
    throw new TypeError('bridge request channel must be a non-empty string')
  }
  if (!Array.isArray(body['args'])) {
    throw new TypeError('bridge request args must be an array')
  }
  return { channel: body['channel'], args: body['args'] }
}

function respondJson(response: ServerResponse, status: number, payload: object): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

// Serves the same store-backed bridge channels the Electron main process registers
// on IPC, so the renderer works in a plain browser tab during dev. State lives in a
// throwaway SQLite database per dev-server run.
export function browserBridgePlugin(): Plugin {
  return {
    name: 'manor-browser-bridge',
    apply: 'serve',
    configureServer(server) {
      const workspace = mkdtempSync(join(tmpdir(), 'manor-browser-bridge-'))
      const stores = createManorStores(
        join(workspace, 'manor.sqlite'),
        join(workspace, 'notes-attachments')
      )
      // Real Supabase auth in browser preview too; the dev server runs from
      // app/, so the repository root (holding .env.local) is one level up.
      const cloudConfig: ManorCloudConfig = {
        envRoot: join(process.cwd(), '..'),
        sessionFile: join(workspace, 'supabase-session.json')
      }
      let cloudClient: SupabaseClient | null = null
      const clientOf = (): SupabaseClient => {
        if (cloudClient === null) cloudClient = createCloudClient(cloudConfig)
        return cloudClient
      }
      const syncEngine = new SyncEngine(stores, clientOf)
      const channels: Record<string, BridgeChannelHandler> = {
        ...withPushScheduling(createBridgeChannels(stores), syncEngine),
        ...withAccountSync(createAccountChannels(cloudConfig, clientOf), syncEngine),
        ...createResumeChannels(clientOf),
        ...createKbChannels(clientOf),
        ...createXChannels({ envRoot: cloudConfig.envRoot }, clientOf),
        ...createGcalChannels({ envRoot: cloudConfig.envRoot, storageDir: workspace }),
        ...createAlfredCloudChannels(clientOf)
      }
      void pullOnBoot(syncEngine, clientOf).catch((error: unknown) => {
        console.error('manor-sync dev-bridge boot pull failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
      server.httpServer?.once('close', () => closeManorStores(stores))
      server.middlewares.use(
        BROWSER_BRIDGE_ENDPOINT,
        (request: IncomingMessage, response: ServerResponse) => {
          if (request.method !== 'POST') {
            respondJson(response, 405, {
              error: `bridge endpoint only accepts POST, got ${request.method ?? 'unknown'}`
            })
            return
          }
          const chunks: Buffer[] = []
          request.on('data', (chunk: Buffer) => chunks.push(chunk))
          request.on('end', () => {
            let parsed: BridgeRequestBody
            try {
              parsed = parseBridgeRequest(Buffer.concat(chunks).toString('utf8'))
            } catch (error) {
              respondJson(response, 400, {
                error: error instanceof Error ? error.message : String(error)
              })
              return
            }
            const handler = Object.hasOwn(channels, parsed.channel)
              ? channels[parsed.channel]
              : null
            if (handler === null) {
              respondJson(response, 404, { error: `unknown bridge channel: ${parsed.channel}` })
              return
            }
            void Promise.resolve()
              .then(() => handler(parsed.args))
              .then((result) =>
                respondJson(response, 200, { result: result === undefined ? null : result })
              )
              .catch((error: unknown) =>
                respondJson(response, 500, {
                  error: error instanceof Error ? error.message : String(error)
                })
              )
          })
        }
      )
    }
  }
}
