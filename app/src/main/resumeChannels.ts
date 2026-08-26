import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { ResumeVersion } from '../shared/resumes'
import { parseResumeUpload } from '../shared/resumes'
import type { BridgeChannelHandler } from './bridgeChannels'
import { accountOf } from './supabaseCore'

interface ResumeRow {
  id: string
  label: string
  file_name: string
  byte_size: number
  uploaded_at: string
}

function versionOf(row: ResumeRow): ResumeVersion {
  return {
    id: row.id,
    label: row.label,
    fileName: row.file_name,
    byteSize: row.byte_size,
    uploadedAt: row.uploaded_at
  }
}

async function requireUserId(client: SupabaseClient): Promise<string> {
  const account = await accountOf(client)
  if (account === null) {
    throw new Error('Sign in to Manor to manage resume versions')
  }
  return account.userId
}

export function createResumeChannels(
  clientOf: () => SupabaseClient
): Record<string, BridgeChannelHandler> {
  return {
    'resumes:list': async () => {
      const client = clientOf()
      await requireUserId(client)
      const { data, error } = await client
        .from('resumes')
        .select('id, label, file_name, byte_size, uploaded_at')
        .order('uploaded_at', { ascending: false })
      if (error !== null) throw new Error(`Could not list resumes: ${error.message}`)
      return (data as ResumeRow[]).map(versionOf)
    },

    'resumes:upload': async (args) => {
      const upload = parseResumeUpload(args[0])
      const client = clientOf()
      const userId = await requireUserId(client)
      const bytes = Buffer.from(upload.base64, 'base64')
      const id = randomUUID()
      const storagePath = `${userId}/${id}.pdf`

      const stored = await client.storage
        .from('resumes')
        .upload(storagePath, bytes, { contentType: 'application/pdf' })
      if (stored.error !== null) {
        throw new Error(`Resume upload failed: ${stored.error.message}`)
      }

      const { data, error } = await client
        .from('resumes')
        .insert({
          id,
          label: upload.label,
          file_name: upload.fileName,
          storage_path: storagePath,
          byte_size: bytes.byteLength
        })
        .select('id, label, file_name, byte_size, uploaded_at')
        .single()
      if (error !== null) {
        throw new Error(`Resume record failed: ${error.message}`)
      }
      return versionOf(data as ResumeRow)
    },

    'resumes:remove': async (args) => {
      const resumeId = args[0]
      if (typeof resumeId !== 'string' || resumeId === '') {
        throw new TypeError('Removing a resume requires its id')
      }
      const client = clientOf()
      const userId = await requireUserId(client)
      const removedObject = await client.storage
        .from('resumes')
        .remove([`${userId}/${resumeId}.pdf`])
      if (removedObject.error !== null) {
        throw new Error(`Resume file removal failed: ${removedObject.error.message}`)
      }
      const { error } = await client.from('resumes').delete().eq('id', resumeId)
      if (error !== null) {
        throw new Error(`Resume record removal failed: ${error.message}`)
      }
      return null
    }
  }
}
