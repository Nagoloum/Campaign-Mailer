import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { CadenceForm } from '@/components/CadenceForm'
import { PreviewPanel } from '@/components/PreviewPanel'
import { StatusBadge } from '@/components/StatusBadge'
import { TemplateEditor } from '@/components/TemplateEditor'
import { ApiError } from '@/services/api'
import {
  campaignsApi,
  canEditCadence,
  isEditable,
  type Campaign,
} from '@/services/campaigns'

type Load =
  { state: 'loading' } | { state: 'ready'; campaign: Campaign } | { state: 'missing' }

interface Draft {
  subject: string
  bodyHtml: string
  bodyText: string
}

export function CampaignEditor() {
  const { id } = useParams<{ id: string }>()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [draft, setDraft] = useState<Draft>({ subject: '', bodyHtml: '', bodyText: '' })
  const [variables, setVariables] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoad({ state: 'missing' })
      return
    }

    try {
      const campaign = await campaignsApi.get(id)
      setLoad({ state: 'ready', campaign })
      setDraft({
        subject: campaign.subject ?? '',
        bodyHtml: campaign.bodyHtml ?? '',
        bodyText: campaign.bodyText ?? '',
      })
      setDirty(false)
    } catch {
      setLoad({ state: 'missing' })
    }
  }, [id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void campaignsApi
      .templates()
      .then((catalogue) => {
        setVariables(catalogue.variables)
      })
      .catch(() => {
        setVariables([])
      })
  }, [])

  /**
   * Warns before leaving with unsaved work. A campaign body is ten minutes of
   * writing, and the browser gives it away for free.
   */
  useEffect(() => {
    if (!dirty) {
      return
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])

  async function save() {
    if (load.state !== 'ready' || saving) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const campaign = await campaignsApi.update(load.campaign.id, {
        subject: draft.subject,
        body_html: draft.bodyHtml,
        body_text: draft.bodyText,
      })

      setLoad({ state: 'ready', campaign })
      setDirty(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'L’enregistrement a échoué')
    } finally {
      setSaving(false)
    }
  }

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
  const locked = !isEditable(campaign.status)

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-ink-muted hover:text-ink">
          ← Campagnes
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
        <StatusBadge status={campaign.status} />
      </div>

      {locked && (
        // Said once, at the top, rather than through a disabled field the user
        // discovers by clicking it.
        <p className="mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-ink-muted">
          Le message ne peut plus être modifié : la campagne est{' '}
          {campaign.status === 'completed' ? 'terminée' : 'lancée'}.
        </p>
      )}

      <div className="mt-6 max-w-3xl">
        <TemplateEditor
          subject={draft.subject}
          bodyHtml={draft.bodyHtml}
          variables={variables}
          disabled={locked}
          onSubjectChange={(subject) => {
            setDraft((current) => ({ ...current, subject }))
            setDirty(true)
          }}
          onBodyChange={(bodyHtml, bodyText) => {
            setDraft((current) => ({ ...current, bodyHtml, bodyText }))
            setDirty(true)
          }}
        />

        {error && (
          <p role="alert" className="mt-4 text-sm text-amber-700">
            {error}
          </p>
        )}

        <div className="mt-8 border-t border-border pt-6">
          <CadenceForm
            campaign={campaign}
            disabled={!canEditCadence(campaign.status)}
            onSaved={(updated) => {
              setLoad({ state: 'ready', campaign: updated })
            }}
          />
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <PreviewPanel
            campaignId={campaign.id}
            beforePreview={async () => {
              // Previewing stale text is worse than not previewing: the user
              // checks a sentence they have already changed.
              if (dirty && !locked) {
                await save()
              }
            }}
          />
        </div>

        {!locked && (
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <span aria-live="polite" className="text-xs text-ink-muted">
              {dirty ? 'Modifications non enregistrées' : 'À jour'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
