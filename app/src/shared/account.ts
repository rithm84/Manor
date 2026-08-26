/** Manor cloud account (Supabase Auth). The main process owns the session. */

export interface AccountInfo {
  userId: string
  email: string
}

export interface SignInMutation {
  email: string
  password: string
}

export interface AccountApi {
  signIn: (mutation: SignInMutation) => Promise<AccountInfo>
  signUp: (mutation: SignInMutation) => Promise<AccountInfo>
  signOut: () => Promise<void>
  current: () => Promise<AccountInfo | null>
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
