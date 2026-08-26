import { describe, expect, it } from 'vitest'

import {
  ALFRED_NAVIGABLE_ROUTES,
  ALFRED_TOOL_NAMES,
  ALFRED_TOOLS,
  realtimeToolsOf,
  toolDefinitionOf
} from './alfredVoice'

describe('the Alfred tool catalog', () => {
  it('defines every catalog name exactly once', () => {
    expect(ALFRED_TOOLS.map((tool) => tool.name)).toEqual([...ALFRED_TOOL_NAMES])
    expect(new Set(ALFRED_TOOLS.map((tool) => tool.name)).size).toBe(ALFRED_TOOLS.length)
  })

  it('gives every tool a description and a closed parameter schema', () => {
    for (const tool of ALFRED_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.parameters.type).toBe('object')
      expect(tool.parameters.additionalProperties).toBe(false)
      for (const required of tool.parameters.required) {
        expect(tool.parameters.properties[required]).toBeDefined()
      }
    }
  })

  it('marks delete_task, and only delete_task, destructive with a confirmed flag', () => {
    const destructive = ALFRED_TOOLS.filter((tool) => tool.destructive)
    expect(destructive.map((tool) => tool.name)).toEqual(['delete_task'])
    for (const tool of destructive) {
      expect(tool.parameters.properties.confirmed).toBeDefined()
      expect(tool.parameters.properties.confirmed?.type).toBe('boolean')
    }
  })

  it('never lets navigate reach the Journal', () => {
    expect(ALFRED_NAVIGABLE_ROUTES).not.toContain('/journal')
    expect(ALFRED_NAVIGABLE_ROUTES).toContain('/home')
    expect(toolDefinitionOf('navigate')?.parameters.properties.route?.enum).not.toContain(
      '/journal'
    )
  })

  it('maps to the Realtime wire shape without leaking the destructive flag', () => {
    const wire = realtimeToolsOf()
    expect(wire.length).toBe(ALFRED_TOOLS.length)
    for (const tool of wire) {
      expect(tool.type).toBe('function')
      expect('destructive' in tool).toBe(false)
    }
  })
})
