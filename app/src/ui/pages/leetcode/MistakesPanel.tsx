import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import type { LeetCodeNote } from '../../../shared/leetcode'

const NOTE_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

interface MistakesPanelProps {
  notes: readonly LeetCodeNote[]
  onAdd: (text: string) => Promise<void>
  onUpdate: (noteId: string, text: string, expectedRevision: number | undefined) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
}

function autoGrow(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

/** Quick jots about mistakes and recurring patterns, kept beside the week
    rail. Enter saves, Shift+Enter breaks a line, clicking a note edits it. */
export function MistakesPanel({ notes, onAdd, onUpdate, onDelete }: MistakesPanelProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingRevision, setEditingRevision] = useState<number | undefined>(undefined)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const add = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || saving) return
    setSaving(true)
    setError(null)
    try {
      await onAdd(text)
      setDraft('')
      const composer = composerRef.current
      if (composer !== null) {
        composer.value = ''
        autoGrow(composer)
      }
    } catch (saveError: unknown) {
      setError(`Could not save the note: ${saveError instanceof Error ? saveError.message : String(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async (note: LeetCodeNote): Promise<void> => {
    const text = editText.trim()
    if (text === '' || text === note.text) {
      setEditingId(null)
      return
    }
    if (saving) return
    setSaving(true)
    try {
      setError(null)
      await onUpdate(note.id, text, editingRevision)
    } catch (saveError: unknown) {
      setError(`Could not update the note: ${saveError instanceof Error ? saveError.message : String(saveError)}`)
      return
    } finally {
      setSaving(false)
    }
    setEditingId(null)
  }

  const deleteNote = async (noteId: string): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onDelete(noteId)
    } catch (deleteError: unknown) {
      setError(`Could not delete the note: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`)
    } finally {
      setSaving(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void add()
    }
  }

  return (
    <div className="lc-mistakes">
      <h2 className="lc-panel-title">Mistakes</h2>
      <textarea
        ref={composerRef}
        className="lc-mistakes-composer"
        value={draft}
        rows={1}
        maxLength={2000}
        placeholder="Jot a mistake or pattern"
        aria-label="Jot a mistake or pattern"
        onChange={(event) => {
          setDraft(event.target.value)
          autoGrow(event.target)
        }}
        onKeyDown={onComposerKeyDown}
      />
      {error !== null ? <p className="lc-mistakes-error" role="alert">{error}</p> : null}
      {notes.length === 0 ? (
        <p className="lc-mistakes-empty">What tripped you up today goes here.</p>
      ) : (
        <ul className="lc-mistakes-list" aria-label="Mistakes and patterns">
          {notes.map((note) => (
            <li key={note.id} className="lc-mistakes-row">
              {editingId === note.id ? (
                <textarea
                  autoFocus
                  className="lc-mistakes-editor"
                  value={editText}
                  maxLength={2000}
                  aria-label="Edit note"
                  onFocus={(event) => autoGrow(event.target)}
                  onChange={(event) => {
                    setEditText(event.target.value)
                    autoGrow(event.target)
                  }}
                  onBlur={() => void saveEdit(note)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void saveEdit(note)
                    }
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      setEditingId(null)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="lc-mistakes-text"
                  aria-label={`Edit note: ${note.text}`}
                  onClick={() => {
                    setEditingId(note.id)
                    setEditingRevision(note.revision)
                    setEditText(note.text)
                  }}
                >
                  {note.text}
                </button>
              )}
              <span className="lc-mistakes-meta">
                <span className="lc-mistakes-date tnum">{NOTE_DATE.format(new Date(note.createdAt))}</span>
                <button
                  type="button"
                  className="lc-mistakes-delete"
                  aria-label="Delete note"
                  title="Delete note"
                  disabled={saving}
                  onClick={() => void deleteNote(note.id)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
