import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type {
  AddLeetCodeAttemptMutation,
  LeetCodeAttempt,
  LeetCodeProblem,
  UpdateLeetCodeAttemptMutation
} from '../../../../shared/leetcode'
import { Button, Modal, Pill } from '../../components/ui'
import { errorMessage, formatAttemptDate, previousIsoDate } from './leetCodeModel'

export interface ProblemReviewModalProps {
  problem: LeetCodeProblem
  attempts: readonly LeetCodeAttempt[]
  today: string
  onClose: () => void
  onAddAttempt: (mutation: AddLeetCodeAttemptMutation) => Promise<void>
  onUpdateAttempt: (mutation: UpdateLeetCodeAttemptMutation) => Promise<void>
  onDeleteAttempt: (attemptId: string) => Promise<void>
}

interface EditorProps {
  date: string
  solution: string
  dateLabel: string
  solutionLabel: string
  autoFocus: boolean
  minDate: string | null
  maxDate: string | null
  onDateChange: (date: string) => void
  onSolutionChange: (solution: string) => void
}

function SolutionEditor({
  date,
  solution,
  dateLabel,
  solutionLabel,
  autoFocus,
  minDate,
  maxDate,
  onDateChange,
  onSolutionChange
}: EditorProps): ReactNode {
  return (
    <div className="lc-attempt-fields">
      <label className="lc-field lc-field--date">
        <span>{dateLabel}</span>
        <input
          type="date"
          value={date}
          min={minDate ?? undefined}
          max={maxDate ?? undefined}
          required
          onChange={(event) => onDateChange(event.currentTarget.value)}
        />
      </label>
      <label className="lc-field lc-field--solution">
        <span>{solutionLabel}</span>
        <textarea
          value={solution}
          required
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          wrap="off"
          onChange={(event) => onSolutionChange(event.currentTarget.value)}
          placeholder="Paste your solution here"
        />
      </label>
    </div>
  )
}

