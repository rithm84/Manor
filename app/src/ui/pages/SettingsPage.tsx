import { useManorService } from '../services/ManorServices'
import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { readThemePreference, setThemePreference } from '../../web/theme'
import { AVATAR_CONTENT_TYPES } from '../../shared/account'
import { IntegrationSettings } from './settings/IntegrationSettings'
import { AgentConnections } from './settings/AgentConnections'
import { AvatarCropDialog } from './settings/AvatarCropDialog'

import { useSidebarDocked } from '../app/sidebarState'
import { Button, Kbd } from '../components/ui'
import { setSoundsEnabled, soundsEnabled } from '../sound/sounds'
import { accountErrorMessage, useAvatar, useCurrentAccount } from './welcome/accountSession'
import { SettingsRow, SettingsToggle } from './settings/controls'
import { forgetNotesView } from './notes/notesSession'
import { PageShell } from './PageShell'
import './settings/settings.css'

type SettingsSection =
  | 'account'
  | 'appearance'
  | 'connections'
  | 'shortcuts'
  | 'about'

const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'connections', label: 'Connections' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' }
]

const SHORTCUT_GROUPS: readonly { title: string; rows: readonly { keys: readonly string[]; label: string }[] }[] = [
  {
    title: 'Everywhere',
    rows: [
      { keys: ['⌘', '1'], label: 'Home, then ⌘2 through ⌘9 for the other pages in sidebar order' },
      { keys: ['⌘', '\\'], label: 'Collapse or dock the sidebar' },
      { keys: ['⌘', 'N'], label: 'New task, habit, role, or note on the page that creates them' },
      { keys: ['Esc'], label: 'Clear a search field, or close the topmost menu or dialog' }
    ]
  },
  {
    title: 'Home',
    rows: [
      { keys: ['⌘', 'Z'], label: 'Undo the last completion or deletion' },
      { keys: ['Enter'], label: 'Create or save the task in an open task dialog' },
      { keys: ['⇧', 'F10'], label: 'Open the task actions menu' }
    ]
  },
  {
    title: 'History views',
    rows: [
      { keys: ['←', '→'], label: 'Previous or next month while the month stepper has focus; click the month name to return to this month' },
      { keys: ['←', '→'], label: 'Move a habit tile while its grip has focus, when tiles are in your order' }
    ]
  },
  {
    title: 'Pomodoro',
    rows: [
      { keys: ['Space'], label: 'Start, pause, or resume the timer' },
      { keys: ['Enter'], label: 'Start a focus session from the label field' }
    ]
  },
  {
    title: 'Notes',
    rows: [
      { keys: ['⌘', 'S'], label: 'Save the open note now' },
      { keys: ['⌘', '⇧', 'F'], label: 'Search notes' }
    ]
  }
]


