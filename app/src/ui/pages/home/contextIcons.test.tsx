import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CONTEXT_ICON_VALUES, parseContextDefinition } from '../../../shared/home'
import {
  CONTEXT_ICON_CATEGORIES,
  CONTEXT_ICON_OPTIONS,
  ContextGlyph,
  contextIconLabel
} from './contextIcons'

describe('context icon catalog', () => {
  it('covers every persisted icon with broad browsable categories', () => {
    expect(CONTEXT_ICON_OPTIONS.map((option) => option.value)).toEqual(CONTEXT_ICON_VALUES)
    expect(CONTEXT_ICON_CATEGORIES).toHaveLength(6)
    CONTEXT_ICON_CATEGORIES.forEach((category) => {
      expect(CONTEXT_ICON_OPTIONS.filter((option) => option.category === category)).toHaveLength(6)
    })
  })

  it('renders and validates icons beyond the original six', () => {
    expect(contextIconLabel('rocket')).toBe('Rocket')
    expect(renderToStaticMarkup(<ContextGlyph icon="rocket" size={15} />)).toContain('<svg')
    expect(parseContextDefinition({ name: 'Launch', color: 'forest', icon: 'rocket' })).toEqual({
      name: 'Launch',
      color: 'forest',
      icon: 'rocket'
    })
  })
})
