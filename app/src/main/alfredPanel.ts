import { ALFRED_ACCELERATOR } from '../shared/alfred'
import type { AlfredShortcutStatus } from '../shared/alfred'

export type AlfredSummonTarget = 'modal' | 'show-panel' | 'hide-panel'

export interface AlfredPanelBoundsInput {
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
  panelWidth: number
  panelHeight: number
}

export interface AlfredPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export function alfredSummonTarget(
  mainWindowFocused: boolean,
  panelVisible: boolean
): AlfredSummonTarget {
  if (mainWindowFocused) return 'modal'
  return panelVisible ? 'hide-panel' : 'show-panel'
}

export function alfredShortcutStatus(registered: boolean): AlfredShortcutStatus {
  return { accelerator: ALFRED_ACCELERATOR, registered }
}

export function alfredPanelBounds(input: AlfredPanelBoundsInput): AlfredPanelBounds {
  const x = input.workAreaX + Math.round((input.workAreaWidth - input.panelWidth) / 2)
  const preferredY = input.workAreaY + Math.round(input.workAreaHeight * 0.16)
  const maxY = input.workAreaY + input.workAreaHeight - input.panelHeight
  return {
    x,
    y: Math.max(input.workAreaY, Math.min(preferredY, maxY)),
    width: input.panelWidth,
    height: input.panelHeight
  }
}
