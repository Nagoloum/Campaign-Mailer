import type { Pool } from 'pg'

import type { UserAuthRepository, UserAuthRow } from './tokenRefresh.js'

/** The subset of a Google profile this application reads. */
export interface GoogleProfile {
  id: string
  displayName?: string
  emails?: { value: string }[]
}

export interface UpsertGoogleUser {
  googleId: string
  email: string
  /** Ciphertext. See services/encryption.ts. */
  accessToken: string
  /**
   * Ciphertext, or undefined when Google sent none. Undefined means "keep what
   * is already stored", never "clear it".
   */
  refreshToken?: string | undefined
  accessTokenExpiresAt?: Date | undefined
}

export interface UserRow {
  id: string
  email: string
  google_id: string
  created_at: Date
  updated_at: Date
}

/** The only shape of a user that may cross the API boundary. */
export interface PublicUser {
  id: string
  email: string
  createdAt: string
}

/**
 * Whitelists the fields the API may return.
 *
 * A whitelist rather than deleting the sensitive ones: a column added to the
 * table later is excluded by default instead of leaking until someone
 * remembers to hide it.
 */
export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: new Date(user.created_at).toISOString(),
  }
}

export interface UserRepository extends UserAuthRepository {
  upsertFromGoogle(input: UpsertGoogleUser): Promise<UserRow>
  /** Used to rebuild the request user from the session. Null when the account is gone. */
  findById(id: string): Promise<UserRow | null>
}

const UPSERT_SQL = `
  INSERT INTO users (google_id, email, google_access_token, google_refresh_token, google_token_expires_at)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (google_id) DO UPDATE SET
    email                   = EXCLUDED.email,
    google_access_token     = EXCLUDED.google_access_token,
    -- COALESCE, not EXCLUDED: Google sends a refresh token only on the first
    -- authorization. Overwriting with NULL on a later sign-in would leave the
    -- account unable to send until the user revokes access and starts over.
    google_refresh_token    = COALESCE(EXCLUDED.google_refresh_token, users.google_refresh_token),
    google_token_expires_at = COALESCE(EXCLUDED.google_token_expires_at, users.google_token_expires_at)
  RETURNING id, email, google_id, created_at, updated_at
`

export function createUserRepository(pool: Pool): UserRepository {
  return {
    async upsertFromGoogle(input) {
      const { rows } = await pool.query<UserRow>(UPSERT_SQL, [
        input.googleId,
        input.email,
        input.accessToken,
        input.refreshToken ?? null,
        input.accessTokenExpiresAt ?? null,
      ])

      const row = rows[0]

      if (!row) {
        throw new Error('Upsert returned no row')
      }

      return row
    },

    async findById(id) {
      const { rows } = await pool.query<UserRow>(
        'SELECT id, email, google_id, created_at, updated_at FROM users WHERE id = $1',
        [id],
      )

      return rows[0] ?? null
    },

    async findAuthById(id) {
      const { rows } = await pool.query<UserAuthRow>(
        `SELECT id, google_access_token, google_refresh_token, google_token_expires_at
         FROM users WHERE id = $1`,
        [id],
      )

      return rows[0] ?? null
    },

    async saveAccessToken(id, accessToken, expiresAt) {
      // Only the access token and its expiry. The refresh token is untouched
      // here: a renewal never replaces it, and Google does not send a new one.
      await pool.query(
        `UPDATE users
         SET google_access_token = $2, google_token_expires_at = $3
         WHERE id = $1`,
        [id, accessToken, expiresAt],
      )
    },
  }
}
