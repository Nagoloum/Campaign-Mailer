import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { accountApi } from '@/services/account'
import { ApiError } from '@/services/api'
import { TERMS_VERSION } from '@/services/legal'

/**
 * Shown before anything else until the current terms are accepted.
 *
 * Three sentences a person can actually read, and the full texts one click
 * away, rather than a wall of legal text with a button under it. The one
 * cookie is mentioned here because it is the only one: there is no tracking,
 * so there is no consent banner to show.
 */
export function TermsAcceptance() {
  const { user, refresh, signOut } = useAuth()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Someone who accepted an earlier version is told the terms changed, not
  // greeted as a newcomer.
  const renewal = user?.termsVersion != null

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (!accepted || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await accountApi.acceptTerms(TERMS_VERSION)
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Les conditions ont été mises à jour entre-temps. Rechargez la page pour lire la nouvelle version.'
          : 'L’acceptation n’a pas pu être enregistrée. Réessayez.',
      )
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        {renewal ? 'Nos conditions ont changé' : 'Avant de commencer'}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {renewal
          ? 'Merci de relire et d’accepter la nouvelle version pour continuer.'
          : 'Trois points à connaître, puis vous pourrez créer votre première campagne.'}
      </p>

      <ul className="mt-6 space-y-3 text-sm">
        <li>
          Les e-mails partent de <strong>votre</strong> compte Gmail. Vous êtes
          responsable de leur contenu et du choix de leurs destinataires.
        </li>
        <li>
          Vos données et celles de vos contacts servent uniquement à envoyer vos
          campagnes. Vous pouvez les télécharger ou les supprimer à tout moment.
        </li>
        <li>
          Un seul cookie, indispensable pour rester connecté. Aucun traceur, aucune
          publicité.
        </li>
      </ul>

      <form onSubmit={(event) => void submit(event)} className="mt-8">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.target.checked)
            }}
            className="mt-0.5"
          />
          <span>
            J’ai lu et j’accepte les{' '}
            <Link to="/legal/cgu" target="_blank" className="text-accent underline">
              conditions générales d’utilisation
            </Link>{' '}
            et la{' '}
            <Link
              to="/legal/confidentialite"
              target="_blank"
              className="text-accent underline"
            >
              politique de confidentialité
            </Link>
            .
          </span>
        </label>

        {error && (
          <p role="alert" className="mt-4 text-sm text-amber-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!accepted || busy}
            className="press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Enregistrement…' : 'Accepter et continuer'}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-sm text-ink-muted hover:text-ink"
          >
            Se déconnecter
          </button>
        </div>
      </form>

      {/* The rights over one's data never wait on accepting anything. */}
      <p className="mt-10 text-xs text-ink-muted">
        Vous préférez partir ?{' '}
        <Link to="/account" className="underline hover:text-ink">
          Téléchargez ou supprimez vos données
        </Link>{' '}
        sans accepter.
      </p>
    </main>
  )
}
