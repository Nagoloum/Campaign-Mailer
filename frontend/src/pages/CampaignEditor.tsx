import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { StatusBadge } from '@/components/StatusBadge'
import { campaignsApi, isEditable, type Campaign } from '@/services/campaigns'

type Load =
  { state: 'loading' } | { state: 'ready'; campaign: Campaign } | { state: 'missing' }

export function CampaignEditor() {
  const { id } = useParams<{ id: string }>()
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const refresh = useCallback(async () => {
    if (!id) {
      setLoad({ state: 'missing' })
      return
    }

    try {
      setLoad({ state: 'ready', campaign: await campaignsApi.get(id) })
    } catch {
      setLoad({ state: 'missing' })
    }
  }, [id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  if (load.state === 'loading') {
    return (
      <p role="status" className="text-sm text-ink-muted">
        Chargement…
      </p>
    )
  }

  if (load.state === 'missing') {
    return (
      <div role="alert">
        <h1 className="text-xl font-semibold tracking-tight">Campagne introuvable</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Elle a peut-être été supprimée, ou l’adresse est incorrecte.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-accent underline">
          Retour aux campagnes
        </Link>
      </div>
    )
  }

  const { campaign } = load

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
        <StatusBadge status={campaign.status} />
      </div>

      {!isEditable(campaign.status) && (
        // Said once, at the top, rather than through a disabled field the user
        // discovers by clicking it.
        <p className="mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-ink-muted">
          Le message ne peut plus être modifié : la campagne est{' '}
          {campaign.status === 'completed' ? 'terminée' : 'lancée'}.
        </p>
      )}

      <p className="mt-6 text-sm text-ink-muted">
        L’éditeur de message, l’aperçu et les réglages d’envoi arrivent juste après.
      </p>
    </>
  )
}
