import type { Pool } from 'pg'

import { logger } from '../logger.js'

import type { TokenCipher } from './encryption.js'
import type { GoogleTokenRevoker } from './googleRevoke.js'

/**
 * Deleting an account, completely.
 *
 * The order is chosen so that the one step that must not fail — removing the
 * user's data — never waits on the two that can:
 *
 * 1. revoke the Google grant, while the token is still readable
 * 2. delete the user; the schema cascades to campaigns, contacts and logs
 * 3. purge the stored attachments
 *
 * A revocation or a purge that fails is logged and reported, never allowed to
 * stop the deletion. The user asked for their data to be gone, and it is gone;
 * a leftover grant or file is something to retry, not a reason to keep rows.
 */

export interface AccountDeletionDeps {
  pool: Pool
  cipher: TokenCipher
  revokeGoogleToken: GoogleTokenRevoker
  /** Deletes every object stored for one campaign. */
  deleteCampaignFiles: (campaignId: string) => Promise<void>
  log?: ((message: string, detail: Record<string, unknown>) => void) | undefined
}

export interface DeletionReport {
  deleted: boolean
  googleRevoked: boolean
  filesPurged: boolean
}

function describe(err: unknown): string {
  // The message only. A failed fetch or decrypt never carries the token in its
  // message, but an error object logged whole could carry request details.
  return err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error'
}

export async function deleteAccount(
  deps: AccountDeletionDeps,
  userId: string,
): Promise<DeletionReport> {
  const log =
    deps.log ??
    ((message: string, detail: Record<string, unknown>) => {
      logger.error(detail, message)
    })

  const { rows } = await deps.pool.query<{
    google_refresh_token: string | null
    google_access_token: string | null
  }>('SELECT google_refresh_token, google_access_token FROM users WHERE id = $1', [
    userId,
  ])

  const user = rows[0]

  if (!user) {
    return { deleted: false, googleRevoked: false, filesPurged: false }
  }

  // Listed before the delete: afterwards the cascade has taken them.
  const campaigns = await deps.pool.query<{ id: string }>(
    'SELECT id FROM campaigns WHERE user_id = $1',
    [userId],
  )

  // The refresh token revokes the whole grant; the access token is the fallback
  // for an account that never stored one.
  let googleRevoked = false
  const bundle = user.google_refresh_token ?? user.google_access_token

  if (bundle) {
    try {
      await deps.revokeGoogleToken(deps.cipher.decrypt(bundle))
      googleRevoked = true
    } catch (err) {
      log('Google revocation failed during account deletion', {
        userId,
        error: describe(err),
      })
    }
  } else {
    // Nothing to revoke: the grant was never stored, so none survives.
    googleRevoked = true
  }

  // One statement. ON DELETE CASCADE on every foreign key takes the campaigns,
  // their contacts and their logs with the user, so no row can be forgotten.
  await deps.pool.query('DELETE FROM users WHERE id = $1', [userId])

  let filesPurged = true

  for (const campaign of campaigns.rows) {
    try {
      await deps.deleteCampaignFiles(campaign.id)
    } catch (err) {
      filesPurged = false
      log('Attachment purge failed during account deletion', {
        campaignId: campaign.id,
        error: describe(err),
      })
    }
  }

  return { deleted: true, googleRevoked, filesPurged }
}
