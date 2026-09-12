import { useId, useState } from 'react'
import { toast } from 'sonner'

const MAX_BYTES = 10 * 1024 * 1024

const ACCEPTED = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]

function humanSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${String(Math.round(bytes / 1024))} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function AttachmentPanel({
  campaignId,
  attachmentName,
  disabled,
  onChanged,
}: {
  campaignId: string
  attachmentName: string | null
  disabled: boolean
  onChanged: () => void
}) {
  const inputId = useId()
  const [progress, setProgress] = useState<number | null>(null)

  /**
   * XMLHttpRequest rather than fetch, only for the progress events: fetch
   * still cannot report how much of a request body has been sent, and a CV on
   * a slow connection is exactly where a user needs to see something moving.
   */
  function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Seuls un PDF ou un document Word peuvent être joints.')
      return
    }

    if (file.size > MAX_BYTES) {
      toast.error('Le fichier dépasse 10 Mo.')
      return
    }

    const request = new XMLHttpRequest()

    request.open('POST', `/api/campaigns/${campaignId}/attachment`)
    request.withCredentials = true
    request.setRequestHeader('content-type', file.type)
    // Encoded, because an accented filename is not a valid header value.
    request.setRequestHeader('x-file-name', encodeURIComponent(file.name))

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100))
      }
    })

    request.addEventListener('load', () => {
      setProgress(null)

      if (request.status === 201) {
        toast.success('Pièce jointe enregistrée.')
        onChanged()
        return
      }

      const message =
        (JSON.parse(request.responseText || '{}') as { error?: string }).error ??
        'L’envoi a échoué.'
      toast.error(message)
    })

    request.addEventListener('error', () => {
      setProgress(null)
      toast.error('L’envoi a échoué.')
    })

    setProgress(0)
    request.send(file)
  }

  async function remove() {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/attachment`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('failed')
      }

      toast.success('Pièce jointe retirée.')
      onChanged()
    } catch {
      toast.error('La suppression a échoué.')
    }
  }

  return (
    <section aria-labelledby="attachment-heading">
      <h2 id="attachment-heading" className="text-sm font-medium">
        Pièce jointe
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Un PDF ou un document Word, 10 Mo au maximum. Il sera joint à chaque e-mail de la
        campagne.
      </p>

      {attachmentName ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm">{attachmentName}</span>
          <a
            href={`/api/campaigns/${campaignId}/attachment`}
            className="text-xs text-accent underline"
          >
            Télécharger
          </a>
          {!disabled && (
            <button
              type="button"
              onClick={() => void remove()}
              className="text-xs text-ink-muted hover:text-amber-700"
            >
              Retirer
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Aucune pièce jointe.</p>
      )}

      {!disabled && (
        <label
          htmlFor={inputId}
          className="mt-3 inline-block cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-raised"
        >
          {attachmentName ? 'Remplacer le fichier' : 'Choisir un fichier'}
          <input
            id={inputId}
            type="file"
            accept=".pdf,.doc,.docx"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                upload(file)
              }
              event.target.value = ''
            }}
          />
        </label>
      )}

      {progress !== null && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Envoi de la pièce jointe"
            className="h-1.5 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${String(progress)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted tabular-nums">
            {progress}% · {humanSize(MAX_BYTES)} maximum
          </p>
        </div>
      )}
    </section>
  )
}
