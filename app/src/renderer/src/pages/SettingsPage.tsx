import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { SIDEBAR_DOCKED_KEY } from '../app/AppFrame'
import { Button, Input, Kbd, Pill, Select } from '../components/ui'
import { user } from '../data/mock'
import { setSoundsEnabled, soundsEnabled } from '../sound/sounds'
import { SettingsRow, SettingsToggle } from './settings/controls'
import { PageShell } from './PageShell'
import './settings/settings.css'

type SettingsSection =
  | 'account'
  | 'connections'
  | 'alfred'
  | 'notifications'
  | 'appearance'
  | 'about'

const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'connections', label: 'Connections' },
  { id: 'alfred', label: 'Alfred' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' }
]

const BRIEFING_TIMES = [
  { value: '06:30', label: '6:30 AM' },
  { value: '07:00', label: '7:00 AM' },
  { value: '07:30', label: '7:30 AM' }
] as const

const REMINDER_TIMES = [
  { value: '20:30', label: '8:30 PM' },
  { value: '21:00', label: '9:00 PM' },
  { value: '21:30', label: '9:30 PM' }
] as const

const ACCENTS = [
  { id: 'aubergine', color: '#6a4e6c' },
  { id: 'forest', color: '#2f4127' },
  { id: 'info', color: '#416883' },
  { id: 'today', color: '#825d16' },
  { id: 'plum', color: '#6b5375' }
] as const

