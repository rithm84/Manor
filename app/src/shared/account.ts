/** Manor cloud account (Supabase Auth). Authentication is supplied by the web application. */

export interface AccountInfo {
  userId: string
  email: string
}

export interface SignInMutation {
  email: string
  password: string
}

export interface AvatarUpload {
  /** Image bytes, base64-encoded. */
  base64: string
  contentType: AvatarContentType
}

export type AvatarContentType = 'image/png' | 'image/jpeg' | 'image/webp'

export const AVATAR_CONTENT_TYPES: readonly AvatarContentType[] = [
  'image/png',
  'image/jpeg',
  'image/webp'
]

const AVATAR_MAX_BYTES = 5 * 1024 * 1024

export interface AccountApi {
  signIn: (mutation: SignInMutation) => Promise<AccountInfo>
  signUp: (mutation: SignInMutation) => Promise<AccountInfo>
  signOut: () => Promise<'signedOut' | 'cancelled'>
  current: () => Promise<AccountInfo | null>
  /** Signed display URL for the profile picture, or null when none is set. */
  avatarUrl: () => Promise<string | null>
  /** Create or replace the profile picture; resolves to its fresh signed URL. */
  setAvatar: (upload: AvatarUpload) => Promise<string>
}

export function parseSignInMutation(value: unknown): SignInMutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Sign in requires an email and password object')
  }
  const mutation = value as Record<string, unknown>
  if (typeof mutation.email !== 'string' || !mutation.email.includes('@')) {
    throw new TypeError('Sign in requires a valid email address')
  }
  if (typeof mutation.password !== 'string' || mutation.password === '') {
    throw new TypeError('Sign in requires a password')
  }
  return { email: mutation.email, password: mutation.password }
}

export function parseAvatarUpload(value: unknown): AvatarUpload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('A profile picture upload requires an image object')
  }
  const upload = value as Record<string, unknown>
  const contentType = upload.contentType
  if (
    typeof contentType !== 'string' ||
    !(AVATAR_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    throw new TypeError('Profile pictures must be a PNG, JPEG, or WebP image')
  }
  if (typeof upload.base64 !== 'string' || upload.base64 === '') {
    throw new TypeError('A profile picture upload requires image data')
  }
  // Base64 inflates bytes by 4/3; compare in encoded space to skip a decode.
  if (upload.base64.length > (AVATAR_MAX_BYTES / 3) * 4) {
    throw new TypeError('Profile pictures must be 5 MB or smaller')
  }
  return { base64: upload.base64, contentType: contentType as AvatarContentType }
}
