import { createHmac, randomUUID } from 'node:crypto'

import type { SessionData, Store } from 'express-session'

import { SESSION_COOKIE_NAME } from '../config/session.js'

/**
 * Opens a session for an account without going through Google, for the tests.
 *
 * The session is written straight into the store, and its id signed the way
 * express-session signs its cookie: HMAC-SHA256 with the session secret,
 * base64 without padding, prefixed with "s:". The application has no route or
 * flag for this; only the end-to-end server and the integration tests call it,
 * and src/e2e is excluded from the build.
 */
export async function openSession(
  store: Store,
  userId: string,
  secret: string,
): Promise<{ name: string; value: string; header: string }> {
  const sid = randomUUID()
  const maxAge = 60 * 60 * 1000

  await new Promise<void>((resolve, reject) => {
    store.set(
      sid,
      {
        cookie: {
          originalMaxAge: maxAge,
          expires: new Date(Date.now() + maxAge),
          httpOnly: true,
          path: '/',
        },
        passport: { user: userId },
      } as unknown as SessionData,
      (err: unknown) => {
        if (err) {
          reject(err instanceof Error ? err : new Error('Session store failed'))
        } else {
          resolve()
        }
      },
    )
  })

  const signature = createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '')
  const value = encodeURIComponent(`s:${sid}.${signature}`)

  return { name: SESSION_COOKIE_NAME, value, header: `${SESSION_COOKIE_NAME}=${value}` }
}
