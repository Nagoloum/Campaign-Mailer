/**
 * Revokes the application's access to a Google account.
 *
 * Deleting the rows is not enough to end the relationship: the grant lives at
 * Google, and a refresh token copied before deletion would still send mail in
 * the user's name. Revoking the refresh token revokes the whole grant, access
 * tokens included, and removes the application from the user's Google account
 * permissions page.
 */
export type GoogleTokenRevoker = (token: string) => Promise<void>

export function createGoogleTokenRevoker(): GoogleTokenRevoker {
  return async (token) => {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      // In the body, never in the URL, so no proxy or access log keeps it.
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })

    if (response.ok) {
      return
    }

    // invalid_token means Google no longer honours it: revoked by the user,
    // expired, or already revoked. The outcome the caller wants is already
    // true, so it is not a failure.
    const body = (await response.json().catch(() => ({}))) as { error?: string }

    if (body.error === 'invalid_token') {
      return
    }

    throw new Error(`Google revocation answered ${String(response.status)}`)
  }
}
