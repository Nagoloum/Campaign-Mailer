import { useState } from 'react'
import { toast } from 'sonner'

import { LaunchDialog } from '@/components/LaunchDialog'
import { ApiError } from '@/services/api'
import { campaignsApi, type Campaign } from '@/services/campaigns'

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })

export interface SendControlsProps {
  campaign: Campaign
  /** Unsaved edits. Launching would send the stored version, not the one on screen. */
  dirty: boolean
  onChanged: (campaign: Campaign) => void
}

/**
 * Where a campaign is, and the one action that makes sense from there.
 *
 * One primary button at a time, chosen by the status, rather than three
 * buttons of which two are disabled: a disabled "Reprendre" beside an enabled
 * "Mettre en pause" asks the user to work out the state machine.
 */
export function SendControls({ campaign, dirty, onChanged }: SendControlsProps) {
  const [busy, setBusy] = useState(false)
  const [launching, setLaunching] = useState(false)

  async function act(
    action: (id: string) => Promise<Campaign>,
    success: string,
  ): Promise<boolean> {
    setBusy(true)

    try {
      onChanged(await action(campaign.id))
      toast.success(success)
      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’action a échoué.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const blocker = launchBlocker(campaign, dirty)
  const hour = `${String(campaign.startHour).padStart(2, '0')}:00`
  const done = campaign.sentCount + campaign.errorCount
  const progress =
    campaign.totalContacts > 0 ? Math.round((done / campaign.totalContacts) * 100) : 0

  return (
    <section
      aria-labelledby="send-heading"
      className="rounded-xl border border-border bg-surface-raised px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="send-heading" className="text-sm font-medium">
            Envoi
          </h2>
          <p aria-live="polite" className="mt-0.5 text-sm text-ink-muted">
            {statusSentence(campaign, hour)}
          </p>
        </div>

        {campaign.status === 'draft' && (
          <button
            type="button"
            onClick={() => {
              setLaunching(true)
            }}
            disabled={blocker !== null}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Lancer la campagne…
          </button>
        )}

        {(campaign.status === 'scheduled' || campaign.status === 'running') && (
          <button
            type="button"
            onClick={() => void act(campaignsApi.pause, 'Campagne en pause.')}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface disabled:opacity-50"
          >
            {busy ? 'Mise en pause…' : 'Mettre en pause'}
          </button>
        )}

        {campaign.status === 'paused' && (
          <button
            type="button"
            onClick={() => void act(campaignsApi.resume, 'Campagne reprise.')}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Reprise…' : 'Reprendre'}
          </button>
        )}
      </div>

      {ceilingReached(campaign) && (
        // Without this a running campaign that sends nothing looks broken. It is
        // the ceiling doing its job, and it clears by itself.
        <p
          role="status"
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          Plafond atteint : {campaign.sending?.accountSentLast24h} e-mails envoyés par ce
          compte sur les dernières 24 heures, sur {campaign.sending?.accountDailyLimit}{' '}
          autorisés. L’envoi reprend seul dès que la fenêtre se libère ; rien n’est perdu.
        </p>
      )}

      {campaign.status === 'draft' && blocker && (
        <p className="mt-2 text-xs text-ink-muted">{blocker}</p>
      )}

      {campaign.status !== 'draft' && campaign.totalContacts > 0 && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Progression de l’envoi"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1.5 overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${String(progress)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-muted tabular-nums">
            {campaign.sentCount} envoyé{campaign.sentCount > 1 ? 's' : ''}
            {campaign.errorCount > 0 && (
              <span className="text-amber-700"> · {campaign.errorCount} en erreur</span>
            )}{' '}
            · {campaign.totalContacts} au total
          </p>
        </div>
      )}

      <LaunchDialog
        campaign={campaign}
        open={launching}
        busy={busy}
        onClose={() => {
          setLaunching(false)
        }}
        onConfirm={() => {
          void act(campaignsApi.start, 'Campagne lancée.').then((ok) => {
            if (ok) {
              setLaunching(false)
            }
          })
        }}
      />
    </section>
  )
}

/** True when a sending campaign is being held by the account's 24-hour ceiling. */
function ceilingReached(campaign: Campaign): boolean {
  const limit = campaign.sending?.accountDailyLimit

  return (
    (campaign.status === 'running' || campaign.status === 'scheduled') &&
    limit !== undefined &&
    limit !== null &&
    (campaign.sending?.accountSentLast24h ?? 0) >= limit
  )
}

/** Why the campaign cannot be launched yet, in the user's terms; null when it can. */
function launchBlocker(campaign: Campaign, dirty: boolean): string | null {
  if (dirty) {
    return 'Enregistrez vos modifications avant de lancer.'
  }
  if (!campaign.subject?.trim()) {
    return 'Ajoutez un objet avant de lancer.'
  }
  if (!campaign.bodyHtml?.trim()) {
    return 'Rédigez le message avant de lancer.'
  }
  if (campaign.totalContacts - campaign.sentCount - campaign.errorCount <= 0) {
    return 'Importez au moins un contact avant de lancer.'
  }
  return null
}

function statusSentence(campaign: Campaign, hour: string): string {
  switch (campaign.status) {
    case 'draft':
      return 'Rien n’est envoyé tant que la campagne n’est pas lancée.'
    case 'scheduled':
      return `Programmée : les envois commencent à ${hour} (${campaign.timezone}).`
    case 'running':
      return 'En cours : les messages partent un par un, au rythme choisi.'
    case 'paused':
      // The API does not say who paused it. If it was not the user, an expired
      // Google authorization is by far the likeliest reason, and saying so
      // saves a support request.
      return 'En pause : rien ne part. Si ce n’est pas vous, reconnectez votre compte Google, puis reprenez.'
    case 'completed':
      return campaign.completedAt
        ? `Terminée le ${DATE.format(new Date(campaign.completedAt))}.`
        : 'Terminée.'
  }
}
