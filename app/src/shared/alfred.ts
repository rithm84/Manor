export const ALFRED_ACCELERATOR = 'Alt+Space'

export const ALFRED_ROUTES = ['/home', '/habits', '/mood-focus', '/leetcode'] as const
export type AlfredRoute = (typeof ALFRED_ROUTES)[number]

export type AlfredMicrophonePermission =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

export interface AlfredShortcutStatus {
  accelerator: typeof ALFRED_ACCELERATOR
  registered: boolean
}

export interface AlfredApi {
  getShortcutStatus: () => Promise<AlfredShortcutStatus>
  requestMicrophonePermission: () => Promise<AlfredMicrophonePermission>
  dismissPanel: () => Promise<void>
  navigate: (route: AlfredRoute) => Promise<void>
  onModalToggle: (listener: () => void) => () => void
  onPanelVisibility: (listener: (visible: boolean) => void) => () => void
  onNavigate: (listener: (route: AlfredRoute) => void) => () => void
}

export function parseAlfredRoute(value: unknown): AlfredRoute {
  if (typeof value !== 'string' || !ALFRED_ROUTES.includes(value as AlfredRoute)) {
    throw new TypeError('Alfred destination must be Home, Habits, Mood & Focus, or LeetCode')
  }
  return value as AlfredRoute
}
