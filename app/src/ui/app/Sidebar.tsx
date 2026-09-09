import {
  Bookmark,
  Briefcase,
  ChevronsUpDown,
  Code2,
  FileText,
  Flame,
  House,
  Settings,
  Smile
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import type { AccountInfo } from '../../shared/account'
import { useDismissLayer } from '../components/ui'
import { user } from '../data/mock'
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
  { to: '/leetcode', label: 'LeetCode', icon: <Code2 size={16} /> },
  { to: '/jobs', label: 'Jobs', icon: <Briefcase size={16} /> },
  { to: '/notes', label: 'Notes', icon: <FileText size={16} /> },
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

function NavItemLink({ entry }: { entry: NavEntry }): ReactNode {
  return (
    <NavLink
      to={entry.to}
      className={({ isActive }) => `sidebar-item${isActive ? ' is-active' : ''}`}
    >
      {entry.icon}
      {entry.label}
    </NavLink>
  )
}

function menuItemsOf(menu: HTMLDivElement | null): readonly HTMLElement[] {
  if (menu === null) return []
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

/** Real session identity when signed in; the mock persona only carries the
    signed-out showroom. AccountInfo has no display name, so the email's
    local part stands in for one. */
function accountDisplay(account: AccountInfo | null | undefined): {
  name: string
  email: string
  initials: string
} {
  if (account === undefined || account === null) {
    return { name: user.name, email: user.email, initials: user.initials }
  }
  const localPart = account.email.split('@')[0]
  return {
    name: localPart,
    email: account.email,
    initials: localPart.charAt(0).toUpperCase()
  }
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
  const display = accountDisplay(account)
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
      <div className={`sidebar-topspace${mode === 'docked' ? '' : ''}`} />
      <div className="sidebar-head">
        <span className="sidebar-wordmark">Manor</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((entry) => (
          <NavItemLink key={entry.to} entry={entry} />
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
            <span className="sidebar-account-name">{display.name}</span>
            <br />
            <span className="sidebar-account-mail">{display.email}</span>
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
