import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { TERMS_VERSION } from '@/services/legal'

import { FullPageSpinner } from './FullPageSpinner'
import { ServerUnreachable } from './ServerUnreachable'
import { TermsAcceptance } from './TermsAcceptance'

/**
 * Keeps the signed-in area behind a session.
 *
 * While the status is `loading` it renders neither the page nor a redirect.
 * Redirecting on "not yet known" would bounce a signed-in user to the login
 * page on every refresh, for the fraction of a second it takes to ask the API.
 *
 * This is a convenience, not a protection: the API refuses unauthenticated
 * calls on its own. Removing this guard would leak no data, only an empty
 * shell.
 */
export function RequireAuth() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageSpinner label="Vérification de la session" />
  }

  if (status === 'unreachable') {
    return <ServerUnreachable />
  }

  if (status === 'anonymous') {
    // Carries where the user was going, so they land there after signing in
    // rather than on a generic home page.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // The current terms come before the service. The account page stays
  // reachable: exporting or deleting one's data does not wait on accepting.
  if (user && user.termsVersion !== TERMS_VERSION && location.pathname !== '/account') {
    return <TermsAcceptance />
  }

  return <Outlet />
}
