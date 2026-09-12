import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'

import { SignOutButton } from './SignOutButton'

const NAV_ITEMS = [{ to: '/', label: 'Campagnes' }] as const

/**
 * Shell for the signed-in part of the application: header, navigation, and the
 * routed page.
 */
export function AppLayout() {
  const { user } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="font-semibold tracking-tight">Campaign Mailer</span>

          <nav aria-label="Principal">
            <ul className="flex gap-4 text-sm">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ms-auto flex items-center gap-3 text-sm">
            {/* The address is the only way to tell which Google account is
                connected, and campaigns are sent from it. Worth the space. */}
            <span className="max-w-56 truncate text-ink-muted" title={user?.email}>
              {user?.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
