import {
  Activity,
  Bookmark,
  Briefcase,
  Code2,
  FileText,
  Flame,
  House,
  Lock,
  Search,
  Settings,
  Smile
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Kbd } from '../components/ui'
import { user } from '../data/mock'

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
  { to: '/journal', label: 'Journal', icon: <Lock size={16} /> }
]

const FOOT_ITEMS: readonly NavEntry[] = [
  { to: '/alfred-activity', label: 'Alfred activity', icon: <Activity size={16} /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={16} /> }
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

export function Sidebar({ mode }: SidebarProps): ReactNode {
  return (
    <>
      <div className={`sidebar-topspace${mode === 'docked' ? ' titlebar-drag' : ''}`} />
      <div className="sidebar-head">
        <span className="sidebar-wordmark">Manor</span>
      </div>
      <button type="button" className="sidebar-search">
        <Search size={15} />
        Search
        <Kbd keys={['⌘', 'K']} />
      </button>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((entry) => (
          <NavItemLink key={entry.to} entry={entry} />
        ))}
      </nav>
      <div className="sidebar-foot">
        {FOOT_ITEMS.map((entry) => (
          <NavItemLink key={entry.to} entry={entry} />
        ))}
        <button type="button" className="sidebar-account">
          <span className="sidebar-avatar">{user.initials}</span>
          <span>
            <span className="sidebar-account-name">{user.name}</span>
            <br />
            <span className="sidebar-account-mail">{user.email}</span>
          </span>
        </button>
      </div>
    </>
  )
}
