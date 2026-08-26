import { describe, expect, it } from 'vitest'

import { alfredPanelBounds, alfredShortcutStatus, alfredSummonTarget } from './alfredPanel'

describe('alfred panel lifecycle decisions', () => {
  it('uses the modal in Manor and toggles one outside panel', () => {
    expect(alfredSummonTarget(true, false)).toBe('modal')
    expect(alfredSummonTarget(false, false)).toBe('show-panel')
    expect(alfredSummonTarget(false, true)).toBe('hide-panel')
    expect(alfredShortcutStatus(true)).toEqual({ accelerator: 'Alt+M', registered: true })
  })

  it('centers the panel in the active work area without leaving it', () => {
    expect(
      alfredPanelBounds({
        workAreaX: 100,
        workAreaY: 30,
        workAreaWidth: 1200,
        workAreaHeight: 700,
        panelWidth: 472,
        panelHeight: 576
      })
    ).toEqual({ x: 464, y: 142, width: 472, height: 576 })
  })
})
