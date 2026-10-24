import { usePortalContainer } from '../../components/ui/PortalContainer'
import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, CloudCheck, CloudOff, LoaderCircle, Maximize2, Minimize2, Minus, Plus, RotateCcw, Settings2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemLanguage } from '../../../shared/problemExecution'
import { problemLanguageLabels } from '../../../shared/problemExecution'
import type { CodeDraftStatus } from '../../../web/problems/ProblemDraftSession'
import { Tooltip } from '../../components/ui'
import { useDevicePreference } from '../../preferences/devicePreference'

export interface EditorSettings { readonly fontSize: number; readonly tabSize: number }

const fontSizes = ['12', '13', '14', '15', '16', '17', '18', '20', '22', '24'] as const
const tabSizes = ['2', '4', '8'] as const

/** Editor font and indentation are remembered on this device. */
export function useEditorSettings(): [EditorSettings, (next: EditorSettings) => void] {
  const [fontSize, setFontSize] = useDevicePreference<typeof fontSizes[number]>('problems.editor-font-size', fontSizes, '14')
  const [tabSize, setTabSize] = useDevicePreference<typeof tabSizes[number]>('problems.editor-tab-size', tabSizes, '4')
  const update = (next: EditorSettings): void => {
    const font = fontSizes.find(value => Number(value) === next.fontSize)
    const tab = tabSizes.find(value => Number(value) === next.tabSize)
    if (font === undefined || tab === undefined) throw new Error(`Unsupported editor settings: font size ${next.fontSize}, tab size ${next.tabSize}`)
    setFontSize(font); setTabSize(tab)
  }
  return [{ fontSize: Number(fontSize), tabSize: Number(tabSize) }, update]
}

type SaveView = 'none' | 'idle' | 'saving' | 'justSaved' | 'queued' | 'attention'
const savingDelayMs = 300
const justSavedMs = 1500
/** A cloud save waits about 600 ms after typing stops; local-only code that stays unsynced well past that is queued. */
const queuedDelayMs = 2000

/**
 * Turns the draft session's status into a quiet save indicator. Fast saves show nothing new; a save that takes
 * longer than 300 ms shows "Saving…", then a check that settles back to the idle cloud.
 */
function useSaveView(status: CodeDraftStatus, conflict: boolean): { view: SaveView; savedAt: Date | null } {
  const [view, setView] = useState<SaveView>('none')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const shownSaving = useRef(false)
  useEffect(() => {
    if (status === 'failed' || conflict) { shownSaving.current = false; setView('attention'); return }
    if (status === 'loading') { shownSaving.current = false; setView('none'); return }
    if (status === 'saved') {
      setSavedAt(new Date())
      if (!shownSaving.current) { setView('idle'); return }
      shownSaving.current = false
      setView('justSaved')
      const timer = setTimeout(() => setView('idle'), justSavedMs)
      return () => clearTimeout(timer)
    }
    if (status === 'protected') {
      const timer = setTimeout(() => { shownSaving.current = false; setView('queued') }, queuedDelayMs)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => { shownSaving.current = true; setView('saving') }, savingDelayMs)
    return () => clearTimeout(timer)
  }, [status, conflict])
  return { view, savedAt }
}