/** Sectioned settings: nav of sections on the left, one section at a time. */
export function SettingsPage(): ReactNode {
  const accountApi = useManorService('account')
  const { search } = useLocation()
  const [section, setSection] = useState<SettingsSection>(() => search.includes('connection_') ? 'connections' : 'account')
  // A connection callback can arrive while another section is open.
  useEffect(() => { if (search.includes('connection_')) setSection('connections') }, [search])

  // Account
  const { account, setAccount } = useCurrentAccount()
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const reconnectGoogle = (): void => {
    setReconnectError(null)
    void accountApi.signInWithGoogle().catch((error: Error) => setReconnectError(error.message))
  }
  const [theme, setTheme] = useState(readThemePreference)

  const avatar = useAvatar(account !== undefined && account !== null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null)

  const pickAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (!(AVATAR_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setAvatarError('Choose a PNG, JPEG, or WebP image.')
      return
    }
    setAvatarError(null)
    setCropImageUrl(URL.createObjectURL(file))
  }

  const closeCrop = (): void => {
    if (cropImageUrl !== null) URL.revokeObjectURL(cropImageUrl)
    setCropImageUrl(null)
  }

  const saveCroppedAvatar = (base64: string): void => {
    setAvatarBusy(true)
    setAvatarError(null)
    accountApi
      .setAvatar({ base64, contentType: 'image/jpeg' })
      .then((url) => {
        setAvatarBusy(false)
        avatar.setUrl(url)
        closeCrop()
      })
      .catch((cause: unknown) => {
        setAvatarBusy(false)
        closeCrop()
        setAvatarError(accountErrorMessage(cause, 'The picture could not be uploaded. Try again.'))
      })
  }

  const signOutOfAccount = (): void => {
    setSignOutBusy(true)
    setSignOutError(null)
    accountApi
      .signOut()
      .then((outcome) => {
        setSignOutBusy(false)
        if (outcome === 'cancelled') {
          setSignOutError('Your notes have unsynced changes. Stay signed in until they finish saving.');
          return
        }
        forgetNotesView()
        setAccount(null)
      })
      .catch((cause: unknown) => {
        console.error('Sign out failed', { error: cause })
        setSignOutBusy(false)
        setSignOutError(accountErrorMessage(cause, 'Sign out failed. Try again.'))
      })
  }

  // Appearance
  const [sidebarDocked, setSidebar] = useSidebarDocked()

  const [sounds, setSounds] = useState(soundsEnabled)
  useEffect(() => {
    const refreshAppearance = (): void => {
      setTheme(readThemePreference())
      setSounds(soundsEnabled())
    }
    window.addEventListener('manor:appearance-changed', refreshAppearance)
    return () => window.removeEventListener('manor:appearance-changed', refreshAppearance)
  }, [])
  const setSoundPreference = (enabled: boolean): void => {
    setSoundsEnabled(enabled)
    setSounds(enabled)
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
                      <button
                        type="button"
                        className="set-avatar set-avatar--edit"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={avatarBusy}
                        aria-label={
                          avatar.url === null ? 'Add a profile picture' : 'Change profile picture'
                        }
                      >
                        {avatar.url !== null ? (
                          <img className="set-avatar-img" src={avatar.url} alt="" />
                        ) : (
                          account.email.charAt(0).toUpperCase()
                        )}
                        <span className="set-avatar-edit" aria-hidden="true">
                          <Camera size={12} />
                        </span>
                      </button>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept={AVATAR_CONTENT_TYPES.join(',')}
                        hidden
                        onChange={pickAvatar}
                      />
                      <AvatarCropDialog
                        open={cropImageUrl !== null}
                        imageUrl={cropImageUrl}
                        saving={avatarBusy}
                        onCancel={closeCrop}
                        onSave={saveCroppedAvatar}
                      />
                      <div className="set-account-copy">
                        <span className="set-account-name">{account.email}</span>
                        <span className="set-account-mail">Manor account</span>
                      </div>
                      <Button variant="ghost" testId="account-sign-out" onClick={signOutOfAccount} disabled={signOutBusy}>
                        Sign out
                      </Button>
                    </div>
                    {avatarError !== null ? (
                      <span className="set-signin-error" role="alert">
                        {avatarError}
                      </span>
                    ) : null}
                    {signOutError !== null ? (
                      <span className="set-signin-error" role="alert">
                        {signOutError}
                      </span>
                    ) : null}
                  </>
                ) : null}
                {account === null ? (
                  <div className="set-signin">
                    <Button variant="primary" onClick={reconnectGoogle}>Reconnect Google</Button>
                    {reconnectError !== null ? <p className="set-signin-error" role="alert">{reconnectError}</p> : null}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}


          {section === 'connections' ? <><IntegrationSettings /><AgentConnections /></> : null}
          {section === 'appearance' ? (
            <section className="set-section">
              <h2 className="set-section-title">Appearance</h2>
              <div className="set-card">
                <SettingsRow label="Theme" description="Choose how Manor looks. Day and night is light from 6 AM to 6 PM.">
                  <div className="set-segment" role="group" aria-label="Theme">
                    {([['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['temporal', 'Day and night']] as const).map(([value, label]) => <button type="button" key={value} data-testid={`theme-${value}`} aria-pressed={theme === value} className={`set-segment-btn${theme === value ? ' is-active' : ''}`} onClick={() => { setThemePreference(value); setTheme(value) }}>{label}</button>)}
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

          {section === 'shortcuts' ? (
            <section className="set-section">
              <h2 className="set-section-title">Keyboard shortcuts</h2>
              {SHORTCUT_GROUPS.map((group) => (
                <div className="set-card" key={group.title}>
                  <h3 className="set-card-title">{group.title}</h3>
                  {group.rows.map((row) => (
                    <div className="set-shortcut" key={`${group.title}-${row.keys.join('-')}-${row.label}`}>
                      <Kbd keys={row.keys} />
                      <span>{row.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ) : null}

          {section === 'about' ? (
            <section className="set-section">
              <h2 className="set-section-title">About</h2>
              <div className="set-card">
                <SettingsRow label="Manor" description="Version">
                  <span className="set-version tnum">{__MANOR_VERSION__}</span>
                </SettingsRow>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageShell>
  )
}
