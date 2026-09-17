import { useManorService } from '../../services/ManorServices'
import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

import type { ResumeVersion } from '../../../shared/resumes'
import { Button, Select } from '../../components/ui'
import type { SelectOption } from '../../components/ui'

/** Sentinel Select value for "no resume attached" (real ids are UUIDs). */
const NO_RESUME = ''

type ResumeAccess = 'checking' | 'signed-out' | 'ready'

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
  const accountApi = useManorService('account')
  const resumesApi = useManorService('resumes')
  const [access, setAccess] = useState<ResumeAccess>('checking')
  const [versions, setVersions] = useState<readonly ResumeVersion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    accountApi
      .current()
      .then((account) => {
        if (cancelled) return
        if (account === null) {
          setAccess('signed-out')
          return
        }
        return resumesApi.list().then((list) => {
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
    ...versions.map((version) => ({ value: version.id, label: version.fileName })),
    ...(value !== null && selected === undefined && access === 'ready'
      ? [{ value, label: 'Removed version' }]
      : [])
  ]

  /** The PDF's own name is the version's name; picking a file is the whole upload. */
  const onFilePicked = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files === null ? undefined : event.target.files[0]
    event.target.value = ''
    if (file === undefined || uploading !== null) return
    setUploadError(null)
    setUploading(file.name)
    readFileBase64(file)
      .then((base64) => resumesApi.upload({ label: file.name, fileName: file.name, base64 }))
      .then((version) => {
        setVersions((current) => [...current.filter((item) => item.id !== version.id), version])
        onChange(version.id)
      })
      .catch((error: unknown) => {
        setUploadError(`Could not upload ${file.name}: ${toMessage(error)}`)
      })
      .finally(() => {
        setUploading(null)
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
      <div className="resumefield-actions">
        <Button
          variant="ghost"
          icon={<Upload size={14} />}
          disabled={uploading !== null}
          onClick={() => fileRef.current?.click()}
        >
          {uploading === null ? 'Upload new version' : `Uploading ${uploading}…`}
        </Button>
      </div>
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
