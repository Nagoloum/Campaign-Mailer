import type { TokenCipher } from './encryption.js'

/**
 * Raised when no amount of retrying will help: the user has to connect their
 * Google account again.
 *
 * The send engine treats this differently from every other failure. A
 * transient error means retry; this one means stop the campaign and tell the
 * user, because every further attempt would fail the same way.
 */
export class ReauthorizationRequiredError extends Error {
  constructor(reason: string) {
    super(`Google authorization is no longer valid (${reason})`)
    this.name = 'ReauthorizationRequiredError'
  }
}

/** The token columns, as stored: both values are ciphertext. */
export interface UserAuthRow {
  id: string
  google_access_token: string | null
  google_refresh_token: string | null
  google_token_expires_at: Date | null
}

export interface UserAuthRepository {
  findAuthById(id: string): Promise<UserAuthRow | null>
  saveAccessToken(id: string, accessToken: string, expiresAt: Date): Promise<void>
}

/** Exchanges a refresh token for a new access token. Injected so tests stay offline. */
export type GoogleTokenEndpoint = (
  refreshToken: string,
) => Promise<{ accessToken: string; expiresIn: number }>

export interface AccessTokenProviderDeps {
  auth: UserAuthRepository
  cipher: TokenCipher
  endpoint: GoogleTokenEndpoint
}

/**
 * How long before expiry a token is treated as already expired.
 *
 * Renewing only once the token is actually dead guarantees a race: it expires
 * between the check and the Gmail call, and a send fails for no good reason.
 */
const EXPIRY_SKEW_MS = 60_000

/**
 * Returns a usable Google access token for a user, refreshing it when needed.
 *
 * Every call into the Gmail API goes through this. Callers receive a
 * plaintext token and never touch the stored ciphertext.
 */
export function createAccessTokenProvider({
  auth,
  cipher,
  endpoint,
}: AccessTokenProviderDeps) {
  return async function getAccessToken(userId: string): Promise<string> {
    const row = await auth.findAuthById(userId)

    if (!row) {
      throw new ReauthorizationRequiredError('no such account')
    }

    const expiresAt = row.google_token_expires_at
    const stillValid =
      expiresAt !== null && expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()

    if (stillValid && row.google_access_token) {
      return cipher.decrypt(row.google_access_token)
    }

    if (!row.google_refresh_token) {
      // Google issues a refresh token on first authorization only. Without one
      // there is nothing to renew with.
      throw new ReauthorizationRequiredError('no refresh token stored')
    }

    const refreshed = await endpoint(cipher.decrypt(row.google_refresh_token))
    const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000)

    await auth.saveAccessToken(userId, cipher.encrypt(refreshed.accessToken), newExpiry)

    return refreshed.accessToken
  }
}

/**
 * The real exchange against Google.
 *
 * invalid_grant is singled out because it is the one answer that cannot be
 * retried: the user revoked access, changed their password, or the app is
 * still in Testing, where refresh tokens expire after seven days.
 */
export function createGoogleTokenEndpoint(config: {
  clientId: string
  clientSecret: string
}): GoogleTokenEndpoint {
  return async (refreshToken) => {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      // The body carries an error code and no secret, but it is read as a
      // narrow shape rather than forwarded, so nothing unexpected is logged.
      const body = (await response.json().catch(() => ({}))) as { error?: string }

      if (body.error === 'invalid_grant') {
        throw new ReauthorizationRequiredError('invalid_grant')
      }

      throw new Error(`Google token endpoint answered ${String(response.status)}`)
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number }

    if (!body.access_token) {
      throw new Error('Google token endpoint returned no access token')
    }

    return {
      accessToken: body.access_token,
      // Google always sends expires_in; the fallback keeps a missing value
      // from producing a token that never looks expired.
      expiresIn: body.expires_in ?? 0,
    }
  }
}
