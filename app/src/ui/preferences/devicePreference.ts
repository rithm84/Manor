import { useCallback, useState } from 'react'

/**
 * A small device-local preference: a view, a sort, a toggle. Preferences are
 * conveniences, so unreadable storage falls back to the default and a failed
 * write is ignored rather than surfaced.
 */
export function readDevicePreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`manor.${key}`)
    return allowed.find((value) => value === raw) ?? fallback
  } catch {
    return fallback
  }
}

export function writeDevicePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(`manor.${key}`, value)
  } catch {
    // Losing a preference only means the default comes back next time.
  }
}

/** `useState` for a device preference drawn from a fixed set of string values. */
export function useDevicePreference<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readDevicePreference(key, allowed, fallback))
  const update = useCallback((next: T): void => {
    writeDevicePreference(key, next)
    setValue(next)
  }, [key])
  return [value, update]
}

/** A boolean device preference stored as '1' or '0'. */
export function useDeviceFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useDevicePreference<'1' | '0'>(key, ['1', '0'], fallback ? '1' : '0')
  const update = useCallback((next: boolean): void => setValue(next ? '1' : '0'), [setValue])
  return [value === '1', update]
}
