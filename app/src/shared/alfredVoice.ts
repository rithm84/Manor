/* Alfred's voice-tool catalog and cloud-session types, shared by the renderer
   (tool dispatch), the main process (session minting), and tests. The catalog
   is data: the alfred-session Edge Function echoes it into the Realtime
   session config so the renderer and the model always agree on one schema. */

import { ALFRED_ROUTES } from './alfred'
import type { AlfredRoute } from './alfred'

export const REALTIME_MODEL = 'gpt-realtime-2.1'
export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
export const SESSION_CAP_MINUTES = 60

export type AlfredSessionPhase = 'idle' | 'connecting' | 'live' | 'error'

export interface AlfredToolProperty {
  type: 'string' | 'number' | 'boolean'
  description: string
  enum?: readonly string[]
}

export interface AlfredToolParameters {
  type: 'object'
  properties: Readonly<Record<string, AlfredToolProperty>>
  required: readonly string[]
  additionalProperties: false
}

export interface AlfredToolDefinition {
  name: AlfredToolName
  description: string
  parameters: AlfredToolParameters
  destructive: boolean
}

/** The Realtime API wire shape for one function tool. */
export interface RealtimeToolConfig {
  type: 'function'
  name: string
  description: string
  parameters: AlfredToolParameters
}

export const ALFRED_TOOL_NAMES = [
  'log_habit',
  'complete_task',
  'create_task',
  'log_mood',
  'log_focus',
  'set_daily_note',
  'add_leetcode_attempt',
  'create_sticky',
  'navigate',
  'capture_screen',
  'consult',
  'remember',
  'delete_task'
] as const
export type AlfredToolName = (typeof ALFRED_TOOL_NAMES)[number]

/** Alfred never opens the Journal, not even to navigate there. */
export const ALFRED_NAVIGABLE_ROUTES: readonly AlfredRoute[] = ALFRED_ROUTES.filter(
  (route) => route !== '/journal'
)

const CONFIRMED_PROPERTY: AlfredToolProperty = {
  type: 'boolean',
  description:
    'Pass true only after the user has verbally confirmed this exact action. ' +
    'First call without it; the tool will tell you to ask for confirmation.'
}

export const ALFRED_TOOLS: readonly AlfredToolDefinition[] = [
  {
    name: 'log_habit',
    description:
      "Log today's completion for one habit. Binary habits use 100 for done. " +
      'Quantized habits use 0, 25, 50, 75, or 100.',
    parameters: {
      type: 'object',
      properties: {
        habit: { type: 'string', description: 'The habit name as the user said it, or its id.' },
        value: {
          type: 'string',
          description: 'Completion percentage.',
          enum: ['0', '25', '50', '75', '100']
        }
      },
      required: ['habit', 'value'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'complete_task',
    description: 'Mark one task done, matched by its title or id.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task title as the user said it, or its id.' }
      },
      required: ['task'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'create_task',
    description: 'Create a new task in one of the due buckets.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task title.' },
        due: {
          type: 'string',
          description: "When it is due: 'today', 'tomorrow', or an exact date YYYY-MM-DD."
        },
        context: {
          type: 'string',
          description:
            'Optional context name (for example Uni or Personal). Omit to reuse an existing one.'
        }
      },
      required: ['title', 'due'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'log_mood',
    description: "Log today's mood.",
    parameters: {
      type: 'object',
      properties: {
        mood: {
          type: 'string',
          description: 'The mood level.',
          enum: ['Great', 'Good', 'Neutral', 'Bad', 'Awful']
        }
      },
      required: ['mood'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'log_focus',
    description: "Log today's focus.",
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'The focus level.',
          enum: ['Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting']
        }
      },
      required: ['focus'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'set_daily_note',
    description:
      "Attach a short debrief summary to today's mood and focus record. " +
      'Summarize what the user told you in one or two sentences.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The summary to attach.' }
      },
      required: ['note'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'add_leetcode_attempt',
    description: 'Log a LeetCode solve or review for today against a curriculum problem.',
    parameters: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: 'The problem name as the user said it.' },
        solution: {
          type: 'string',
          description: 'Optional solution source or approach notes. Omit when logging by voice.'
        }
      },
      required: ['problem'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'create_sticky',
    description:
      "Drop a sticky note time block on the Today timeline. Times snap to 15 minutes.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the block is for.' },
        start: { type: 'string', description: 'Start time as HH:MM, 24 hour clock.' },
        durationMinutes: { type: 'number', description: 'Length in minutes.' }
      },
      required: ['title', 'start', 'durationMinutes'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'navigate',
    description: 'Open one of the Manor pages in the main window.',
    parameters: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          description: 'The page to open.',
          enum: ALFRED_NAVIGABLE_ROUTES
        }
      },
      required: ['route'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'capture_screen',
    description:
      "Screenshot the user's display and file it into the knowledge base for later recall.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'consult',
    description:
      'Ask the supervisor model a hard question: cross-module insight, saved knowledge, ' +
      'or anything needing real thought. Say a brief filler line first, then relay the ' +
      'answer in your own voice.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The full question, self-contained.' }
      },
      required: ['question'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'remember',
    description: 'Store one lasting fact about the user for future sessions.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact, phrased to stand alone.' }
      },
      required: ['fact'],
      additionalProperties: false
    },
    destructive: false
  },
  {
    name: 'delete_task',
    description:
      'Delete one task, matched by its title or id. Destructive: requires a spoken ' +
      'confirm-back before it runs.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task title as the user said it, or its id.' },
        confirmed: CONFIRMED_PROPERTY
      },
      required: ['task'],
      additionalProperties: false
    },
    destructive: true
  }
]

