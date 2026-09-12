import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'

export function SignOutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void signOut().finally(() => {
          // Replace, not push: the signed-in page must not come back with the
          // browser's back button, even though it would be empty.
          void navigate('/login', { replace: true })
        })
      }}
      className="rounded-md border border-border px-2.5 py-1 text-ink-muted transition-colors hover:text-ink disabled:opacity-60"
    >
      {busy ? 'Déconnexion…' : 'Se déconnecter'}
    </button>
  )
}
