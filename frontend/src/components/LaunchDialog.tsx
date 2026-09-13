import { useEffect, useRef, useState } from 'react'

import { estimateSchedule, type Campaign } from '@/services/campaigns'

const DAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export interface LaunchDialogProps {
  campaign: Campaign
  open: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * The last screen before messages leave the user's own mailbox.
 *
 * Two jobs. The recap turns settings into consequences — "46 a day" becomes
 * "until Thursday" — because that is the question a user can actually check.
 * The warning is shown before every launch, not dismissed forever after the
 * first: launching is rare, and what it says is as true for the tenth campaign
 * as for the first.
 */
export function LaunchDialog({
  campaign,
  open,
  busy,
  onConfirm,
  onClose,
}: LaunchDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [accepted, setAccepted] = useState(false)

  // A native modal dialog: focus is trapped, Escape closes it, and the page
  // behind becomes inert without any of that being re-implemented here.
  useEffect(() => {
    const element = dialog.current

    if (!element) {
      return
    }

    if (open && !element.open) {
      element.showModal()
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])

  function close() {
    setAccepted(false)
    onClose()
  }

  const schedule = estimateSchedule(campaign)
  const hour = `${String(campaign.startHour).padStart(2, '0')}:00`

  return (
    <dialog
      ref={dialog}
      onClose={close}
      aria-labelledby="launch-heading"
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 id="launch-heading" className="text-base font-semibold tracking-tight">
          Lancer « {campaign.name} » ?
        </h2>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">Destinataires</dt>
          <dd className="tabular-nums">{schedule?.remaining ?? 0}</dd>

          <dt className="text-ink-muted">Rythme</dt>
          <dd>
            {campaign.mailsPerDay} par jour, à partir de {hour} ({campaign.timezone}), un
            message toutes les {Math.round(campaign.pauseMs / 1000)} s environ
          </dd>

          <dt className="text-ink-muted">Pièce jointe</dt>
          <dd>{campaign.attachmentName ?? 'Aucune'}</dd>

          {schedule && (
            <>
              <dt className="text-ink-muted">Fin estimée</dt>
              <dd>
                {schedule.days === 1 ? (
                  <>aujourd’hui, en {schedule.minutesPerDay} min environ</>
                ) : (
                  <>
                    {DAY.format(schedule.lastDay)}, après {schedule.days} jours d’envoi
                  </>
                )}
              </dd>
            </>
          )}
        </dl>

        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <p className="font-medium">Avant de lancer</p>
          <ul className="mt-2 list-disc space-y-1.5 ps-4">
            <li>
              Les messages partent de <strong>votre</strong> compte Gmail. Un message
              parti ne peut pas être rappelé : relisez l’aperçu.
            </li>
            <li>
              N’écrivez qu’à des personnes que vous avez une raison légitime de contacter.
              Si quelqu’un vous demande de ne plus lui écrire, ignorez-le dans la liste.
            </li>
            <li>
              Gmail surveille les envois en nombre. Un compte personnel est bloqué au-delà
              d’environ 150 messages par jour ; sur un compte récent, commencez plus bas.
            </li>
          </ul>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => {
              setAccepted(event.target.checked)
            }}
            className="mt-0.5"
          />
          <span>
            J’ai relu l’aperçu, et je suis responsable des messages envoyés depuis mon
            compte.
          </span>
        </label>
      </div>

      <div className="flex justify-end gap-2 border-t border-border bg-surface-raised px-5 py-3">
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!accepted || busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Lancement…' : 'Lancer la campagne'}
        </button>
      </div>
    </dialog>
  )
}
