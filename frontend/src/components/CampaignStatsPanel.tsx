import { useCallback, useEffect, useState } from 'react'

import { SendsChart } from '@/components/SendsChart'
import { campaignsApi, type Campaign, type CampaignStats } from '@/services/campaigns'
import { formatNextSend } from '@/services/time'

const PERCENT = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
})

type Load =
  { state: 'loading' } | { state: 'ready'; stats: CampaignStats } | { state: 'failed' }

/**
 * Where a launched campaign stands, in numbers and by day.
 *
 * Reloads when the campaign's counters move rather than on a timer of its own:
 * the page already follows a sending campaign, and a second poll would ask the
 * same question twice.
 */
export function CampaignStatsPanel({ campaign }: { campaign: Campaign }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: 'ready', stats: await campaignsApi.stats(campaign.id) })
    } catch {
      setLoad((current) => (current.state === 'ready' ? current : { state: 'failed' }))
    }
  }, [campaign.id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh, campaign.sentCount, campaign.errorCount, campaign.status])

  return (
    <section
      aria-labelledby="stats-heading"
      className="rounded-xl border border-border bg-surface-raised px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stats-heading" className="text-sm font-medium">
          Statistiques
        </h2>
        {/* A plain link: the browser downloads, the session cookie rides along. */}
        <a
          href={campaignsApi.logsExportUrl(campaign.id)}
          download
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
        >
          Exporter le journal (CSV)
        </a>
      </div>

      {load.state === 'loading' && (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          Chargement des statistiques…
        </p>
      )}

      {load.state === 'failed' && (
        <div role="alert" className="mt-3 text-sm">
          <p>Les statistiques n’ont pas pu être chargées.</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ state: 'loading' })
              void refresh()
            }}
            className="mt-1 text-accent underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {load.state === 'ready' && <StatsBody stats={load.stats} />}
    </section>
  )
}

function StatsBody({ stats }: { stats: CampaignStats }) {
  return (
    <>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Envoyés" value={stats.sent} />
        <Figure
          label="En erreur"
          value={stats.failed}
          detail={
            stats.errorRate === null
              ? undefined
              : `${PERCENT.format(stats.errorRate)} des tentatives`
          }
          warn={stats.failed > 0}
        />
        <Figure label="En attente" value={stats.pending} />
        <Figure label="Ignorés" value={stats.ignored} />
      </dl>

      <dl className="mt-4 grid gap-x-4 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-muted">Prochain envoi</dt>
        <dd>{stats.nextSendAt ? formatNextSend(new Date(stats.nextSendAt)) : 'Aucun'}</dd>

        <dt className="text-ink-muted">Fin estimée</dt>
        <dd>
          {stats.estimatedEndAt ? formatNextSend(new Date(stats.estimatedEndAt)) : '—'}
        </dd>

        <dt className="text-ink-muted">Dernier envoi</dt>
        <dd>
          {stats.lastSentAt
            ? new Date(stats.lastSentAt).toLocaleString('fr-FR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : 'Aucun'}
        </dd>
      </dl>

      <div className="mt-5">
        <SendsChart days={stats.perDay} />
      </div>
    </>
  )
}

function Figure({
  label,
  value,
  detail,
  warn = false,
}: {
  label: string
  value: number
  detail?: string | undefined
  warn?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={`text-2xl font-semibold tracking-tight ${warn ? 'text-amber-800' : ''}`}
      >
        {value}
      </dd>
      {detail && <dd className="text-xs text-ink-muted">{detail}</dd>}
    </div>
  )
}
