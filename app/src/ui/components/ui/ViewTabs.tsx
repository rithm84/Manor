import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface ViewTab<Value extends string> {
  value: Value
  label: string
  icon?: ReactNode
}

export interface ViewTabsProps<Value extends string> {
  /** Accessible name for the tab list, such as "Habits view". */
  label: string
  tabs: readonly ViewTab<Value>[]
  value: Value
  onChange: (value: Value) => void
  className?: string
}

/**
 * The segmented view switcher every module page uses in its header. Tabs
 * change the page's view without navigation; Left and Right move between
 * them, and Home and End jump to the ends, as in a native tab list.
 */
export function ViewTabs<Value extends string>({ label, tabs, value, onChange, className }: ViewTabsProps<Value>): ReactNode {
  const list = useRef<HTMLDivElement | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = tabs.findIndex((tab) => tab.value === value)
    if (index === -1) return
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const target = tabs[next]
    if (target === undefined) return
    onChange(target.value)
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div ref={list} className={`ui-viewtabs${className === undefined ? '' : ` ${className}`}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'is-selected' : ''}
            onClick={() => onChange(tab.value)}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
