import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Kbd, Modal } from '../../components/ui'

export interface CalendarCommand {
  id: string
  label: string
  group: string
  icon: ReactNode
  keys: readonly string[] | null
  run: () => void
}

export interface CalendarCommandMenuProps {
  open: boolean
  commands: readonly CalendarCommand[]
  onClose: () => void
}

export function filterCalendarCommands(commands: readonly CalendarCommand[], query: string): readonly CalendarCommand[] {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized === '' ? commands : commands.filter((command) => `${command.label} ${command.group}`.toLocaleLowerCase().includes(normalized))
}

export function CalendarCommandMenu({ open, commands, onClose }: CalendarCommandMenuProps): ReactNode {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const filtered = useMemo(() => filterCalendarCommands(commands, query), [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1))), [filtered.length])

  const run = (command: CalendarCommand): void => {
    onClose()
    command.run()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => filtered.length === 0 ? 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length)
      return
    }
    if (event.key === 'Enter' && filtered[activeIndex] !== undefined) {
      event.preventDefault()
      run(filtered[activeIndex] as CalendarCommand)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={540} ariaLabel="Calendar commands">
      <section className="cal-command-menu">
        <label className="cal-command-search"><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search calendar commands" aria-label="Search calendar commands" />{query === '' ? <Kbd keys={['⌘', 'K']} /> : <button type="button" onClick={() => setQuery('')} aria-label="Clear command search"><X size={14} /></button>}</label>
        <div className="cal-command-list" role="listbox" aria-label="Calendar commands">
          {filtered.length === 0 ? <p>No matching commands</p> : filtered.map((command, index) => (
            <button key={command.id} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'is-active' : ''} onPointerMove={() => setActiveIndex(index)} onClick={() => run(command)}>
              <span>{command.icon}<span><strong>{command.label}</strong><small>{command.group}</small></span></span>
              {command.keys === null ? null : <Kbd keys={command.keys} />}
            </button>
          ))}
        </div>
      </section>
    </Modal>
  )
}
