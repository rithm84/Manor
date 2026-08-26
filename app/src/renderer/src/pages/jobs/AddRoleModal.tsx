import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { JobRoleFields, JobStage } from '../../../../shared/jobs'
import { Button, DatePicker, Input, Modal, Select } from '../../components/ui'
import { ResumeField } from './ResumeField'
import { emptyJobRoleFields, jobStageOptions, sameRoleFields } from './jobsModel'

export interface AddRoleModalProps {
  open: boolean
  onClose: () => void
  /** Resolves once the role is persisted; a rejection keeps the modal open. */
  onAdd: (fields: JobRoleFields) => Promise<void>
}

function isJobStage(value: string): value is JobStage {
  return jobStageOptions.some((option) => option.value === value)
}

export function AddRoleModal({ open, onClose, onAdd }: AddRoleModalProps): ReactNode {
  const [fields, setFields] = useState<JobRoleFields>(() => emptyJobRoleFields('to_apply'))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setFields(emptyJobRoleFields('to_apply'))
      setConfirmDiscard(false)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [open])

  const ready = fields.company.trim() !== '' && fields.role.trim() !== ''
  const dirty = !sameRoleFields(fields, emptyJobRoleFields('to_apply'))

  // Escape, scrim, and Cancel all prompt before discarding typed fields.
  const requestClose = (): void => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    onAdd({
      ...fields,
      company: fields.company.trim(),
      role: fields.role.trim(),
      location: fields.location.trim(),
      postingLink: fields.postingLink.trim()
    }).catch((error: unknown) => {
      setSubmitError(
        `Could not add the role: ${error instanceof Error ? error.message : String(error)}`
      )
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <>
    <Modal open={open} onClose={requestClose} width={520} ariaLabel="Add a role">
      <form className="addrole" onSubmit={submit}>
        <div className="addrole-title">Add a role</div>
        <div className="addrole-fields">
          <label className="addrole-field">
            <span className="addrole-label">Company</span>
            <Input
              value={fields.company}
              onChange={(company) => setFields((current) => ({ ...current, company }))}
              placeholder="Anthropic"
              ariaLabel="Company"
              autoFocus
            />
          </label>
          <label className="addrole-field">
            <span className="addrole-label">Role</span>
            <Input
              value={fields.role}
              onChange={(role) => setFields((current) => ({ ...current, role }))}
              placeholder="SWE Intern"
              ariaLabel="Role"
            />
          </label>
          <label className="addrole-field">
            <span className="addrole-label">Location</span>
            <Input
              value={fields.location}
              onChange={(location) => setFields((current) => ({ ...current, location }))}
              placeholder="San Francisco, CA"
              ariaLabel="Location"
            />
          </label>
          <label className="addrole-field">
            <span className="addrole-label">Posting link</span>
            <Input
              value={fields.postingLink}
              onChange={(postingLink) => setFields((current) => ({ ...current, postingLink }))}
              placeholder="https://"
              ariaLabel="Posting link"
            />
          </label>
          <div className="addrole-field">
            <span className="addrole-label">Date posted</span>
            <DatePicker
              value={fields.datePosted}
              ariaLabel="Date posted"
              min={null}
              max={null}
              onChange={(datePosted) => setFields((current) => ({
                ...current,
                datePosted
              }))}
            />
          </div>
          <div className="addrole-field">
            <span className="addrole-label">Initial stage</span>
            <Select
              value={fields.stage}
              options={jobStageOptions}
              onChange={(value) => {
                if (isJobStage(value)) {
                  setFields((current) => ({ ...current, stage: value }))
                }
              }}
              placeholder="Pick a stage"
              ariaLabel="Initial stage"
            />
          </div>
          <div className="addrole-field addrole-field--wide">
            <span className="addrole-label">Resume</span>
            <ResumeField
              value={fields.resumeId ?? null}
              onChange={(resumeId) => setFields((current) => ({ ...current, resumeId }))}
            />
          </div>
        </div>
        {submitError !== null ? (
          <div className="addrole-error" role="alert">{submitError}</div>
        ) : null}
        <div className="addrole-actions">
          <Button variant="ghost" onClick={requestClose}>Cancel</Button>
          <button className="ui-button ui-button--primary" type="submit" disabled={!ready || submitting}>
            Add role
          </button>
        </div>
      </form>
    </Modal>
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      width={380}
      ariaLabel="Discard this role"
    >
      <div className="ui-confirm">
        <h2>Discard this role?</h2>
        <p>It has not been added yet.</p>
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
