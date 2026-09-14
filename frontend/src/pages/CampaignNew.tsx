import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '@/services/api'
import { campaignsApi, type StarterTemplate } from '@/services/campaigns'

const FROM_SCRATCH = 'vide'

export function CampaignNew() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [templates, setTemplates] = useState<StarterTemplate[]>([])
  const [chosen, setChosen] = useState<string>(FROM_SCRATCH)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void campaignsApi
      .templates()
      .then((catalogue) => {
        setTemplates(catalogue.templates)
      })
      .catch(() => {
        // A missing catalogue is not worth blocking creation: the user can
        // still start from an empty message and write their own.
        setTemplates([])
      })
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setError(null)

    const template = templates.find((candidate) => candidate.id === chosen)

    try {
      const campaign = await campaignsApi.create({
        name: name.trim(),
        ...(template
          ? {
              subject: template.subject,
              body_text: template.bodyText,
              body_html: template.bodyHtml,
            }
          : {}),
      })

      void navigate(`/campaigns/${campaign.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La création a échoué')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Nouvelle campagne</h1>

      <label className="mt-6 block">
        <span className="text-sm font-medium">Nom de la campagne</span>
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          required
          maxLength={200}
          autoFocus
          placeholder="Candidatures septembre"
          className="mt-1.5 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
        />
        {/* Said here rather than discovered later: the name never leaves the
            application, so it can be blunt. */}
        <span className="mt-1.5 block text-xs text-ink-muted">
          Visible par vous seul. Les destinataires ne le voient pas.
        </span>
      </label>

      <fieldset className="mt-8">
        <legend className="text-sm font-medium">Point de départ</legend>
        <p className="mt-1 text-xs text-ink-muted">
          Un modèle vous donne une structure à remplir. Tout reste modifiable ensuite.
        </p>

        <div className="mt-3 space-y-2">
          <Choice
            id={FROM_SCRATCH}
            chosen={chosen}
            onChoose={setChosen}
            title="Partir de zéro"
            description="Un message vide, à écrire entièrement."
          />
          {templates.map((template) => (
            <Choice
              key={template.id}
              id={template.id}
              chosen={chosen}
              onChoose={setChosen}
              title={template.name}
              description={template.description}
            />
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-6 text-sm text-amber-700">
          {error}
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || name.trim() === ''}
          className="press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Création…' : 'Créer la campagne'}
        </button>
        <Link to="/" className="text-sm text-ink-muted hover:text-ink">
          Annuler
        </Link>
      </div>
    </form>
  )
}

function Choice({
  id,
  chosen,
  onChoose,
  title,
  description,
}: {
  id: string
  chosen: string
  onChoose: (id: string) => void
  title: string
  description: string
}) {
  const selected = chosen === id

  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        selected ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-raised'
      }`}
    >
      <input
        type="radio"
        name="starter"
        value={id}
        checked={selected}
        onChange={() => {
          onChoose(id)
        }}
        className="mt-1 accent-accent"
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-ink-muted">{description}</span>
      </span>
    </label>
  )
}
