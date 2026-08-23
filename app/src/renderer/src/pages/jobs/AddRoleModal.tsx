import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type { JobRoleFields, JobStage } from '../../../../shared/jobs'
import { Button, DatePicker, Input, Modal, Select } from '../../components/ui'
import { emptyJobRoleFields, jobStageOptions } from './jobsModel'

export interface AddRoleModalProps {
  open: boolean
  onClose: () => void
  onAdd: (fields: JobRoleFields) => void
}

function isJobStage(value: string): value is JobStage {
  return jobStageOptions.some((option) => option.value === value)
}

export function AddRoleModal({ open, onClose, onAdd }: AddRoleModalProps): ReactNode {
  const [fields, setFields] = useState<JobRoleFields>(() => emptyJobRoleFields('to_apply'))

  useEffect(() => {
    if (open) {
      setFields(emptyJobRoleFields('to_apply'))
    }
  }, [open])

  const ready = fields.company.trim() !== '' && fields.role.trim() !== ''

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready) return
    onAdd({
      ...fields,
      company: fields.company.trim(),
      role: fields.role.trim(),
      location: fields.location.trim(),
      postingLink: fields.postingLink.trim()
    })
  }

  return (
    <Modal open={open} onClose={onClose} width={520} ariaLabel="Add a role">
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
        </div>
        <div className="addrole-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <button className="ui-button ui-button--primary" type="submit" disabled={!ready}>
            Add role
          </button>
        </div>
      </form>
    </Modal>
  )
}
