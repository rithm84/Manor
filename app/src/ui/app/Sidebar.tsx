import {
  Bookmark,
  CalendarCheck,
  Briefcase,
  ChevronsUpDown,
  Code2,
  FileText,
  Flame,
  House,
  Settings,
  Smile,
  Timer
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import { ManorLogo } from '../components/brand/ManorLogo'
import { useDismissLayer } from '../components/ui'
import { formatClock } from '../../shared/pomodoro'
import { usePomodoroRuntime } from '../pomodoro/PomodoroRuntime'
import { useManorAccount } from '../../web/accountContext'
import { useAvatar, useCurrentAccount } from '../pages/welcome/accountSession'

interface NavEntry {
  to: string
  label: string
  icon: ReactNode
}

const NAV_ITEMS: readonly NavEntry[] = [
  { to: '/home', label: 'Home', icon: <House size={16} /> },
  { to: '/habits', label: 'Habits', icon: <Flame size={16} /> },
  { to: '/mood-focus', label: 'Mood & Focus', icon: <Smile size={16} /> },
  { to: '/pomodoro', label: 'Pomodoro', icon: <Timer size={16} /> },
  { to: '/leetcode', label: 'LeetCode', icon: <Code2 size={16} /> },
  { to: '/jobs', label: 'Jobs', icon: <Briefcase size={16} /> },
  { to: '/notes', label: 'Notes', icon: <FileText size={16} /> },
  { to: '/weekly-reviews', label: 'Weekly reviews', icon: <CalendarCheck size={16} /> },
  { to: '/bookmarks', label: 'Bookmarks', icon: <Bookmark size={16} /> },
]

/** Utility surfaces live behind the account row. */
const ACCOUNT_MENU_ITEMS: readonly NavEntry[] = [
  { to: '/settings', label: 'Settings', icon: <Settings size={15} /> }
]

export interface SidebarProps {
  /**
   * 'docked' = fixed column. 'floating' = edge-summoned overlay.
   * The single dock/collapse control lives in the frame topbar, not here.
   */
  mode: 'docked' | 'floating'
}

function NavItemLink({ entry, trailing }: { entry: NavEntry; trailing?: ReactNode }): ReactNode {
  return (
    <NavLink
      to={entry.to}
      data-testid={`nav-${entry.to.slice(1)}`}
      className={({ isActive }) => `sidebar-item${isActive ? ' is-active' : ''}`}
    >
      {entry.icon}
      {entry.label}
      {trailing}
    </NavLink>
  )
}

/** The running timer beside the Pomodoro item, so the countdown is in view from any page. */
function PomodoroBadge(): ReactNode {
  const { active, clock } = usePomodoroRuntime()
  if (active === null || clock === null) return null
  const paused = active.status === 'paused'
  return (
    <span className={`sidebar-badge tnum${paused ? ' is-paused' : ''}`} aria-label={`${formatClock(clock.remainingSeconds)} ${paused ? 'paused' : 'remaining'}`} data-testid="pomodoro-badge">
      {formatClock(clock.remainingSeconds)}
    </span>
  )
}

function menuItemsOf(menu: HTMLDivElement | null): readonly HTMLElement[] {
  if (menu === null) return []
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function AccountMenu({ onClose, email }: { onClose: () => void; email: string }): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    menuItemsOf(menuRef.current)[0]?.focus()
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = menuItemsOf(menuRef.current)
    if (items.length === 0) return
    const active = document.activeElement
    const index = items.findIndex((item) => item === active)
    const next =
      index === -1
        ? event.key === 'ArrowDown'
          ? 0
          : items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  return (
    <div
      className="sidebar-account-menu"
      role="menu"
      aria-label="Account"
      ref={menuRef}
      onKeyDown={onKeyDown}
    >
      <span className="sidebar-account-menu-mail">{email}</span>
      {ACCOUNT_MENU_ITEMS.map((entry) => (
        <NavLink
          key={entry.to}
          to={entry.to}
          role="menuitem"
          className={({ isActive }) => `sidebar-account-menu-item${isActive ? ' is-active' : ''}`}
          onClick={onClose}
        >
          {entry.icon}
          {entry.label}
        </NavLink>
      ))}
    </div>
  )
}

export function Sidebar({ mode }: SidebarProps): ReactNode {
  const [accountOpen, setAccountOpen] = useState(false)
  const { account } = useCurrentAccount()
  const avatar = useAvatar(account !== undefined && account !== null)
  const profile = useManorAccount()
  const display = { name: profile.name, email: profile.email, initials: profile.name.charAt(0).toUpperCase() }
  const footRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useDismissLayer(accountOpen, () => {
    setAccountOpen(false)
    triggerRef.current?.focus()
  })

  useEffect(() => {
    if (!accountOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (footRef.current !== null && !footRef.current.contains(event.target as Node)) {
        setAccountOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [accountOpen])

  return (
    <>
      {/* The docked column reaches into the desktop title bar; the summoned overlay does not. */}
      <div className="sidebar-topspace" data-tauri-drag-region={mode === 'docked' ? true : undefined} />
      <div className="sidebar-head">
        <ManorLogo className="sidebar-wordmark" />
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((entry) => (
          <NavItemLink key={entry.to} entry={entry} trailing={entry.to === '/pomodoro' ? <PomodoroBadge /> : undefined} />
        ))}
      </nav>
      <div className="sidebar-foot" ref={footRef}>
        <button
          type="button"
          className="sidebar-account"
          ref={triggerRef}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((open) => !open)}
        >
          <span className="sidebar-avatar">
            {avatar.url !== null ? (
              <img className="sidebar-avatar-img" src={avatar.url} alt="" />
            ) : (
              display.initials
            )}
          </span>
          <span className="sidebar-account-id">
            <span className="sidebar-account-name" title={display.name}>{display.name}</span>
            <span className="sidebar-account-mail" title={display.email}>{display.email}</span>
          </span>
          <ChevronsUpDown className="sidebar-account-caret" size={14} aria-hidden="true" />
        </button>
        {accountOpen ? (
          <AccountMenu onClose={() => setAccountOpen(false)} email={display.email} />
        ) : null}
      </div>
    </>
  )
}
