import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { JobRole, JobRoleFields, JobStage } from '../../../../shared/jobs'
import { Button, DatePicker, Input, Modal, Select } from '../../components/ui'
import { ResumeField } from './ResumeField'
import { jobStageOptions, roleFields, sameRoleFields } from './jobsModel'

type JobDateField =
  | 'datePosted'
  | 'appliedDate'
  | 'oaDueDate'
  | 'interview1Date'
  | 'interview2Date'
  | 'interview3Date'
  | 'decisionDate'

const DATE_FIELDS: readonly { field: JobDateField; label: string }[] = [
  { field: 'datePosted', label: 'Date posted' },
  { field: 'appliedDate', label: 'Applied date' },
  { field: 'oaDueDate', label: 'OA due date' },
  { field: 'interview1Date', label: 'Round 1 interview date' },
  { field: 'interview2Date', label: 'Round 2 interview date' },
  { field: 'interview3Date', label: 'Round 3 interview date' },
  { field: 'decisionDate', label: 'Decision date' }
]

export interface JobDetailModalProps {
  role: JobRole | null
  open: boolean
  onClose: () => void
  /** Resolves once the edits are persisted; a rejection keeps the modal open. */
  onSave: (roleId: string, fields: JobRoleFields) => Promise<void>
}

function isJobStage(value: string): value is JobStage {
  return jobStageOptions.some((option) => option.value === value)
}

export function JobDetailModal({ role, open, onClose, onSave }: JobDetailModalProps): ReactNode {
  const [fields, setFields] = useState<JobRoleFields | null>(
    role === null ? null : roleFields(role)
  )
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && role !== null) {
      setFields(roleFields(role))
      setConfirmDiscard(false)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [open, role])

  if (role === null || fields === null) {
    return null
  }

  const ready = fields.company.trim() !== '' && fields.role.trim() !== ''
  const dirty = !sameRoleFields(fields, roleFields(role))

  // Escape, scrim, and Cancel all prompt before discarding unsaved edits.
  const requestClose = (): void => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    onSave(role.id, {
      ...fields,
      company: fields.company.trim(),
      role: fields.role.trim(),
      location: fields.location.trim(),
      postingLink: fields.postingLink.trim()
    }).catch((error: unknown) => {
      setSubmitError(
        `Could not save the changes: ${error instanceof Error ? error.message : String(error)}`
      )
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <>
    <Modal open={open} onClose={requestClose} width={720} ariaLabel={`${role.company} role details`}>
      <form className="jobdetail" onSubmit={submit}>
        <header className="jobdetail-head">
          <div>
            <span className="jobdetail-kicker">Role details</span>
            <h2>{role.company}</h2>
          </div>
        </header>

        <div className="jobdetail-body">
          <section className="jobdetail-section" aria-labelledby="jobdetail-role-title">
            <h3 id="jobdetail-role-title">Role</h3>
            <div className="jobdetail-grid">
              <label className="jobdetail-field">
                <span>Company</span>
                <Input value={fields.company} onChange={(company) => setFields((current) => current === null ? null : ({ ...current, company }))} placeholder="Company" ariaLabel="Company" autoFocus />
              </label>
              <label className="jobdetail-field">
                <span>Role</span>
                <Input value={fields.role} onChange={(nextRole) => setFields((current) => current === null ? null : ({ ...current, role: nextRole }))} placeholder="Role" ariaLabel="Role" />
              </label>
              <label className="jobdetail-field">
                <span>Location</span>
                <Input value={fields.location} onChange={(location) => setFields((current) => current === null ? null : ({ ...current, location }))} placeholder="Not set" ariaLabel="Location" />
              </label>
              <div className="jobdetail-field">
                <span>Stage</span>
                <Select
                  value={fields.stage}
                  options={jobStageOptions}
                  onChange={(value) => {
                    if (isJobStage(value)) {
                      setFields((current) => current === null ? null : ({ ...current, stage: value }))
                    }
                  }}
                  placeholder="Select stage"
                  ariaLabel="Stage"
                />
              </div>
              <label className="jobdetail-field jobdetail-field--wide">
                <span>Posting link</span>
                <span className="jobdetail-link">
                  <Input value={fields.postingLink} onChange={(postingLink) => setFields((current) => current === null ? null : ({ ...current, postingLink }))} placeholder="Not set" ariaLabel="Posting link" />
                  {fields.postingLink !== '' ? (
                    <a href={fields.postingLink} target="_blank" rel="noreferrer" aria-label="Open posting">
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </span>
              </label>
              <div className="jobdetail-field jobdetail-field--wide">
                <span>Resume</span>
                <ResumeField
                  value={fields.resumeId ?? null}
                  onChange={(resumeId) => setFields((current) => current === null ? null : ({ ...current, resumeId }))}
                />
              </div>
            </div>
          </section>

          <section className="jobdetail-section" aria-labelledby="jobdetail-dates-title">
            <h3 id="jobdetail-dates-title">Dates</h3>
            <div className="jobdetail-dates">
              {DATE_FIELDS.map(({ field, label }) => (
                <div key={field} className="jobdetail-date-field">
                  <span>{label}</span>
                  <DatePicker
                    value={fields[field]}
                    ariaLabel={label}
                    min={null}
                    max={null}
                    onChange={(date) => setFields((current) => current === null ? null : ({
                      ...current,
                      [field]: date
                    }))}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="jobdetail-actions">
          {submitError !== null ? (
            <div className="jobdetail-error" role="alert">{submitError}</div>
          ) : null}
          <Button variant="ghost" onClick={requestClose}>Cancel</Button>
          <button className="ui-button ui-button--primary" type="submit" disabled={!ready || submitting}>
            Save changes
          </button>
        </footer>
      </form>
    </Modal>
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      width={380}
      ariaLabel="Discard changes"
    >
      <div className="ui-confirm">
        <h2>Discard changes?</h2>
        <p>Your edits to this role have not been saved.</p>
        <div className="ui-confirm-actions">
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmDiscard(false)
              onClose()
            }}
          >
            Discard
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
