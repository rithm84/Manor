import { ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { JobRole, JobRoleFields, JobStage } from '../../../shared/jobs'
import { Button, DatePicker, Input, Modal, Select } from '../../components/ui'
import { ResumeField } from './ResumeField'
import { columnForStage, jobStageOptions, roleFields, sameRoleFields } from './jobsModel'
import type { JobColumn } from './jobsModel'

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

const STAGE_DATE: Readonly<Record<JobStage, JobDateField>> = {
  to_apply: 'datePosted', applied: 'appliedDate', oa: 'oaDueDate',
  interview_1: 'interview1Date', interview_2: 'interview2Date', interview_3: 'interview3Date',
  offer: 'decisionDate', rejected: 'decisionDate'
}

export interface JobDetailModalProps {
  role: JobRole | null
  open: boolean
  /** A board move stays a draft; grouped columns require an explicit stage choice. */
  stageRequest: JobStage | JobColumn | null
  onClose: () => void
  /** Resolves once the edits are persisted; a rejection keeps the modal open. */
  onSave: (roleId: string, fields: JobRoleFields, expectedRevision: number | undefined) => Promise<void>
}

function isJobStage(value: string): value is JobStage {
  return jobStageOptions.some((option) => option.value === value)
}

export function JobDetailModal({ role, open, stageRequest, onClose, onSave }: JobDetailModalProps): ReactNode {
  const stageOptions = stageRequest === null ? jobStageOptions : jobStageOptions.filter(
    option => option.value === stageRequest || columnForStage(option.value) === stageRequest
  )
  const initialStage = stageRequest === null ? role?.stage ?? null
    : stageOptions.length === 1 ? stageOptions[0].value : null
  const [selectedStage, setSelectedStage] = useState<JobStage | null>(initialStage)
  const [expectedRevision, setExpectedRevision] = useState(role?.revision)
  const [fields, setFields] = useState<JobRoleFields | null>(
    role === null ? null : roleFields(role)
  )
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && role !== null) {
      setFields(roleFields(role))
      setSelectedStage(initialStage)
      setExpectedRevision(role.revision)
      setConfirmDiscard(false)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [open, role?.id, stageRequest])

  if (role === null || fields === null) {
    return null
  }

  const ready = selectedStage !== null && fields.company.trim() !== '' && fields.role.trim() !== ''
  const dirty = selectedStage !== initialStage || !sameRoleFields(fields, roleFields(role))
  const primaryDate = stageRequest !== null && selectedStage !== null ? STAGE_DATE[selectedStage] : null
  const stageField = <div className="jobdetail-field">
    <span>Stage</span>
    <Select value={selectedStage} options={stageOptions} onChange={value => {
      if (isJobStage(value)) setSelectedStage(value)
    }} placeholder={stageRequest === 'decided' ? 'Choose outcome' : stageRequest === 'interview' ? 'Choose interview round' : 'Select stage'} ariaLabel="Stage" />
  </div>
  const dateField = ({ field, label }: typeof DATE_FIELDS[number]): ReactNode => (
    <div key={field} className="jobdetail-date-field">
      <span>{label}</span>
      <DatePicker value={fields[field]} ariaLabel={label} min={null} max={null}
        onChange={date => setFields(current => current === null ? null : ({ ...current, [field]: date }))} />
    </div>
  )

  // Escape, scrim, and Cancel all prompt before discarding unsaved edits.
  const requestClose = (): void => {
    if (submitting) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready || selectedStage === null || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    onSave(role.id, {
      ...fields,
      stage: selectedStage,
      company: fields.company.trim(),
      role: fields.role.trim(),
      location: fields.location.trim(),
      postingLink: fields.postingLink.trim(),
      term: fields.term?.trim() === '' ? null : fields.term?.trim() ?? null
    }, expectedRevision).catch((error: unknown) => {
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
          <button type="button" className="jobdetail-close" aria-label="Close role details" onClick={requestClose} disabled={submitting}>
            <X size={17} />
          </button>
        </header>

        <div className="jobdetail-body">
          {stageRequest !== null ? <section className="jobdetail-section" aria-labelledby="jobdetail-move-title">
            <h3 id="jobdetail-move-title">Move role</h3>
            <div className="jobdetail-grid">
              {stageField}
              {DATE_FIELDS.filter(({ field }) => field === primaryDate).map(dateField)}
            </div>
          </section> : null}
          <section className="jobdetail-section" aria-labelledby="jobdetail-role-title">
            <h3 id="jobdetail-role-title">Role</h3>
            <div className="jobdetail-grid">
              <label className="jobdetail-field">
                <span>Company</span>
                <Input value={fields.company} onChange={(company) => setFields((current) => current === null ? null : ({ ...current, company }))} placeholder="Company" ariaLabel="Company" autoFocus={stageRequest === null} />
              </label>
              <label className="jobdetail-field">
                <span>Role</span>
                <Input value={fields.role} onChange={(nextRole) => setFields((current) => current === null ? null : ({ ...current, role: nextRole }))} placeholder="Role" ariaLabel="Role" />
              </label>
              <label className="jobdetail-field jobdetail-field--wide">
                <span>Location</span>
                <Input value={fields.location} onChange={(location) => setFields((current) => current === null ? null : ({ ...current, location }))} placeholder="Not set" ariaLabel="Location" />
              </label>
              <label className="jobdetail-field">
                <span>Hiring cycle</span>
                <Input value={fields.term ?? ''} onChange={(term) => setFields((current) => current === null ? null : ({ ...current, term: term === '' ? null : term }))} placeholder="Not set" ariaLabel="Hiring cycle" />
              </label>
              {stageRequest === null ? stageField : null}
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
              {DATE_FIELDS.filter(({ field }) => field !== primaryDate).map(dateField)}
            </div>
          </section>
        </div>

        <footer className="jobdetail-actions">
          {submitError !== null ? (
            <div className="jobdetail-error" role="alert">{submitError}</div>
          ) : null}
          <Button variant="ghost" onClick={requestClose} disabled={submitting}>Cancel</Button>
          <button data-testid="jobdetail-save" className="ui-button ui-button--primary" type="submit" disabled={!ready || submitting}>
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
