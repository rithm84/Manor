import type { ReactNode } from 'react'
import type { AccountApi } from '../../shared/account'
import type { ResumesApi } from '../../shared/resumes'
import { ManorServicesProvider } from '../services/ManorServices'

/** Layout tests may read session state; mutations fail if accidentally invoked. */
function unexpectedMutation(): never {
  throw new Error('A layout test unexpectedly invoked a mutation')
}

const account: AccountApi = {
  current: async () => null,
  avatarUrl: async () => null,
  signIn: unexpectedMutation,
  signUp: unexpectedMutation,
  signOut: unexpectedMutation,
  setAvatar: unexpectedMutation
}
const resumes: ResumesApi = {
  list: async () => [],
  upload: unexpectedMutation,
  remove: unexpectedMutation
}

export function ViewTestServices({ children }: { children: ReactNode }): ReactNode {
  return <ManorServicesProvider services={{ account, resumes }}>{children}</ManorServicesProvider>
}
