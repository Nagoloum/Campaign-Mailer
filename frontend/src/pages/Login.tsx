import { Navigate, useLocation, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { LegalNav } from '@/components/LegalLayout'
import { ServerUnreachable } from '@/components/ServerUnreachable'
import { GOOGLE_PERMISSIONS_URL, type DeletionReport } from '@/services/account'

export function Login() {
  const { status } = useAuth()
  const [params] = useSearchParams()
  const failed = params.get('error') === 'google'
  const deleted = (useLocation().state as { deleted?: DeletionReport } | null)?.deleted

  if (status === 'loading') {
    return <FullPageSpinner label="Vérification de la session" />
  }

  // Offering a sign-in button that redirects to an API which is not answering
  // would fail in a way that looks like a rejected account.
  if (status === 'unreachable') {
    return <ServerUnreachable />
  }

  // Someone already signed in has no business on this page, and landing here
  // after a refresh would look like being logged out.
  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Campaign Mailer</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Envoyez des campagnes d’e-mails personnalisés depuis votre propre compte Gmail.
      </p>

      {deleted && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
        >
          <p>Votre compte et toutes ses données ont été supprimés.</p>
          {!deleted.googleRevoked && (
            // Said plainly, with the way to do it: the one step that could not
            // be completed is the one the user can finish in a minute.
            <p className="mt-1 text-ink-muted">
              Google n’a pas pu être prévenu. Retirez l’accès de Campaign Mailer depuis{' '}
              <a
                href={GOOGLE_PERMISSIONS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                les autorisations de votre compte Google
              </a>
              .
            </p>
          )}
        </div>
      )}

      {failed && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
        >
          La connexion avec Google n’a pas abouti. Réessayez, ou vérifiez que vous avez
          autorisé l’accès.
        </p>
      )}

      <div className="mt-8">
        <GoogleSignInButton />
      </div>

      {/* Saying this before the consent screen rather than after removes the
          surprise of seeing Google ask for send access. */}
      <p className="mt-6 text-xs leading-relaxed text-ink-muted">
        L’application demande l’autorisation d’envoyer des e-mails en votre nom. Elle ne
        peut pas lire votre boîte de réception.
      </p>

      <footer className="mt-10 border-t border-border pt-4">
        <LegalNav />
      </footer>
    </main>
  )
}
