import { PermanentSendError, type SendGateway } from './sendEngine.js'

/**
 * The Gmail API call itself.
 *
 * Everything interesting here is the classification of what comes back. A
 * refusal that stands must not be retried — three attempts against a malformed
 * address cost three minutes and teach nothing — and a transient failure must
 * not mark a contact failed.
 */

const ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

/**
 * Reasons Google gives that are about the moment, not the message.
 *
 * They arrive with 403, the same status as a genuine refusal, so the status
 * alone cannot decide.
 */
const TRANSIENT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError',
  'quotaExceeded',
])

interface GoogleError {
  error?: {
    message?: string
    errors?: { reason?: string; message?: string }[]
  }
}

export function createGmailGateway(): SendGateway {
  return {
    async send(accessToken, raw) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      })

      if (response.ok) {
        const body = (await response.json()) as { id?: string }

        if (!body.id) {
          throw new Error('Gmail accepted the message but returned no id')
        }

        return body.id
      }

      const body = (await response.json().catch(() => ({}))) as GoogleError
      const reason = body.error?.errors?.[0]?.reason
      const message = body.error?.message ?? `Gmail answered ${String(response.status)}`

      if (response.status === 429 || response.status >= 500) {
        throw new Error(message)
      }

      if (response.status === 403 && reason && TRANSIENT_REASONS.has(reason)) {
        // A quota or rate refusal wears the same status as a real one. Marking
        // the contact failed here would lose it for a reason that clears by
        // itself in a minute.
        throw new Error(message)
      }

      // 400 and the rest of 4xx: the message or the address is wrong, and it
      // will be just as wrong on the next attempt.
      throw new PermanentSendError(message)
    },
  }
}
