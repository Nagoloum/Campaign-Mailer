import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/StatusBadge'
import { campaignsApi, type Campaign } from '@/services/campaigns'

type Load =
  { state: 'loading' } | { state: 'ready'; campaigns: Campaign[] } | { state: 'failed' }

export function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', campaigns: await campaignsApi.list() })
    } catch {
      setLoad({ state: 'failed' })
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Campagnes</h1>
        <Link
          to="/campaigns/new"
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Nouvelle campagne
        </Link>
      </div>

      {load.state === 'loading' && (
        <p className="mt-6 text-sm text-ink-muted" role="status">
          Chargement…
        </p>
      )}

      {load.state === 'failed' && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-border px-4 py-3 text-sm"
        >
          <p>Impossible de charger vos campagnes.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 text-accent underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {load.state === 'ready' && load.campaigns.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">Aucune campagne pour le moment</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
            Créez-en une pour rédiger votre message, puis importez vos contacts.
          </p>
        </div>
      )}

      {load.state === 'ready' && load.campaigns.length > 0 && (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
          {load.campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${campaign.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-raised"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {campaign.name}
                </span>
                <StatusBadge status={campaign.status} />
                <Progress campaign={campaign} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Sent, errors and total, in one line.
 *
 * The error count is only rendered when there is one: a permanent "0 erreur"
 * teaches the eye to skip the spot where an error would appear.
 */
function Progress({ campaign }: { campaign: Campaign }) {
  if (campaign.totalContacts === 0) {
    return <span className="text-sm text-ink-muted">Aucun contact</span>
  }

  return (
    <span className="text-sm text-ink-muted tabular-nums">
      {campaign.sentCount} / {campaign.totalContacts} envoyés
      {campaign.errorCount > 0 && (
        <span className="text-amber-700"> · {campaign.errorCount} en erreur</span>
      )}
    </span>
  )
}
