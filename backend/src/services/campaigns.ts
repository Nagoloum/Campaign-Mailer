import type { Pool } from 'pg'

import type { CampaignOwnershipRepository } from '../middleware/auth.js'

/**
 * Campaign persistence. Phase 2 fills this out with the full CRUD; for now it
 * carries only what the ownership guard needs.
 */
export type CampaignRepository = CampaignOwnershipRepository

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
  }
}
