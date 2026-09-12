import { useEffect, useState } from 'react'

function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'light' || explicit === 'dark') return explicit
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** React to app preference changes without recreating the editor or its selection. */
export function useNoteTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const update = (): void => setTheme(currentTheme())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    preference.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      preference.removeEventListener('change', update)
    }
  }, [])
  return theme
}
