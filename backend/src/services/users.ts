import type { Pool } from 'pg'

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

export interface UserRepository {
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
  }
}