export function SaveState({ status, conflict, onResolve }: { status: CodeDraftStatus; conflict: boolean; onResolve: () => void }): ReactNode {
  const { view, savedAt } = useSaveView(status, conflict)
  const time = savedAt === null ? '' : ` at ${savedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  const content = view === 'none' ? null
    : view === 'attention' ? <Tooltip label={conflict ? 'Your code changed on another device. Compare the drafts.' : 'Your code is safe on this device but did not reach the cloud. Try again.'} side="bottom"><button type="button" className="problem-save-attention" data-testid="problem-save-resolve" onClick={onResolve}><TriangleAlert size={14} aria-hidden="true" />{conflict ? 'Compare' : 'Not synced'}</button></Tooltip>
    : view === 'saving' ? <span className="problem-save-saving"><LoaderCircle className="problem-spinner is-quiet" size={14} aria-hidden="true" />Saving…</span>
    : <Tooltip label={view === 'queued' ? 'Saved on this device. It syncs to the cloud when it can.' : `Saved to cloud${time}`} side="bottom"><span className="problem-save-icon" role="img" aria-label={view === 'queued' ? 'Saved on this device' : `Saved to cloud${time}`}>{view === 'justSaved' ? <Check size={14} aria-hidden="true" /> : view === 'queued' ? <CloudOff size={14} aria-hidden="true" /> : <CloudCheck size={14} aria-hidden="true" />}</span></Tooltip>
  return <span className={`problem-save-state is-${view}`} role="status" data-testid="problem-draft-state" data-state={view}><span key={view} className="problem-save-state-content">{content}</span></span>
}

function SettingsPopover({ settings, onSettings }: { settings: EditorSettings; onSettings: (next: EditorSettings) => void }): ReactNode {
  const portalContainer = usePortalContainer()
  const fontIndex = fontSizes.findIndex(value => Number(value) === settings.fontSize)
  const stepFont = (direction: 1 | -1): void => { const next = fontSizes[fontIndex + direction]; if (next !== undefined) onSettings({ ...settings, fontSize: Number(next) }) }
  return <Popover.Root>
    <Tooltip label="Editor settings" side="bottom"><Popover.Trigger className="problem-icon-button" aria-label="Editor settings" data-testid="problem-editor-settings"><Settings2 size={15} aria-hidden="true" /></Popover.Trigger></Tooltip>
    <Popover.Portal container={portalContainer}>
      <Popover.Positioner className="ui-popover-positioner" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
        <Popover.Popup className="problem-settings-popup" aria-label="Editor settings" data-testid="problem-editor-settings-popup">
          <div className="problem-settings-row">
            <span id="problem-font-size-label">Font size</span>
            <div className="problem-stepper" role="group" aria-labelledby="problem-font-size-label">
              <button type="button" aria-label="Smaller font" data-testid="problem-font-smaller" disabled={fontIndex <= 0} onClick={() => stepFont(-1)}><Minus size={14} aria-hidden="true" /></button>
              <output className="tnum" data-testid="problem-font-size">{settings.fontSize}</output>
              <button type="button" aria-label="Larger font" data-testid="problem-font-larger" disabled={fontIndex >= fontSizes.length - 1} onClick={() => stepFont(1)}><Plus size={14} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="problem-settings-row">
            <span id="problem-tab-size-label">Tab size</span>
            <div className="problem-segmented" role="radiogroup" aria-labelledby="problem-tab-size-label">{tabSizes.map(value => <button type="button" key={value} role="radio" aria-checked={settings.tabSize === Number(value)} data-testid={`problem-tab-size-${value}`} className="tnum" onClick={() => onSettings({ ...settings, tabSize: Number(value) })}>{value}</button>)}</div>
          </div>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
}

interface Props {
  language: ProblemLanguage | undefined; languages: readonly ProblemLanguage[]; onLanguage: (language: ProblemLanguage) => void
  draftStatus: CodeDraftStatus; draftConflict: boolean; onResolveDraft: () => void; busy: boolean; canReset: boolean; onReset: () => void
  settings: EditorSettings; onSettings: (next: EditorSettings) => void
  fullscreen: boolean; onFullscreen: () => void
}

/** LeetCode's editor bar: the language on the left; save state, reset, settings, and full screen on the right. */
export function ProblemEditorToolbar({ language, languages, onLanguage, draftStatus, draftConflict, onResolveDraft, busy, canReset, onReset, settings, onSettings, fullscreen, onFullscreen }: Props): ReactNode {
  return <header className="problem-editor-toolbar">
    <label className="problem-language-picker"><select data-testid="problem-language" aria-label="Solution language" value={language ?? ''} disabled={busy || language === undefined} onChange={event => { const next = languages.find(value => value === event.target.value); if (next === undefined) throw new Error(`Unknown solution language: ${event.target.value}`); onLanguage(next) }}>{languages.map(value => <option key={value} value={value}>{problemLanguageLabels[value]}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
    <SaveState status={draftStatus} conflict={draftConflict} onResolve={onResolveDraft} />
    <div className="problem-editor-tools">
      <Tooltip label="Reset to starter code" side="bottom"><button type="button" className="problem-icon-button" aria-label="Reset to starter code" data-testid="problem-reset-code" disabled={busy || !canReset} onClick={onReset}><RotateCcw size={15} aria-hidden="true" /></button></Tooltip>
      <SettingsPopover settings={settings} onSettings={onSettings} />
      <Tooltip label={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'} side="bottom"><button type="button" className="problem-icon-button" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen} data-testid="problem-fullscreen" onClick={onFullscreen}>{fullscreen ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}</button></Tooltip>
    </div>
  </header>
}
