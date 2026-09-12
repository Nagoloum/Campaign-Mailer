import { useMemo, useState } from 'react'

import { ApiError } from '@/services/api'
import { campaignsApi, type Campaign } from '@/services/campaigns'

/** Google's own ceiling: about 150 a day on a personal account, 1500 on Workspace. */
const PERSONAL_DAILY_CEILING = 150

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    // An older engine without the list still has to let the user keep theirs.
    return ['Europe/Paris', 'UTC']
  }
}

export interface CadenceFormProps {
  campaign: Campaign
  disabled: boolean
  onSaved: (campaign: Campaign) => void
}

export function CadenceForm({ campaign, disabled, onSaved }: CadenceFormProps) {
  const [mailsPerDay, setMailsPerDay] = useState(campaign.mailsPerDay)
  const [startHour, setStartHour] = useState(campaign.startHour)
  const [pauseSeconds, setPauseSeconds] = useState(Math.round(campaign.pauseMs / 1000))
  const [timezone, setTimezone] = useState(campaign.timezone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inline, so the linter can see the dependency list belongs to this call.
  const zones = useMemo(() => timeZones(), [])

  /**
   * How many days the campaign will take at this pace.
   *
   * Shown because the pace is otherwise an abstract number: 46 a day means
   * nothing until it reads "environ 5 jours" against 200 contacts.
   */
  const days =
    campaign.totalContacts > 0 && mailsPerDay > 0
      ? Math.ceil((campaign.totalContacts - campaign.sentCount) / mailsPerDay)
      : null

  async function save() {
    setSaving(true)
    setError(null)

    try {
      onSaved(
        await campaignsApi.update(campaign.id, {
          mails_per_day: mailsPerDay,
          start_hour: startHour,
          pause_ms: pauseSeconds * 1000,
          timezone,
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'L’enregistrement a échoué')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="cadence-heading">
      <h2 id="cadence-heading" className="text-sm font-medium">
        Rythme d’envoi
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-ink-muted">E-mails par jour</span>
          <input
            type="number"
            min={1}
            max={1500}
            value={mailsPerDay}
            disabled={disabled}
            onChange={(event) => {
              setMailsPerDay(Number(event.target.value))
            }}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm tabular-nums disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="text-xs text-ink-muted">Heure de départ</span>
          <select
            value={startHour}
            disabled={disabled}
            onChange={(event) => {
              setStartHour(Number(event.target.value))
            }}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm disabled:opacity-60"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-ink-muted">
            Pause entre deux envois (secondes)
          </span>
          <input
            type="number"
            min={1}
            max={600}
            value={pauseSeconds}
            disabled={disabled}
            onChange={(event) => {
              setPauseSeconds(Number(event.target.value))
            }}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm tabular-nums disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="text-xs text-ink-muted">Fuseau horaire</span>
          <select
            value={timezone}
            disabled={disabled}
            onChange={(event) => {
              setTimezone(event.target.value)
            }}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm disabled:opacity-60"
          >
            {zones.includes(timezone) ? null : (
              <option value={timezone}>{timezone}</option>
            )}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-ink-muted">
        {days !== null && (
          <p>
            À ce rythme, {campaign.totalContacts - campaign.sentCount} envois restants
            prendront environ{' '}
            <strong className="font-medium text-ink">
              {days} jour{days > 1 ? 's' : ''}
            </strong>
            .
          </p>
        )}

        {/* Said before the send, not after the account is blocked. */}
        {mailsPerDay > PERSONAL_DAILY_CEILING && (
          <p role="alert" className="text-amber-700">
            Au-delà de {PERSONAL_DAILY_CEILING} par jour, un compte Gmail personnel est
            bloqué. Ce réglage ne convient qu’à un compte Google Workspace.
          </p>
        )}

        <p>
          L’heure de départ est interprétée dans le fuseau choisi, pas dans celui de votre
          navigateur.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-700">
          {error}
        </p>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-raised disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer le rythme'}
        </button>
      )}
    </section>
  )
}
