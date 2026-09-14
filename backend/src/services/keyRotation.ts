import type { Pool } from 'pg'

import { logger } from '../logger.js'

import type { TokenCipher } from './encryption.js'

/**
 * Re-encrypts every stored Google token under the current key.
 *
 * The second half of a rotation (docs/security.md). Once every token has been
 * rewritten, the previous key can be dropped from the configuration, and a
 * copy of it stops being worth anything.
 *
 * Nothing here prints or returns a token. A row neither key can read is
 * counted and left untouched: overwriting it would destroy the only copy, and
 * its owner reconnecting Google replaces it cleanly.
 */

export interface RotationReport {
  users: number
  reencrypted: number
  alreadyCurrent: number
  unreadable: number
}

type Outcome =
  { kind: 'current' } | { kind: 'rotated'; bundle: string } | { kind: 'unreadable' }

function rotate(
  bundle: string,
  currentOnly: TokenCipher,
  withPrevious: TokenCipher,
): Outcome {
  try {
    currentOnly.decrypt(bundle)
    return { kind: 'current' }
  } catch {
    // Not under the current key; the previous ones may read it.
  }

  try {
    return { kind: 'rotated', bundle: currentOnly.encrypt(withPrevious.decrypt(bundle)) }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * @param currentOnly a cipher built from the current key alone
 * @param withPrevious a cipher built from the current key and the retired ones
 */
export async function reencryptTokens(
  pool: Pool,
  currentOnly: TokenCipher,
  withPrevious: TokenCipher,
): Promise<RotationReport> {
  const { rows } = await pool.query<{
    id: string
    google_access_token: string | null
    google_refresh_token: string | null
  }>('SELECT id, google_access_token, google_refresh_token FROM users')

  const report: RotationReport = {
    users: rows.length,
    reencrypted: 0,
    alreadyCurrent: 0,
    unreadable: 0,
  }

  for (const row of rows) {
    const next = { access: row.google_access_token, refresh: row.google_refresh_token }
    let changed = false

    for (const column of ['access', 'refresh'] as const) {
      const bundle = column === 'access' ? next.access : next.refresh

      if (bundle === null) {
        continue
      }

      const outcome = rotate(bundle, currentOnly, withPrevious)

      switch (outcome.kind) {
        case 'current':
          report.alreadyCurrent += 1
          break
        case 'rotated':
          report.reencrypted += 1
          changed = true
          if (column === 'access') {
            next.access = outcome.bundle
          } else {
            next.refresh = outcome.bundle
          }
          break
        case 'unreadable':
          report.unreadable += 1
          // The id only, so an operator can ask that user to reconnect.
          logger.error({ userId: row.id }, 'Stored token readable by no configured key')
          break
      }
    }

    if (changed) {
      // Conditional on the values read, so a sign-in that replaced a token
      // meanwhile is not overwritten with an older one.
      await pool.query(
        `UPDATE users SET google_access_token = $2, google_refresh_token = $3
         WHERE id = $1
           AND google_access_token IS NOT DISTINCT FROM $4
           AND google_refresh_token IS NOT DISTINCT FROM $5`,
        [
          row.id,
          next.access,
          next.refresh,
          row.google_access_token,
          row.google_refresh_token,
        ],
      )
    }
  }

  return report
}