export function realtimeToolsOf(): readonly RealtimeToolConfig[] {
  return ALFRED_TOOLS.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }))
}

export function toolDefinitionOf(name: string): AlfredToolDefinition | null {
  return ALFRED_TOOLS.find((tool) => tool.name === name) ?? null
}

/* ------------------------------------------------------------------------- */
/* Cloud channel contracts                                                    */
/* ------------------------------------------------------------------------- */

export interface AlfredMintedSession {
  clientSecret: string
  expiresAt: string
  instructions: string
}

export interface AlfredConsultQuery {
  question: string
  context: string | null
}

export interface AlfredAuditDraft {
  kind: string
  summary: string
  payload: Record<string, unknown>
}

/** Bridge surface the orchestrator exposes as window.manor.alfredCloud. */
export interface AlfredCloudApi {
  mintSession: () => Promise<AlfredMintedSession>
  consult: (query: AlfredConsultQuery) => Promise<string>
  remember: (fact: string) => Promise<void>
  sessionSummary: (summary: string) => Promise<void>
  audit: (draft: AlfredAuditDraft) => Promise<void>
}

export function parseAlfredMintedSession(value: unknown): AlfredMintedSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Alfred session mint must return an object')
  }
  const session = value as Record<string, unknown>
  if (typeof session.clientSecret !== 'string' || session.clientSecret === '') {
    throw new TypeError('Alfred session mint returned no client secret')
  }
  if (typeof session.expiresAt !== 'string' || session.expiresAt === '') {
    throw new TypeError('Alfred session mint returned no expiry')
  }
  if (typeof session.instructions !== 'string' || session.instructions === '') {
    throw new TypeError('Alfred session mint returned no instructions')
  }
  return {
    clientSecret: session.clientSecret,
    expiresAt: session.expiresAt,
    instructions: session.instructions
  }
}

export function parseAlfredConsultQuery(value: unknown): AlfredConsultQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Alfred consult requires a question object')
  }
  const query = value as Record<string, unknown>
  if (typeof query.question !== 'string' || query.question.trim() === '') {
    throw new TypeError('Alfred consult requires a non-empty question')
  }
  if (query.context !== null && query.context !== undefined && typeof query.context !== 'string') {
    throw new TypeError('Alfred consult context must be a string or null')
  }
  return { question: query.question, context: query.context ?? null }
}

export function parseAlfredAuditDraft(value: unknown): AlfredAuditDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('An Alfred audit entry must be an object')
  }
  const draft = value as Record<string, unknown>
  if (typeof draft.kind !== 'string' || draft.kind === '') {
    throw new TypeError('An Alfred audit entry requires a kind')
  }
  if (typeof draft.summary !== 'string' || draft.summary === '') {
    throw new TypeError('An Alfred audit entry requires a summary')
  }
  if (typeof draft.payload !== 'object' || draft.payload === null || Array.isArray(draft.payload)) {
    throw new TypeError('An Alfred audit entry requires an object payload')
  }
  return {
    kind: draft.kind,
    summary: draft.summary,
    payload: draft.payload as Record<string, unknown>
  }
}

export function parseAlfredMemoryText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}
