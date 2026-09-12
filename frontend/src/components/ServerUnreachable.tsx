import { useState } from 'react'

import { useAuth } from '@/auth/useAuth'

/**
 * Shown when the session could not be read because the API did not answer.
 *
 * Deliberately not the login page. "Sign in" is advice the user cannot act on
 * while the server is down, and it makes them suspect their own account rather
 * than the service.
 */
export function ServerUnreachable() {
  const { refresh } = useAuth()
  const [retrying, setRetrying] = useState(false)

  return (
    <main
      role="alert"
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center"
    >
      <h1 className="text-lg font-semibold tracking-tight">Serveur injoignable</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Impossible de vérifier votre session. Le service est peut-être momentanément
        indisponible.
      </p>

      <button
        type="button"
        disabled={retrying}
        onClick={() => {
          setRetrying(true)
          void refresh().finally(() => {
            setRetrying(false)
          })
        }}
        className="mx-auto mt-6 rounded-lg border border-border bg-surface-raised px-4 py-2 text-sm font-medium transition-colors hover:bg-surface disabled:opacity-60"
      >
        {retrying ? 'Nouvelle tentative…' : 'Réessayer'}
      </button>
    </main>
  )
}
