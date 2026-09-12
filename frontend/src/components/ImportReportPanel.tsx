import { reasonLabel, type ImportReport } from '@/services/contacts'

/**
 * What the import did, and what it refused.
 *
 * The rejected rows are downloadable as a CSV because the useful next step is
 * fixing them in the spreadsheet they came from, and copying line numbers off
 * a screen is how that goes wrong.
 */
export function ImportReportPanel({ report }: { report: ImportReport }) {
  function downloadRejected() {
    const header = 'ligne,adresse,motif\n'
    const body = report.rejected
      .map(
        (row) =>
          `${String(row.line)},"${row.email.replace(/"/g, '""')}","${reasonLabel(row.reason)}"`,
      )
      .join('\n')

    // A BOM, so Excel opens the accented labels as UTF-8 instead of mojibake.
    const blob = new Blob([`﻿${header}${body}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'lignes-rejetees.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-3 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">
        {report.imported} contact{report.imported > 1 ? 's' : ''} importé
        {report.imported > 1 ? 's' : ''} sur {report.read} ligne
        {report.read > 1 ? 's' : ''}
      </p>

      {report.rejected.length === 0 ? (
        <p className="mt-1 text-xs text-ink-muted">Aucune ligne rejetée.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            {report.rejected.length} ligne{report.rejected.length > 1 ? 's' : ''} rejetée
            {report.rejected.length > 1 ? 's' : ''}. Les numéros correspondent à ceux de
            votre tableur.
          </p>

          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-raised text-ink-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Ligne</th>
                  <th className="px-3 py-1.5 font-medium">Valeur lue</th>
                  <th className="px-3 py-1.5 font-medium">Motif</th>
                </tr>
              </thead>
              <tbody>
                {report.rejected.map((row) => (
                  <tr
                    key={`${String(row.line)}-${row.email}`}
                    className="border-t border-border"
                  >
                    <td className="px-3 py-1.5 tabular-nums">{row.line}</td>
                    <td className="max-w-56 truncate px-3 py-1.5 font-mono">
                      {row.email}
                    </td>
                    <td className="px-3 py-1.5">{reasonLabel(row.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={downloadRejected}
            className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-raised"
          >
            Télécharger les lignes rejetées
          </button>
        </>
      )}
    </div>
  )
}
