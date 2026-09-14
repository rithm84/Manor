import type { ReactNode } from 'react'
import type { AccountApi } from '../../shared/account'
import type { ResumesApi } from '../../shared/resumes'
import { ManorServicesProvider } from '../services/ManorServices'
import { AccountProvider } from '../../web/accountContext'

/** Layout tests may read session state; mutations fail if accidentally invoked. */
function unexpectedMutation(): never {
  throw new Error('A layout test unexpectedly invoked a mutation')
}

const account: AccountApi = {
  connections: async () => [],
  revokeConnection: unexpectedMutation,
  connectionRequest: unexpectedMutation,
  approveConnection: unexpectedMutation,
  denyConnection: unexpectedMutation,
  current: async () => null,
  avatarUrl: async () => null,
  signInWithGoogle: unexpectedMutation,
  signOut: unexpectedMutation,
  setAvatar: unexpectedMutation
}
const resumes: ResumesApi = {
  list: async () => [],
  upload: unexpectedMutation,
  remove: unexpectedMutation
}

export function ViewTestServices({ children }: { children: ReactNode }): ReactNode {
  return <AccountProvider account={{ id: 'layout-test', name: 'Test user', email: 'layout@example.invalid', timezone: 'America/Los_Angeles' }}><ManorServicesProvider services={{ account, resumes }}>{children}</ManorServicesProvider></AccountProvider>
}
