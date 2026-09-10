import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Cette adresse ne correspond à aucune page.
      </p>
      <Link to="/" className="mt-4 text-sm text-accent underline">
        Retour aux campagnes
      </Link>
    </main>
  )
}
