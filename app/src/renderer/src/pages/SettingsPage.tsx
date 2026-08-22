import { useState } from 'react'
import type { ReactNode } from 'react'

import { SIDEBAR_DOCKED_KEY } from '../app/AppFrame'
import { Button, Input, Kbd, Pill, Select } from '../components/ui'
import { user } from '../data/mock'
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
  { id: 'coral', color: '#cc785c' },
  { id: 'forest', color: '#2f4127' },
  { id: 'teal', color: '#5db8a6' },
  { id: 'amber', color: '#e8a55a' },
  { id: 'plum', color: '#8c6a9e' }
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
  const [capturingHotkey, setCapturingHotkey] = useState(false)
  const [voice, setVoice] = useState(true)
  const [briefingTime, setBriefingTime] = useState('07:00')

  // Notifications
  const [reminderTime, setReminderTime] = useState('21:00')
  const [taskReminders, setTaskReminders] = useState(true)

  // Appearance
  const [accent, setAccent] = useState('coral')
  const [sidebarDocked, setSidebarDocked] = useState(
    () => window.localStorage.getItem(SIDEBAR_DOCKED_KEY) !== '0'
  )

  const setSidebar = (docked: boolean): void => {
    window.localStorage.setItem(SIDEBAR_DOCKED_KEY, docked ? '1' : '0')
    setSidebarDocked(docked)
  }

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
                  description="Events flow straight into the calendar."
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
                <SettingsRow label="X" description="New bookmarks arrive each morning, sorted and summarized.">
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
                <SettingsRow label="LeetCode" description="Solves count toward the streak on their own.">
                  <div className="set-input">
                    <Input
                      value={leetcodeUsername}
                      onChange={setLeetcodeUsername}
                      placeholder="Username"
                      ariaLabel="LeetCode username"
                    />
                  </div>
                </SettingsRow>
                <SettingsRow label="Job feed" description="Fresh internship roles land in Jobs every day.">
                  <SettingsToggle checked={jobFeed} onChange={setJobFeed} ariaLabel="Job feed" />
                </SettingsRow>
              </div>
            </section>
          ) : null}

          {section === 'alfred' ? (
            <section className="set-section">
              <h2 className="set-section-title">Alfred</h2>
              <div className="set-card">
                <SettingsRow label="Summon" description="Works anywhere, even with Manor closed.">
                  {capturingHotkey ? (
                    <button
                      type="button"
                      className="set-hotkey-capture"
                      onClick={() => setCapturingHotkey(false)}
                    >
                      Press new keys, or click to keep
                    </button>
                  ) : (
                    <div className="set-connected">
                      <Kbd keys={['⌥', 'Space']} />
                      <Button variant="subtle" onClick={() => setCapturingHotkey(true)}>
                        Change
                      </Button>
                    </div>
                  )}
                </SettingsRow>
                <SettingsRow label="Voice" description="Hear Alfred out loud. Off keeps replies on screen.">
                  <SettingsToggle checked={voice} onChange={setVoice} ariaLabel="Voice" />
                </SettingsRow>
                <SettingsRow label="Morning briefing" description="Ready before you are.">
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
                <SettingsRow label="Evening reminder" description="A quiet nudge to log the day.">
                  <Select
                    value={reminderTime}
                    options={[...REMINDER_TIMES]}
                    onChange={setReminderTime}
                    placeholder="Time"
                    ariaLabel="Evening reminder time"
                  />
                </SettingsRow>
                <SettingsRow label="Task reminders" description="A heads up before something is due.">
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
                <SettingsRow label="Accent" description="The color Manor reaches for first.">
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
                <SettingsRow label="Sidebar" description="How Manor opens.">
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
                <SettingsRow label="Manor" description="Made for one.">
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
