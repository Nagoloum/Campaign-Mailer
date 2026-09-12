import type { Pool } from 'pg'

import type { CampaignOwnershipRepository } from '../middleware/auth.js'
import type { CampaignStatus } from './campaignState.js'

export interface CampaignRow {
  id: string
  user_id: string
  name: string
  subject: string | null
  body_html: string | null
  body_text: string | null
  attachment_key: string | null
  attachment_name: string | null
  status: CampaignStatus
  total_contacts: number
  sent_count: number
  error_count: number
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
  created_at: Date
  updated_at: Date
  scheduled_at: Date | null
  started_at: Date | null
  completed_at: Date | null
}

/** The fields a client may set. Counters and timestamps are the server's. */
export interface CampaignWritableFields {
  name: string
  subject: string | null
  body_html: string | null
  body_text: string | null
  mails_per_day: number
  start_hour: number
  pause_ms: number
  timezone: string
}

/**
 * Columns returned to a client. Written out rather than SELECT *, so a column
 * added later is not exposed by accident.
 */
const COLUMNS = `
  id, user_id, name, subject, body_html, body_text,
  attachment_key, attachment_name, status,
  total_contacts, sent_count, error_count,
  mails_per_day, start_hour, pause_ms, timezone,
  created_at, updated_at, scheduled_at, started_at, completed_at
`

/**
 * A patch, with `undefined` spelled out.
 *
 * `exactOptionalPropertyTypes` is on, so `Partial<T>` would not accept the
 * shape Zod infers, where an absent optional field is explicitly `undefined`.
 */
export type CampaignPatch = {
  [K in keyof CampaignWritableFields]?: CampaignWritableFields[K] | undefined
}

/** The merge fields of one contact, for a preview. Contacts land fully in Phase 3. */
export interface PreviewContactRow {
  id: string
  email: string
  contact_name: string | null
  company_name: string | null
  salutation: string | null
}

export interface CampaignRepository extends CampaignOwnershipRepository {
  findContact(campaignId: string, contactId: string): Promise<PreviewContactRow | null>
  listForUser(userId: string): Promise<CampaignRow[]>
  create(userId: string, input: CampaignPatch & { name: string }): Promise<CampaignRow>
  findForUser(campaignId: string, userId: string): Promise<CampaignRow | null>
  update(campaignId: string, patch: CampaignPatch): Promise<CampaignRow | null>
  remove(campaignId: string): Promise<boolean>
}

/** Column names a patch may touch, so a key from a payload never reaches SQL. */
const PATCHABLE = new Set<keyof CampaignWritableFields>([
  'name',
  'subject',
  'body_html',
  'body_text',
  'mails_per_day',
  'start_hour',
  'pause_ms',
  'timezone',
])

export function createCampaignRepository(pool: Pool): CampaignRepository {
  return {
    async belongsTo(campaignId, userId) {
      // Both conditions in one query. Fetching the campaign and comparing in
      // JavaScript would pull a row the caller is not allowed to see into
      // memory, and into any log that dumps it.
      const { rows } = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM campaigns WHERE id = $1 AND user_id = $2) AS exists',
        [campaignId, userId],
      )

      return rows[0]?.exists ?? false
    },

    async listForUser(userId) {
      const { rows } = await pool.query<CampaignRow>(
        `SELECT ${COLUMNS} FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      )

      return rows
    },

    async create(userId, input) {
      const { rows } = await pool.query<CampaignRow>(
        `INSERT INTO campaigns (user_id, name, subject, body_html, body_text,
                                mails_per_day, start_hour, pause_ms, timezone)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6, 46), COALESCE($7, 9), COALESCE($8, 3000), COALESCE($9, 'Europe/Paris'))
         RETURNING ${COLUMNS}`,
        [
          userId,
          input.name,
          input.subject ?? null,
          input.body_html ?? null,
          input.body_text ?? null,
          input.mails_per_day ?? null,
          input.start_hour ?? null,
          input.pause_ms ?? null,
          input.timezone ?? null,
        ],
      )

      const row = rows[0]

      if (!row) {
        throw new Error('Campaign insert returned no row')
      }

      return row
    },

    async findForUser(campaignId, userId) {
      const { rows } = await pool.query<CampaignRow>(
        `SELECT ${COLUMNS} FROM campaigns WHERE id = $1 AND user_id = $2`,
        [campaignId, userId],
      )

      return rows[0] ?? null
    },

    async update(campaignId, patch) {
      // The column names come from the allowlist above, never from the keys of
      // the payload, so no caller-supplied string can become an identifier in
      // the statement. The values are read through a Map rather than by
      // indexing the payload with a variable.
      const supplied = new Map(Object.entries(patch))
      const columns = [...PATCHABLE].filter((column) => supplied.has(column))

      if (columns.length === 0) {
        // The schema refuses an empty patch, so reaching here is a programming
        // error rather than a bad request. Failing loudly beats returning a
        // row that was never updated.
        throw new Error('update called with no patchable field')
      }

      const assignments = columns.map(
        (column, index) => `${column} = $${String(index + 2)}`,
      )
      const values = columns.map((column) => supplied.get(column) ?? null)

      const { rows } = await pool.query<CampaignRow>(
        `UPDATE campaigns SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
        [campaignId, ...values],
      )

      return rows[0] ?? null
    },

    async findContact(campaignId, contactId) {
      // Scoped by campaign as well as by id, so a contact id from another
      // campaign cannot be previewed through this one.
      const { rows } = await pool.query<PreviewContactRow>(
        `SELECT id, email, contact_name, company_name, salutation
         FROM contacts WHERE id = $1 AND campaign_id = $2`,
        [contactId, campaignId],
      )

      return rows[0] ?? null
    },

    async remove(campaignId) {
      const result = await pool.query('DELETE FROM campaigns WHERE id = $1', [campaignId])

      return (result.rowCount ?? 0) > 0
    },
  }
}
