export type ThemePreference = 'system' | 'light' | 'dark'

export function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem('manor.theme')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem('manor.theme', preference)
  applyTheme(preference)
}

export function initializeTheme(): () => void {
  applyTheme(readThemePreference())
  const media = matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => applyTheme(readThemePreference())
  media.addEventListener('change', onChange)
  window.addEventListener('storage', onChange)
  return () => {
    media.removeEventListener('change', onChange)
    window.removeEventListener('storage', onChange)
  }
}
