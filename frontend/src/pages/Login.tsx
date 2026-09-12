import { Navigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'

export function Login() {
  const { status } = useAuth()
  const [params] = useSearchParams()
  const failed = params.get('error') === 'google'

  if (status === 'loading') {
    return <FullPageSpinner label="Vérification de la session" />
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
    </main>
  )
}
