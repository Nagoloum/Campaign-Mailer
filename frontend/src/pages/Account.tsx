import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { accountApi } from '@/services/account'
import { ApiError } from '@/services/api'

/**
 * The account: what it holds, and how to take it or end it.
 *
 * The two rights of a person over their data sit on one page, in that order —
 * take a copy, then delete — because the copy is what anyone about to delete
 * should be offered first.
 */
export function Account() {
  const { user } = useAuth()

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Mon compte</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Connecté avec <span className="text-ink">{user?.email}</span>.
      </p>

      <section aria-labelledby="export-heading" className="mt-8">
        <h2 id="export-heading" className="text-sm font-medium">
          Vos données
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Une copie de tout ce que l’application conserve à votre sujet : vos campagnes,
          leurs messages, vos contacts et le journal de chaque envoi.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href={accountApi.exportUrl('json')}
            download
            className="press rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-raised"
          >
            Télécharger toutes mes données (JSON)
          </a>
          <a
            href={accountApi.exportUrl('csv')}
            download
            className="press rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-raised"
          >
            Télécharger mes contacts (CSV)
          </a>
        </div>
      </section>

      <DeleteAccount email={user?.email ?? ''} />
    </div>
  )
}

function DeleteAccount({ email }: { email: string }) {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The same comparison the server makes, so the button is only enabled for a
  // request the server will accept.
  const confirmed = email !== '' && typed.trim().toLowerCase() === email.toLowerCase()

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (!confirmed || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const report = await accountApi.delete(typed.trim())
      // The session is gone server-side; reading it again turns the interface
      // anonymous, so the login page shows instead of redirecting back here.
      await refresh()
      void navigate('/login', { replace: true, state: { deleted: report } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La suppression a échoué.')
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="delete-heading"
      className="mt-10 rounded-xl border border-amber-300 px-5 py-4"
    >
      <h2 id="delete-heading" className="text-sm font-medium">
        Supprimer mon compte
      </h2>

      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink-muted">
        <li>
          Vos campagnes, vos contacts, leurs journaux et vos pièces jointes sont effacés.
        </li>
        <li>Les campagnes en cours s’arrêtent : plus aucun message ne part.</li>
        <li>L’accès de l’application à votre compte Google est révoqué.</li>
        <li>
          C’est définitif. Téléchargez vos données avant, si vous voulez les garder.
        </li>
      </ul>

      <form onSubmit={(event) => void submit(event)} className="mt-4">
        <label className="block">
          <span className="text-sm">Pour confirmer, saisissez votre adresse e-mail</span>
          <input
            type="email"
            value={typed}
            autoComplete="off"
            placeholder={email}
            onChange={(event) => {
              setTyped(event.target.value)
            }}
            className="mt-1.5 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-amber-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!confirmed || busy}
          className="mt-4 press rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Suppression…' : 'Supprimer définitivement mon compte'}
        </button>
      </form>
    </section>
  )
}
