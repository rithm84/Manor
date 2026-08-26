import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

import type { ResumeVersion } from '../../../../shared/resumes'
import { Button, Input, Select } from '../../components/ui'
import type { SelectOption } from '../../components/ui'

/** Sentinel Select value for "no resume attached" (real ids are UUIDs). */
const NO_RESUME = ''

type ResumeAccess = 'checking' | 'signed-out' | 'ready'

interface PendingUpload {
  fileName: string
  base64: string
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error(`Could not read ${file.name} as a data URL`))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = (): void => {
      reject(new Error(`Could not read ${file.name}`))
    }
    reader.readAsDataURL(file)
  })
}

export interface ResumeFieldProps {
  value: string | null
  onChange: (resumeId: string | null) => void
}

/** Property control for the resume version a role was applied with: a
    version picker plus an inline PDF upload path. Renders a quiet note
    instead of controls when the user is signed out. */
export function ResumeField({ value, onChange }: ResumeFieldProps): ReactNode {
  const [access, setAccess] = useState<ResumeAccess>('checking')
  const [versions, setVersions] = useState<readonly ResumeVersion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.manor.account
      .current()
      .then((account) => {
        if (cancelled) return
        if (account === null) {
          setAccess('signed-out')
          return
        }
        return window.manor.resumes.list().then((list) => {
          if (!cancelled) {
            setVersions(list)
            setAccess('ready')
          }
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAccess('ready')
          setLoadError(`Could not load resume versions: ${toMessage(error)}`)
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  if (access === 'signed-out') {
    return <span className="resumefield-note">Sign in to attach resume versions.</span>
  }

  const selected = value === null ? undefined : versions.find((version) => version.id === value)
  const options: readonly SelectOption[] = [
    { value: NO_RESUME, label: 'None' },
    ...versions.map((version) => ({ value: version.id, label: version.label })),
    ...(value !== null && selected === undefined && access === 'ready'
      ? [{ value, label: 'Removed version' }]
      : [])
  ]

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files === null ? undefined : event.target.files[0]
    event.target.value = ''
    if (file === undefined) return
    setUploadError(null)
    readFileBase64(file)
      .then((base64) => setPending({ fileName: file.name, base64 }))
      .catch((error: unknown) => setUploadError(toMessage(error)))
  }

  const confirmUpload = (): void => {
    if (pending === null || label.trim() === '' || uploading) return
    setUploading(true)
    setUploadError(null)
    window.manor.resumes
      .upload({ label: label.trim(), fileName: pending.fileName, base64: pending.base64 })
      .then((version) => {
        setVersions((current) => [...current, version])
        onChange(version.id)
        setPending(null)
        setLabel('')
      })
      .catch((error: unknown) => {
        setUploadError(`Could not upload ${pending.fileName}: ${toMessage(error)}`)
      })
      .finally(() => {
        setUploading(false)
      })
  }

  return (
    <div className="resumefield">
      <Select
        value={value ?? NO_RESUME}
        options={options}
        onChange={(next) => onChange(next === NO_RESUME ? null : next)}
        placeholder="None"
        ariaLabel="Resume"
      />
      {selected !== undefined ? (
        <span className="resumefield-meta">
          {selected.label} · {selected.fileName}
        </span>
      ) : null}
      {pending === null ? (
        <div className="resumefield-actions">
          <Button
            variant="ghost"
            icon={<Upload size={14} />}
            onClick={() => fileRef.current?.click()}
          >
            Upload new version
          </Button>
        </div>
      ) : (
        <div className="resumefield-pending">
          <span className="resumefield-file">{pending.fileName}</span>
          <Input
            value={label}
            onChange={setLabel}
            placeholder="Version label"
            ariaLabel="Version label"
            autoFocus
          />
          <div className="resumefield-pending-actions">
            <Button
              variant="ghost"
              disabled={uploading}
              onClick={() => {
                setPending(null)
                setLabel('')
                setUploadError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="subtle"
              disabled={label.trim() === '' || uploading}
              onClick={confirmUpload}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
      )}
      {loadError !== null ? (
        <span className="resumefield-error" role="alert">{loadError}</span>
      ) : null}
      {uploadError !== null ? (
        <span className="resumefield-error" role="alert">{uploadError}</span>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="resumefield-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFilePicked}
      />
    </div>
  )
}
