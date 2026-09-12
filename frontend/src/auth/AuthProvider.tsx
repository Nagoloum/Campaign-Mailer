import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, api } from '@/services/api'

import { AuthContext, type AuthStatus, type CurrentUser } from './context'

/**
 * Holds the session state for the whole application.
 *
 * The session lives in an httpOnly cookie the JavaScript cannot read, so the
 * only way to know who is signed in is to ask the API. That answer is fetched
 * once at start-up and refreshed after sign-out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<CurrentUser | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await api.get<{ user: CurrentUser }>('/auth/me')
      setUser(current)
      setStatus('authenticated')
    } catch (err) {
      // A 401 is the ordinary answer for a visitor, not a failure. Anything
      // else is still treated as signed out, because the application has
      // nothing useful to show without a session.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error('Could not read the session', err)
      }

      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  // The session is an httpOnly cookie the JavaScript cannot read, so who is
  // signed in can only come from the API. That is the external system this
  // rule exempts; the state is set after the answer arrives, not during the
  // render that started the request.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      // Whatever the server said, stop showing signed-in content. A failed
      // sign-out that leaves the interface unchanged is worse than a wrong
      // optimistic one.
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo(
    () => ({ status, user, signOut, refresh }),
    [status, user, signOut, refresh],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
