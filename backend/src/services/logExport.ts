import type { Pool } from 'pg'

/**
 * A campaign's log, as a CSV the user opens in a spreadsheet.
 *
 * Two dangers, both about what a spreadsheet does with a cell. The addresses
 * came from a CSV the user imported, so any of them may start with `=`, and a
 * spreadsheet runs a cell that starts with `=` as a formula — the classic CSV
 * injection. And a comma, a quote or a newline inside a value would shift every
 * column after it. Every cell is therefore neutralised and quoted, without
 * exception.
 */

export interface LogRow {
  created_at: Date
  event_type: string
  email: string | null
  message: string | null
}

export interface LogExportRepository {
  logsFor(campaignId: string): Promise<LogRow[]>
}

export function createLogExportRepository(pool: Pool): LogExportRepository {
  return {
    async logsFor(campaignId) {
      const { rows } = await pool.query<LogRow>(
        `SELECT l.created_at, l.event_type, c.email, l.message
         FROM logs l
         LEFT JOIN contacts c ON c.id = l.contact_id
         WHERE l.campaign_id = $1
         ORDER BY l.created_at, l.id`,
        [campaignId],
      )

      return rows
    },
  }
}

const EVENT_LABELS = new Map([
  ['sent', 'envoyé'],
  ['error', 'erreur'],
  ['bounce', 'rejet'],
  ['open', 'ouverture'],
  ['click', 'clic'],
])

/** Characters a spreadsheet reads as the start of a formula or a control. */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One cell: prefixed with an apostrophe when a spreadsheet would run it, then
 * quoted with its own quotes doubled.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** `YYYY-MM-DD HH:mm:ss` on the campaign's wall clock, which is what the user reads. */
function formatInZone(date: Date, timezone: string): string {
  // The sv-SE locale writes exactly that shape.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function logsToCsv(rows: readonly LogRow[], timezone: string): string {
  const header = ['date', 'evenement', 'adresse', 'detail'].map(csvCell).join(',')

  const lines = rows.map((row) =>
    [
      formatInZone(row.created_at, timezone),
      EVENT_LABELS.get(row.event_type) ?? row.event_type,
      row.email ?? '',
      row.message ?? '',
    ]
      .map(csvCell)
      .join(','),
  )

  // A BOM, so Excel reads the accents as UTF-8; CRLF, as RFC 4180 specifies.
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}
