import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [{ to: '/', label: 'Campagnes' }] as const

/**
 * Shell for the authenticated part of the application: header, navigation and
 * the routed page. The account menu and the sign-out action land here in
 * Phase 1, once there is a session to read.
 */
export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
          <span className="font-semibold tracking-tight">Campaign Mailer</span>
          <nav aria-label="Principal">
            <ul className="flex gap-4 text-sm">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
