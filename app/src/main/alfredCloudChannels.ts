/* Alfred cloud bridge channels: session minting, supervisor consults, memory
   writes, and the audit trail. Electron-free, servable over IPC or the dev
   bridge, mirroring the resumeChannels/kbChannels factory pattern. */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  parseAlfredAuditDraft,
  parseAlfredConsultQuery,
  parseAlfredMemoryText,
  parseAlfredMintedSession,
  realtimeToolsOf
} from '../shared/alfredVoice'
import type { BridgeChannelHandler } from './bridgeChannels'
import { accountOf } from './supabaseCore'

async function requireSignedIn(client: SupabaseClient): Promise<void> {
  if ((await accountOf(client)) === null) {
    throw new Error('Sign in to Manor to talk to Alfred')
  }
}

function consultAnswerOf(data: unknown): string {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TypeError('alfred-consult returned a non-object payload')
  }
  const answer = (data as Record<string, unknown>).answer
  if (typeof answer !== 'string' || answer === '') {
    throw new TypeError('alfred-consult returned no answer')
  }
  return answer
}

export function createAlfredCloudChannels(
  clientOf: () => SupabaseClient
): Record<string, BridgeChannelHandler> {
  return {
    'alfred:mint-session': async () => {
      const client = clientOf()
      await requireSignedIn(client)
      const { data, error } = await client.functions.invoke('alfred-session', {
        body: { tools: realtimeToolsOf() }
      })
      if (error !== null) {
        throw new Error(`Alfred session mint failed: ${error.message}`)
      }
      return parseAlfredMintedSession(data)
    },

    'alfred:consult': async (args) => {
      const query = parseAlfredConsultQuery(args[0])
      const client = clientOf()
      await requireSignedIn(client)
      const { data, error } = await client.functions.invoke('alfred-consult', {
        body: { question: query.question, context: query.context }
      })
      if (error !== null) {
        throw new Error(`Alfred consult failed: ${error.message}`)
      }
      return consultAnswerOf(data)
    },

    'alfred:remember': async (args) => {
      const fact = parseAlfredMemoryText(args[0], 'An Alfred fact')
      const client = clientOf()
      await requireSignedIn(client)
      const { error } = await client.functions.invoke('alfred-consult', {
        body: { rememberFact: fact }
      })
      if (error !== null) {
        throw new Error(`Alfred could not store the fact: ${error.message}`)
      }
      return null
    },

    'alfred:session-summary': async (args) => {
      const summary = parseAlfredMemoryText(args[0], 'An Alfred session summary')
      const client = clientOf()
      await requireSignedIn(client)
      const { error } = await client.functions.invoke('alfred-consult', {
        body: { sessionSummary: summary }
      })
      if (error !== null) {
        throw new Error(`Alfred could not store the session summary: ${error.message}`)
      }
      return null
    },

    'alfred:audit': async (args) => {
      const draft = parseAlfredAuditDraft(args[0])
      const client = clientOf()
      await requireSignedIn(client)
      const { error } = await client.from('alfred_actions').insert({
        kind: draft.kind,
        summary: draft.summary,
        payload: draft.payload
      })
      if (error !== null) {
        throw new Error(`Alfred audit write failed for ${draft.kind}: ${error.message}`)
      }
      return null
    }
  }
}
