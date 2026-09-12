import { createContext } from 'react'

export interface CurrentUser {
  id: string
  email: string
  createdAt: string
}

/**
 * Three states, not a boolean plus a flag.
 *
 * `loading` is a real state, not the absence of a user: rendering the login
 * page while the session is still being checked flashes it in front of someone
 * who is already signed in.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  user: CurrentUser | null
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
