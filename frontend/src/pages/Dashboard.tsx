import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/StatusBadge'
import {
  campaignsApi,
  statusLabel,
  type Campaign,
  type CampaignStatus,
} from '@/services/campaigns'
import { dashboardApi, type Dashboard as DashboardData } from '@/services/dashboard'
import { formatNextSend } from '@/services/time'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; campaigns: Campaign[]; dashboard: DashboardData }
  | { state: 'failed' }

/** Statuses in the order a campaign lives through them. */
const LIFECYCLE: CampaignStatus[] = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
]

export function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const [campaigns, dashboard] = await Promise.all([
        campaignsApi.list(),
        dashboardApi.get(),
      ])
      setLoad({ state: 'ready', campaigns, dashboard })
    } catch {
      // A poll that fails keeps what is on screen; only a first load shows the
      // error, because replacing good numbers with an error helps nobody.
      setLoad((current) => (current.state === 'ready' ? current : { state: 'failed' }))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const sending = load.state === 'ready' && load.dashboard.upcoming.length > 0

  /**
   * Follows the account while something is sending, every thirty seconds and
   * only while the tab is visible. Nothing to follow, nothing polled.
   */
  useEffect(() => {
    if (!sending) {
      return
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }, 30_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [sending, refresh])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Campagnes</h1>
        <Link
          to="/campaigns/new"
          className="press rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
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
          <p>
            Impossible de charger vos campagnes. Vérifiez votre connexion, puis réessayez.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoad({ state: 'loading' })
              void refresh()
            }}
            className="mt-2 text-accent underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {load.state === 'ready' && (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Allowance account={load.dashboard.account} />
            <Upcoming upcoming={load.dashboard.upcoming} />
          </div>

          <CampaignList
            campaigns={load.campaigns}
            byStatus={load.dashboard.campaigns.byStatus}
          />
        </>
      )}
    </>
  )
}

/**
 * The account's 24-hour ceiling, as a meter.
 *
 * The one number on this page that can stop everything else, so it gets the
 * size. The track is a lighter step of the fill's own colour, so the meter
 * reads as a whole bar, and it turns amber only when the ceiling is reached —
 * the moment the user needs to know sending is holding.
 */
function Allowance({ account }: { account: DashboardData['account'] }) {
  const used = Math.min(account.sentLast24h, account.dailyLimit)
  const share = account.dailyLimit > 0 ? used / account.dailyLimit : 0
  const full = account.remaining === 0

  return (
    <section
      aria-labelledby="allowance-heading"
      className="rounded-xl border border-border bg-surface-raised px-5 py-4"
    >
      <h2 id="allowance-heading" className="text-sm font-medium">
        Envois sur les dernières 24 heures
      </h2>

      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight">
          {account.sentLast24h}
        </span>
        <span className="text-sm text-ink-muted">sur {account.dailyLimit} autorisés</span>
      </p>

      <div
        role="meter"
        aria-label="Part du plafond journalier utilisée"
        aria-valuemin={0}
        aria-valuemax={account.dailyLimit}
        aria-valuenow={used}
        className={`mt-3 h-2 overflow-hidden rounded-full ${full ? 'bg-amber-100' : 'bg-accent/15'}`}
      >
        <div
          // scaleX rather than width, and no radius of its own: the track clips
          // it, so the rounded ends do not squash as it scales.
          className={`h-full w-full origin-left transition-transform duration-300 ease-out motion-reduce:transition-none ${full ? 'bg-amber-500' : 'bg-accent'}`}
          style={{ transform: `scaleX(${String(share)})` }}
        />
      </div>

      <p className={`mt-2 text-sm ${full ? 'text-amber-800' : 'text-ink-muted'}`}>
        {full
          ? 'Plafond atteint. L’envoi reprend seul à mesure que la fenêtre de 24 heures se libère.'
          : `Encore ${String(account.remaining)} envoi${account.remaining > 1 ? 's' : ''} possible${account.remaining > 1 ? 's' : ''} avant le plafond.`}
      </p>
    </section>
  )
}

function Upcoming({ upcoming }: { upcoming: DashboardData['upcoming'] }) {
  return (
    <section
      aria-labelledby="upcoming-heading"
      className="rounded-xl border border-border bg-surface-raised px-5 py-4"
    >
      <h2 id="upcoming-heading" className="text-sm font-medium">
        Prochains envois
      </h2>

      {upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          Aucune campagne en cours. Une campagne lancée apparaît ici avec son prochain
          envoi.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {upcoming.map((item) => (
            <li key={item.campaignId}>
              <Link
                to={`/campaigns/${item.campaignId}`}
                className="-mx-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 hover:bg-surface"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {item.name}
                </span>
                <span className="text-sm tabular-nums">
                  {item.nextSendAt
                    ? formatNextSend(new Date(item.nextSendAt))
                    : 'Rien à envoyer'}
                </span>
                <span className="w-full text-xs text-ink-muted">
                  {item.pending} en attente
                  {item.estimatedEndAt &&
                    `, fin estimée ${formatNextSend(new Date(item.estimatedEndAt))}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CampaignList({
  campaigns,
  byStatus,
}: {
  campaigns: Campaign[]
  byStatus: Record<CampaignStatus, number>
}) {
  if (campaigns.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium">Aucune campagne pour le moment</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Créez-en une pour rédiger votre message, puis importez vos contacts.
        </p>
      </div>
    )
  }

  return (
    <section aria-labelledby="campaigns-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="campaigns-heading" className="text-sm font-medium">
          Toutes les campagnes{' '}
          <span className="text-ink-muted tabular-nums">({campaigns.length})</span>
        </h2>
        <p className="text-xs text-ink-muted">
          {LIFECYCLE.filter((status) => byStatus[status] > 0)
            .map(
              (status) =>
                `${String(byStatus[status])} ${statusLabel(status).toLowerCase()}`,
            )
            .join(', ')}
        </p>
      </div>

      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <Link
              to={`/campaigns/${campaign.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-raised"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{campaign.name}</span>
              <StatusBadge status={campaign.status} />
              <Progress campaign={campaign} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
        <span className="text-amber-700">, {campaign.errorCount} en erreur</span>
      )}
    </span>
  )
}
