import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { useSidebarDocked } from '../app/sidebarState'
import { Button, Input, Kbd, Pill, Select } from '../components/ui'
import { setSoundsEnabled, soundsEnabled } from '../sound/sounds'
import { accountErrorMessage, useCurrentAccount, useSignIn, validateSignIn } from './welcome/accountSession'
import { GoogleCalendarSection } from './settings/GoogleCalendarSection'
import { XConnectionSection } from './settings/XConnectionSection'
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

  // Account
  const { account, setAccount } = useCurrentAccount()
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInFieldError, setSignInFieldError] = useState<string | null>(null)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const signIn = useSignIn((signedIn) => {
    setAccount(signedIn)
    setSignInEmail('')
    setSignInPassword('')
  })

  const submitSignIn = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const problem = validateSignIn(signInEmail, signInPassword)
    if (problem !== null) {
      setSignInFieldError(problem)
      return
    }
    setSignInFieldError(null)
    signIn.submit(signInEmail, signInPassword)
  }

  const signOutOfAccount = (): void => {
    setSignOutBusy(true)
    setSignOutError(null)
    window.manor.account
      .signOut()
      .then(() => window.manor.account.current())
      .then((current) => {
        setSignOutBusy(false)
        setAccount(current)
      })
      .catch((cause: unknown) => {
        console.error('Sign out failed', { error: cause })
        setSignOutBusy(false)
        setSignOutError(accountErrorMessage(cause, 'Sign out failed. Try again.'))
      })
  }

  // Connections
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
  const [sidebarDocked, setSidebar] = useSidebarDocked()

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
                {account === undefined ? (
                  <div className="set-account" aria-hidden="true">
                    <span className="set-avatar set-avatar--ghost" />
                    <div className="set-account-copy">
                      <span className="set-ghost-line set-ghost-line--wide" />
                      <span className="set-ghost-line" />
                    </div>
                  </div>
                ) : null}
                {account !== undefined && account !== null ? (
                  <>
                    <div className="set-account">
                      <span className="set-avatar">{account.email.charAt(0).toUpperCase()}</span>
                      <div className="set-account-copy">
                        <span className="set-account-name">{account.email}</span>
                        <span className="set-account-mail">Manor account</span>
                      </div>
                      <Button variant="ghost" onClick={signOutOfAccount} disabled={signOutBusy}>
                        Sign out
                      </Button>
                    </div>
                    {signOutError !== null ? (
                      <span className="set-signin-error" role="alert">
                        {signOutError}
                      </span>
                    ) : null}
                  </>
                ) : null}
                {account === null ? (
                  <form className="set-signin" onSubmit={submitSignIn} noValidate>
                    <div className="set-signin-fields">
                      <span className="ui-input-wrap">
                        <input
                          type="email"
                          className="ui-input"
                          value={signInEmail}
                          onChange={(event) => {
                            setSignInEmail(event.target.value)
                            setSignInFieldError(null)
                            signIn.clearError()
                          }}
                          placeholder="you@example.com"
                          aria-label="Email address"
                          aria-invalid={(signInFieldError ?? signIn.error) !== null}
                          autoComplete="email"
                        />
                      </span>
                      <span className="ui-input-wrap">
                        <input
                          type="password"
                          className="ui-input"
                          value={signInPassword}
                          onChange={(event) => {
                            setSignInPassword(event.target.value)
                            setSignInFieldError(null)
                            signIn.clearError()
                          }}
                          placeholder="Password"
                          aria-label="Password"
                          autoComplete="current-password"
                        />
                      </span>
                      <button
                        type="submit"
                        className="ui-button ui-button--primary"
                        disabled={signInEmail.trim() === '' || signInPassword === '' || signIn.busy}
                      >
                        {signIn.busy ? 'Signing in…' : 'Sign in'}
                      </button>
                    </div>
                    {(signInFieldError ?? signIn.error) !== null ? (
                      <span className="set-signin-error" role="alert">
                        {signInFieldError ?? signIn.error}
                      </span>
                    ) : null}
                  </form>
                ) : null}
              </div>
            </section>
          ) : null}

          {section === 'connections' ? (
            <section className="set-section">
              <h2 className="set-section-title">Connections</h2>
              <div className="set-card">
                <GoogleCalendarSection />
                <XConnectionSection />
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
                    <Kbd keys={['⌥', 'M']} />
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
