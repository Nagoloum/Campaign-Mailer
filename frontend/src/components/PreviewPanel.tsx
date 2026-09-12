import { useState } from 'react'

import { ApiError } from '@/services/api'
import { campaignsApi, type Preview } from '@/services/campaigns'

/** The fields a preview can be driven with, in the order they read. */
const FIELDS = [
  { name: 'salutation', label: 'Civilité', placeholder: 'Madame' },
  { name: 'contact_name', label: 'Nom du contact', placeholder: 'Camille Martin' },
  { name: 'company_name', label: 'Entreprise', placeholder: 'Société Exemple' },
  { name: 'email', label: 'Adresse', placeholder: 'destinataire@exemple.fr' },
] as const

export interface PreviewPanelProps {
  campaignId: string
  /** Saves any pending change first, so the preview shows what the user just wrote. */
  beforePreview: () => Promise<void>
}

export function PreviewPanel({ campaignId, beforePreview }: PreviewPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)

    try {
      await beforePreview()

      const filled = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value.trim() !== ''),
      )

      setPreview(await campaignsApi.preview(campaignId, { contact: filled }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'L’aperçu a échoué')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="preview-heading">
      <h2 id="preview-heading" className="text-sm font-medium">
        Aperçu
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Laissez un champ vide pour utiliser une valeur d’exemple. L’aperçu enregistre vos
        modifications avant de s’afficher.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.name} className="block">
            <span className="text-xs text-ink-muted">{field.label}</span>
            <input
              value={values[field.name] ?? ''}
              placeholder={field.placeholder}
              onChange={(event) => {
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }}
              className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-raised disabled:opacity-50"
      >
        {busy ? 'Génération…' : 'Générer l’aperçu'}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-700">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-surface-raised px-4 py-2.5">
            <p className="text-xs text-ink-muted">Objet</p>
            {/* Rendered as text: a mail client shows a subject literally. */}
            <p className="text-sm font-medium">{preview.subject || <em>(vide)</em>}</p>
          </div>

          {/*
            The body goes into a sandboxed iframe rather than into the page.
            Two reasons, and both matter.

            It is a faithful preview: email HTML must not inherit the
            application's stylesheet, or the message looks right here and wrong
            in a mailbox.

            And it is isolation. This HTML is authored in a rich editor whose
            dependency carries a known XSS advisory, and Phase 9 plans shared
            templates, at which point the author may not be the reader. An
            empty sandbox attribute blocks scripts, forms and same-origin
            access, so nothing in it can reach the session.
          */}
          <iframe
            title="Aperçu du message"
            sandbox=""
            srcDoc={preview.bodyHtml || '<p style="color:#888">(message vide)</p>'}
            className="h-96 w-full bg-white"
          />
        </div>
      )}
    </section>
  )
}
