import { useManorService } from '../services/ManorServices'
import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'

import { AVATAR_CONTENT_TYPES } from '../../shared/account'
import { AvatarCropDialog } from './settings/AvatarCropDialog'

import { useSidebarDocked } from '../app/sidebarState'
import { Button } from '../components/ui'
import { setSoundsEnabled, soundsEnabled } from '../sound/sounds'
import { accountErrorMessage, useAvatar, useCurrentAccount, useSignIn, validateSignIn } from './welcome/accountSession'
import { SettingsRow, SettingsToggle } from './settings/controls'
import { PageShell } from './PageShell'
import './settings/settings.css'

type SettingsSection =
  | 'account'
  | 'appearance'
  | 'about'

const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' }
]


/** Sectioned settings: nav of sections on the left, one section at a time. */
export function SettingsPage(): ReactNode {
  const accountApi = useManorService('account')
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
        if (outcome === 'cancelled') return
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
                      <Button variant="ghost" onClick={signOutOfAccount} disabled={signOutBusy}>
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


          {section === 'appearance' ? (
            <section className="set-section">
              <h2 className="set-section-title">Appearance</h2>
              <div className="set-card">
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
