import Papa from 'papaparse'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/services/api'
import { contactsApi, type ImportReport, type MappedRow } from '@/services/contacts'

import { ImportReportPanel } from './ImportReportPanel'

/** The four fields a contact has, in the order they read. */
const FIELDS = [
  { key: 'email', label: 'Adresse e-mail', required: true },
  { key: 'contact_name', label: 'Nom du contact', required: false },
  { key: 'company_name', label: 'Entreprise', required: false },
  { key: 'salutation', label: 'Civilité', required: false },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

const NOT_MAPPED = ''

interface Parsed {
  fileName: string
  columns: string[]
  rows: Record<string, string>[]
}

/**
 * Guesses which column holds which field.
 *
 * Most exports use one of a handful of headers, and getting it right on the
 * first try is the difference between an import and a form to fill in.
 */
const HINTS: Record<FieldKey, string[]> = {
  email: ['email', 'e-mail', 'mail', 'adresse', 'address'],
  contact_name: ['nom', 'name', 'contact', 'prenom', 'prénom', 'firstname', 'lastname'],
  company_name: [
    'entreprise',
    'societe',
    'société',
    'company',
    'organisation',
    'organization',
  ],
  salutation: ['civilite', 'civilité', 'salutation', 'titre', 'title'],
}

function guessMapping(columns: string[]): Record<FieldKey, string> {
  const used = new Set<string>()
  const mapping = {} as Record<FieldKey, string>

  for (const field of FIELDS) {
    const hints = HINTS[field.key]
    const match = columns.find((column) => {
      if (used.has(column)) {
        return false
      }
      const normalised = column.trim().toLowerCase()
      return hints.some((hint) => normalised === hint || normalised.includes(hint))
    })

    mapping[field.key] = match ?? NOT_MAPPED
    if (match) {
      used.add(match)
    }
  }

  return mapping
}

export function CsvImport({
  campaignId,
  disabled,
  onImported,
}: {
  campaignId: string
  disabled: boolean
  onImported: () => void
}) {
  const inputId = useId()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({
    email: '',
    contact_name: '',
    company_name: '',
    salutation: '',
  })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)

  function read(file: File) {
    setReport(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // Papa strips the byte order mark Excel writes, which would otherwise
      // prefix the first column name with an invisible character and break
      // every mapping. It also detects a semicolon separator on its own, which
      // is what a French Excel export produces.
      complete: (result) => {
        const columns = (result.meta.fields ?? []).filter((field) => field.trim() !== '')

        if (columns.length === 0 || result.data.length === 0) {
          toast.error('Ce fichier ne contient aucune ligne exploitable.')
          return
        }

        setParsed({ fileName: file.name, columns, rows: result.data })
        setMapping(guessMapping(columns))
      },
      error: () => {
        toast.error('Ce fichier n’a pas pu être lu.')
      },
    })
  }

  async function run() {
    if (!parsed || importing) {
      return
    }

    setImporting(true)

    try {
      const rows: MappedRow[] = parsed.rows.map((row) => {
        const mapped: MappedRow = { email: row[mapping.email] ?? '' }

        for (const field of FIELDS) {
          if (field.key === 'email') {
            continue
          }
          const column = mapping[field.key]
          const value = column ? row[column] : undefined
          if (value) {
            mapped[field.key] = value
          }
        }

        return mapped
      })

      const result = await contactsApi.import(campaignId, rows)

      setReport(result)
      setParsed(null)
      onImported()

      if (result.rejected.length === 0) {
        toast.success(`${String(result.imported)} contacts importés.`)
      } else {
        // A partial import is a success with a caveat, not a failure: the good
        // rows are in, and the report says which ones were not.
        toast.warning(
          `${String(result.imported)} importés, ${String(result.rejected.length)} rejetés.`,
        )
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'L’import a échoué.')
    } finally {
      setImporting(false)
    }
  }

  const emailMapped = mapping.email !== NOT_MAPPED

  return (
    <section aria-labelledby="import-heading">
      <h2 id="import-heading" className="text-sm font-medium">
        Importer des contacts
      </h2>

      {!parsed && (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) {
              read(file)
            }
          }}
          className={`mt-3 block cursor-pointer rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? 'border-accent bg-accent/5'
              : 'border-border hover:bg-surface-raised'
          } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        >
          <p className="text-sm font-medium">
            Déposez un fichier CSV, ou cliquez pour le choisir
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Une colonne d’adresses suffit. Le séparateur et l’encodage sont détectés.
          </p>
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                read(file)
              }
              // Cleared, so choosing the same file twice fires the event again.
              event.target.value = ''
            }}
          />
        </label>
      )}

      {parsed && (
        <div className="mt-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{parsed.fileName}</p>
            <p className="text-xs text-ink-muted">{parsed.rows.length} lignes</p>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs text-ink-muted">
                  {field.label}
                  {field.required && ' *'}
                </span>
                <select
                  value={mapping[field.key]}
                  onChange={(event) => {
                    setMapping((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm"
                >
                  <option value={NOT_MAPPED}>— aucune colonne —</option>
                  {parsed.columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {!emailMapped && (
            <p role="alert" className="mt-3 text-xs text-amber-700">
              Choisissez la colonne qui contient les adresses e-mail.
            </p>
          )}

          <PreviewRows parsed={parsed} mapping={mapping} />

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={!emailMapped || importing}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing
                ? 'Import en cours…'
                : `Importer ${String(parsed.rows.length)} lignes`}
            </button>
            <button
              type="button"
              onClick={() => {
                setParsed(null)
              }}
              className="text-sm text-ink-muted hover:text-ink"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {report && <ImportReportPanel report={report} />}
    </section>
  )
}

/**
 * The first five rows as they will be imported.
 *
 * Shown before anything is sent, because a mapping that is off by one column
 * is obvious here and invisible in a report of five hundred rejections.
 */
function PreviewRows({
  parsed,
  mapping,
}: {
  parsed: Parsed
  mapping: Record<FieldKey, string>
}) {
  const rows = parsed.rows.slice(0, 5)

  return (
    <div className="mt-4">
      <p className="text-xs text-ink-muted">
        Cinq premières lignes, telles qu’elles seront importées :
      </p>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-lg text-left text-xs">
          <thead className="text-ink-muted">
            <tr>
              {FIELDS.map((field) => (
                <th
                  key={field.key}
                  className="border-b border-border py-1.5 pr-3 font-medium"
                >
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {FIELDS.map((field) => {
                  const column = mapping[field.key]
                  const value = column ? row[column] : ''
                  return (
                    <td key={field.key} className="border-b border-border py-1.5 pr-3">
                      {value || <span className="text-ink-muted">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
