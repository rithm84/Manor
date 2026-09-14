export type ThemePreference = 'system' | 'light' | 'dark' | 'temporal'

/** Day-and-night mode: light from 6 AM until 6 PM local time, dark otherwise. */
export const DAY_START_HOUR = 6
export const NIGHT_START_HOUR = 18

export function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem('manor.theme')
  return saved === 'light' || saved === 'dark' || saved === 'temporal' ? saved : 'system'
}

/** Whether the preference resolves to dark at `now`, given the system's own preference. */
export function darkFor(preference: ThemePreference, now: Date, systemDark: boolean): boolean {
  if (preference === 'dark') return true
  if (preference === 'light') return false
  if (preference === 'temporal') return now.getHours() < DAY_START_HOUR || now.getHours() >= NIGHT_START_HOUR
  return systemDark
}

/** Milliseconds from `now` until the next 6 AM or 6 PM boundary. */
export function millisecondsToNextBoundary(now: Date): number {
  const next = new Date(now)
  next.setSeconds(0, 0)
  if (now.getHours() < DAY_START_HOUR) next.setHours(DAY_START_HOUR, 0)
  else if (now.getHours() < NIGHT_START_HOUR) next.setHours(NIGHT_START_HOUR, 0)
  else { next.setDate(next.getDate() + 1); next.setHours(DAY_START_HOUR, 0) }
  return Math.max(1000, next.getTime() - now.getTime())
}

let boundaryTimer: number | null = null

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = darkFor(preference, new Date(), matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  // The installed window's title bar takes the canvas color of the active theme.
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas').trim()
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta !== null && canvas !== '') meta.content = canvas
  if (boundaryTimer !== null) { window.clearTimeout(boundaryTimer); boundaryTimer = null }
  if (preference === 'temporal') boundaryTimer = window.setTimeout(() => applyTheme(readThemePreference()), millisecondsToNextBoundary(new Date()))
}

export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem('manor.theme', preference)
  applyTheme(preference)
}

export function initializeTheme(): () => void {
  applyTheme(readThemePreference())
  const media = matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => applyTheme(readThemePreference())
  // A tab that slept through a boundary catches up when it is shown again.
  const onVisible = (): void => { if (document.visibilityState === 'visible') applyTheme(readThemePreference()) }
  media.addEventListener('change', onChange)
  window.addEventListener('storage', onChange)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    media.removeEventListener('change', onChange)
    window.removeEventListener('storage', onChange)
    document.removeEventListener('visibilitychange', onVisible)
    if (boundaryTimer !== null) window.clearTimeout(boundaryTimer)
  }
}
