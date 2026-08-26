export const ALFRED_ACCELERATOR = 'Alt+M'

export const ALFRED_ROUTES = [
  '/home',
  '/habits',
  '/mood-focus',
  '/leetcode',
  '/jobs',
  '/notes',
  '/bookmarks',
  '/journal',
  '/alfred-activity',
  '/settings'
] as const
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
    throw new TypeError(`Alfred destination must be one of: ${ALFRED_ROUTES.join(', ')}`)
  }
  return value as AlfredRoute
}
