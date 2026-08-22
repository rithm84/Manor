import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Input, Modal, Select } from '../../components/ui'
import type { JobColumn } from './jobsModel'

export type AddRoleDestination = 'toapply' | JobColumn

export interface RoleDraft {
  company: string
  role: string
  link: string
  destination: AddRoleDestination
}

export interface AddRoleModalProps {
  open: boolean
  onClose: () => void
  onAdd: (draft: RoleDraft) => void
}

const destinationOptions = [
  { value: 'toapply', label: 'To apply' },
  { value: 'applied', label: 'Applied' },
  { value: 'oa', label: 'OA' },
  { value: 'interview', label: 'Interviews' }
] as const

function isDestination(value: string): value is AddRoleDestination {
  return destinationOptions.some((option) => option.value === value)
}

/** Manual add-a-role flow: company, role, link, stage. */
export function AddRoleModal({ open, onClose, onAdd }: AddRoleModalProps): ReactNode {
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [link, setLink] = useState('')
  const [destination, setDestination] = useState<AddRoleDestination>('toapply')

  useEffect(() => {
    if (open) {
      setCompany('')
      setRole('')
      setLink('')
      setDestination('toapply')
    }
  }, [open])

  const ready = company.trim() !== '' && role.trim() !== ''

  const submit = (): void => {
    if (!ready) {
      return
    }
    onAdd({ company: company.trim(), role: role.trim(), link: link.trim(), destination })
  }

  return (
    <Modal open={open} onClose={onClose} width={420} ariaLabel="Add a role">
      <div className="addrole">
        <div className="addrole-title">Add a role</div>
        <div className="addrole-fields">
          <label className="addrole-field">
            <span className="addrole-label">Company</span>
            <Input
              value={company}
              onChange={setCompany}
              placeholder="Anthropic"
              ariaLabel="Company"
              autoFocus
            />
          </label>
          <label className="addrole-field">
            <span className="addrole-label">Role</span>
            <Input value={role} onChange={setRole} placeholder="SWE Intern" ariaLabel="Role" />
          </label>
          <label className="addrole-field">
            <span className="addrole-label">Link</span>
            <Input
              value={link}
              onChange={setLink}
              placeholder="Paste the posting"
              ariaLabel="Posting link"
            />
          </label>
          <div className="addrole-field">
            <span className="addrole-label">Stage</span>
            <Select
              value={destination}
              options={destinationOptions}
              onChange={(value) => {
                if (isDestination(value)) {
                  setDestination(value)
                }
              }}
              placeholder="Pick a stage"
              ariaLabel="Stage"
            />
          </div>
        </div>
        <div className="addrole-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            Add role
          </Button>
        </div>
      </div>
    </Modal>
  )
}
