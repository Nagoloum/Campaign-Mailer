import type { Pool } from 'pg'

/**
 * The version of the terms and privacy policy in force.
 *
 * Must equal TERMS_VERSION in frontend/src/services/legal.ts, which is what the
 * interface shows and sends back; terms.test.ts reads that file and fails if
 * the two differ. Changing it asks every user to accept again at their next
 * request.
 */
export const CURRENT_TERMS_VERSION = '2026-09-14'

export interface TermsRepository {
  accept(userId: string, version: string): Promise<void>
}

export function createTermsRepository(pool: Pool): TermsRepository {
  return {
    async accept(userId, version) {
      await pool.query(
        'UPDATE users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1',
        [userId, version],
      )
    },
  }
}