/** Centered problem record with repeatable solve and review history. */
export function ProblemReviewModal({
  problem,
  attempts,
  today,
  onClose,
  onAddAttempt,
  onUpdateAttempt,
  onDeleteAttempt
}: ProblemReviewModalProps): ReactNode {
  const [newDate, setNewDate] = useState(today)
  const [newSolution, setNewSolution] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState(today)
  const [editSolution, setEditSolution] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNewDate(today)
    setNewSolution('')
    setEditingId(null)
    setDeleteCandidate(null)
    setError(null)
  }, [problem.id, today])

  const saveNewAttempt = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onAddAttempt({ problemId: problem.id, date: newDate, solution: newSolution })
      setNewDate(today)
      setNewSolution('')
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  const saveEditedAttempt = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (editingId === null) {
      throw new Error('Cannot save attempt edit without an attempt id')
    }
    setSubmitting(true)
    setError(null)
    try {
      await onUpdateAttempt({ attemptId: editingId, date: editDate, solution: editSolution })
      setEditingId(null)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteAttempt = async (attemptId: string): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      await onDeleteAttempt(attemptId)
      setDeleteCandidate(null)
      if (editingId === attemptId) {
        setEditingId(null)
      }
    } catch (deleteError) {
      setError(errorMessage(deleteError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} width={860} ariaLabel={`${problem.name} solve and review history`}>
      <article className="lc-review-modal">
        <header className="lc-review-header">
          <div>
            <span className="lc-review-kicker">{problem.topic}</span>
            <h2>{problem.name}</h2>
            <div className="lc-review-meta">
              <Pill
                variant="tag"
                colorway={problem.difficulty === 'Easy' ? 'success' : problem.difficulty === 'Medium' ? 'today' : 'overdue'}
                label={problem.difficulty}
              />
              <span className="tnum">
                {attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'}
              </span>
              {attempts.length > 0 ? (
                <span className="lc-review-solved">
                  <Check size={13} aria-hidden="true" /> Solved
                </span>
              ) : null}
            </div>
          </div>
          <button type="button" className="lc-review-close" onClick={onClose} aria-label="Close problem review">
            <X size={17} />
          </button>
        </header>

        <div className="lc-review-body">
          <form className="lc-new-attempt" onSubmit={(event) => void saveNewAttempt(event)}>
            <div className="lc-section-heading">
              <div>
                <h3>{attempts.length === 0 ? 'Log the solve' : 'Add another attempt'}</h3>
                <p>Save the date and the exact solution you used.</p>
              </div>
            </div>
            <SolutionEditor
              date={newDate}
              solution={newSolution}
              dateLabel="Solved or reviewed"
              solutionLabel="Solution"
              autoFocus
              minDate={previousIsoDate(today)}
              maxDate={today}
              onDateChange={setNewDate}
              onSolutionChange={setNewSolution}
            />
            <div className="lc-attempt-actions">
              <button
                type="submit"
                className="ui-button ui-button--primary"
                disabled={submitting || newSolution.trim() === '' || newDate === ''}
              >
                <Plus size={15} aria-hidden="true" />
                Save attempt
              </button>
            </div>
          </form>

          {error === null ? null : <p className="lc-error" role="alert">{error}</p>}

          <section className="lc-history" aria-labelledby="lc-attempt-history-heading">
            <div className="lc-section-heading">
              <div>
                <h3 id="lc-attempt-history-heading">Attempt history</h3>
                <p>Most recent first.</p>
              </div>
            </div>

            {attempts.length === 0 ? (
              <p className="lc-history-empty">No attempts yet. Your first saved solution will appear here.</p>
            ) : (
              <ol className="lc-attempt-list">
                {attempts.map((attempt, index) => {
                  const attemptNumber = attempts.length - index
                  const editing = editingId === attempt.id
                  const confirmingDelete = deleteCandidate === attempt.id
                  return (
                    <li key={attempt.id} className="lc-attempt">
                      <div className="lc-attempt-header">
                        <div>
                          <span className="lc-attempt-number tnum">Attempt {attemptNumber}</span>
                          <time dateTime={attempt.date}>{formatAttemptDate(attempt.date)}</time>
                        </div>
                        <div className="lc-attempt-menu">
                          {confirmingDelete ? (
                            <>
                              <span>Delete this attempt?</span>
                              <button type="button" onClick={() => setDeleteCandidate(null)} disabled={submitting}>Cancel</button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => void deleteAttempt(attempt.id)}
                                disabled={submitting}
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(attempt.id)
                                  setEditDate(attempt.date)
                                  setEditSolution(attempt.solution)
                                  setDeleteCandidate(null)
                                }}
                                disabled={submitting}
                                aria-label={`Edit attempt ${attemptNumber}`}
                              >
                                <Pencil size={13} aria-hidden="true" /> Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteCandidate(attempt.id)}
                                disabled={submitting}
                                aria-label={`Delete attempt ${attemptNumber}`}
                              >
                                <Trash2 size={13} aria-hidden="true" /> Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {editing ? (
                        <form className="lc-edit-attempt" onSubmit={(event) => void saveEditedAttempt(event)}>
                          <SolutionEditor
                            date={editDate}
                            solution={editSolution}
                            dateLabel="Solved or reviewed"
                            solutionLabel="Solution"
                            autoFocus={false}
                            minDate={null}
                            maxDate={null}
                            onDateChange={setEditDate}
                            onSolutionChange={setEditSolution}
                          />
                          <div className="lc-attempt-actions">
                            <Button variant="subtle" onClick={() => setEditingId(null)} disabled={submitting}>Cancel</Button>
                            <button
                              type="submit"
                              className="ui-button ui-button--primary"
                              disabled={submitting || editSolution.trim() === '' || editDate === ''}
                            >
                              Save changes
                            </button>
                          </div>
                        </form>
                      ) : attempt.solution === '' ? (
                        <p className="lc-imported-empty">No solution was saved with this imported attempt.</p>
                      ) : (
                        <pre className="lc-solution"><code>{attempt.solution}</code></pre>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>
      </article>
    </Modal>
  )
}
