import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

import { TERMS_UPDATED } from '@/services/legal'

const LEGAL_LINKS = [
  { to: '/legal/mentions', label: 'Mentions légales' },
  { to: '/legal/cgu', label: 'Conditions d’utilisation' },
  { to: '/legal/confidentialite', label: 'Confidentialité' },
] as const

/**
 * The frame of the three legal pages. Public: someone deciding whether to sign
 * in must be able to read them first.
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/logo.png" alt="" aria-hidden="true" className="size-6" />
            Campaign Mailer
          </Link>
          <nav aria-label="Documents légaux" className="ms-auto">
            <LegalNav />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Dernière mise à jour : {TERMS_UPDATED}
        </p>
        <article className="legal mt-8 space-y-8 text-[15px] leading-relaxed">
          {children}
        </article>
      </main>
    </div>
  )
}

export function LegalNav() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {LEGAL_LINKS.map((link) => (
        <li key={link.to}>
          <NavLink
            to={link.to}
            className={({ isActive }) =>
              isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
            }
          >
            {link.label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** A configured value, or a visible gap: never an invented one. */
export function Field({ value }: { value: string | null }) {
  return value ? <>{value}</> : <em className="text-amber-700 not-italic">à compléter</em>
}
