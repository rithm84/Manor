import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

export interface ManorAccount {
  id: string
  name: string
  email: string
  timezone: string
}

const AccountContext = createContext<ManorAccount | null>(null)

export function AccountProvider({ account, children }: { account: ManorAccount; children: ReactNode }): ReactNode {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>
}

export function useManorAccount(): ManorAccount {
  const account = useContext(AccountContext)
  if (!account) throw new Error('Manor account is unavailable outside an authenticated session')
  return account
}

export function useAccountTimezone(): string {
  return useManorAccount().timezone
}