/** Sectioned settings: nav of sections on the left, one section at a time. */
export function SettingsPage(): ReactNode {
  const [section, setSection] = useState<SettingsSection>('account')

  // Connections
  const [calendarConnected, setCalendarConnected] = useState(true)
  const [xConnected, setXConnected] = useState(true)
  const [leetcodeUsername, setLeetcodeUsername] = useState('user')
  const [jobFeed, setJobFeed] = useState(true)

  // Alfred
  const [shortcutAvailable, setShortcutAvailable] = useState<boolean | null>(null)
  const [briefingTime, setBriefingTime] = useState('07:00')

  // Notifications
  const [reminderTime, setReminderTime] = useState('21:00')
  const [taskReminders, setTaskReminders] = useState(true)

  // Appearance
  const [accent, setAccent] = useState('aubergine')
  const [sidebarDocked, setSidebarDocked] = useState(
    () => window.localStorage.getItem(SIDEBAR_DOCKED_KEY) !== '0'
  )

  const setSidebar = (docked: boolean): void => {
    window.localStorage.setItem(SIDEBAR_DOCKED_KEY, docked ? '1' : '0')
    setSidebarDocked(docked)
  }

  const [sounds, setSounds] = useState(soundsEnabled)
  const setSoundPreference = (enabled: boolean): void => {
    setSoundsEnabled(enabled)
    setSounds(enabled)
  }

  useEffect(() => {
    let cancelled = false
    void window.manor.alfred
      .getShortcutStatus()
      .then((status) => {
        if (!cancelled) setShortcutAvailable(status.registered)
      })
      .catch((error: unknown) => {
        console.error('Alfred shortcut status failed', { error })
        if (!cancelled) setShortcutAvailable(false)
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell title="Settings" fullBleed={false}>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`set-nav-item${section === item.id ? ' is-active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="set-content">
          {section === 'account' ? (
            <section className="set-section">
              <h2 className="set-section-title">Account</h2>
              <div className="set-card">
                <div className="set-account">
                  <span className="set-avatar">{user.initials}</span>
                  <div className="set-account-copy">
                    <span className="set-account-name">{user.name}</span>
                    <span className="set-account-mail">{user.email}</span>
                  </div>
                  <Button variant="ghost">Sign out</Button>
                </div>
              </div>
            </section>
          ) : null}

          {section === 'connections' ? (
            <section className="set-section">
              <h2 className="set-section-title">Connections</h2>
              <div className="set-card">
                <SettingsRow
                  label="Google Calendar"
                  description="Show Google Calendar events in Manor."
                >
                  {calendarConnected ? (
                    <div className="set-connected">
                      <Pill variant="tag" colorway="success" label="Connected" />
                      <Button variant="subtle" onClick={() => setCalendarConnected(false)}>
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => setCalendarConnected(true)}>
                      Connect
                    </Button>
                  )}
                </SettingsRow>
                <SettingsRow label="X" description="Show X bookmarks in Manor.">
                  {xConnected ? (
                    <div className="set-connected">
                      <Pill variant="tag" colorway="success" label="Connected" />
                      <Button variant="subtle" onClick={() => setXConnected(false)}>
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => setXConnected(true)}>
                      Connect
                    </Button>
                  )}
                </SettingsRow>
                <SettingsRow label="LeetCode" description="Count completed problems toward your LeetCode streak.">
                  <div className="set-input">
                    <Input
                      value={leetcodeUsername}
                      onChange={setLeetcodeUsername}
                      placeholder="Username"
                      ariaLabel="LeetCode username"
                    />
                  </div>
                </SettingsRow>
                <SettingsRow label="Job feed" description="Add new internship roles to Jobs daily.">
                  <SettingsToggle checked={jobFeed} onChange={setJobFeed} ariaLabel="Job feed" />
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === 'alfred' ? (
            <section className="set-section">
              <h2 className="set-section-title">Alfred</h2>
              <div className="set-card">
                <SettingsRow label="Summon" description="Open Alfred from any app while Manor is running.">
                  <div className="set-connected">
                    <Kbd keys={['⌥', 'Space']} />
                    {shortcutAvailable !== null ? (
                      <Pill
                        variant="tag"
                        colorway={shortcutAvailable ? 'success' : 'overdue'}
                        label={shortcutAvailable ? 'Available' : 'Unavailable'}
                      />
                    ) : null}
                  </div>
                </SettingsRow>
                <SettingsRow label="Morning briefing" description="Prepare the briefing by this time.">
                  <Select
                    value={briefingTime}
                    options={[...BRIEFING_TIMES]}
                    onChange={setBriefingTime}
                    placeholder="Time"
                    ariaLabel="Briefing time"
                  />
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === 'notifications' ? (
            <section className="set-section">
              <h2 className="set-section-title">Notifications</h2>
              <div className="set-card">
                <SettingsRow label="Evening reminder" description="Remind me to log the day at this time.">
                  <Select
                    value={reminderTime}
                    options={[...REMINDER_TIMES]}
                    onChange={setReminderTime}
                    placeholder="Time"
                    ariaLabel="Evening reminder time"
                  />
                </SettingsRow>
                <SettingsRow label="Task reminders" description="Notify me before tasks are due.">
                  <SettingsToggle
                    checked={taskReminders}
                    onChange={setTaskReminders}
                    ariaLabel="Task reminders"
                  />
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === 'appearance' ? (
            <section className="set-section">
              <h2 className="set-section-title">Appearance</h2>
              <div className="set-card">
                <SettingsRow label="Accent" description="Primary action color.">
                  <div className="set-swatches" role="radiogroup" aria-label="Accent color">
                    {ACCENTS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={accent === option.id}
                        aria-label={option.id}
                        className={`set-swatch${accent === option.id ? ' is-active' : ''}`}
                        style={{ ['--swatch' as string]: option.color }}
                        onClick={() => setAccent(option.id)}
                      />
                    ))}
                  </div>
                </SettingsRow>
                <SettingsRow label="Sounds" description="A soft tick when you check something off.">
                  <SettingsToggle
                    checked={sounds}
                    onChange={setSoundPreference}
                    ariaLabel="Completion sounds"
                  />
                </SettingsRow>
                <SettingsRow label="Sidebar" description="Default sidebar state.">
                  <div className="set-segment" role="radiogroup" aria-label="Sidebar behavior">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sidebarDocked}
                      className={`set-segment-btn${sidebarDocked ? ' is-active' : ''}`}
                      onClick={() => setSidebar(true)}
                    >
                      Docked
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!sidebarDocked}
                      className={`set-segment-btn${sidebarDocked ? '' : ' is-active'}`}
                      onClick={() => setSidebar(false)}
                    >
                      Collapsed
                    </button>
                  </div>
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === 'about' ? (
            <section className="set-section">
              <h2 className="set-section-title">About</h2>
              <div className="set-card">
                <SettingsRow label="Manor" description="Version">
                  <span className="set-version tnum">0.1.0</span>
                </SettingsRow>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageShell>
  )
}
