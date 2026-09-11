import type { CookieOptions, SessionOptions, Store } from 'express-session'

/**
 * Not `connect.sid`. The default name tells anyone looking which framework
 * serves the application, which is free reconnaissance.
 */
export const SESSION_COOKIE_NAME = 'cm.sid'

/** Two weeks. Long enough not to annoy, short enough that a stolen cookie expires. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const MIN_SECRET_LENGTH = 32

export interface SessionConfig {
  secret: string
  isProduction: boolean
  store: Store
}

/**
 * express-session types `cookie` as either options or a function of the
 * request. Narrowing it here keeps the settings inspectable by callers and by
 * the tests, which is the point of building them in one place.
 */
type ResolvedSessionOptions = SessionOptions & { cookie: CookieOptions }

export function buildSessionOptions({
  secret,
  isProduction,
  store,
}: SessionConfig): ResolvedSessionOptions {
  if (!secret) {
    throw new Error('SESSION_SECRET is required')
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
  }

  return {
    name: SESSION_COOKIE_NAME,
    secret,
    store,
    // An unchanged session does not need rewriting on every request.
    resave: false,
    // No Redis key for a visitor who never signs in, crawlers included.
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Only over HTTPS in production. Forcing it in development would stop
      // the cookie from ever being set over plain HTTP on localhost.
      secure: isProduction,
      // lax, not strict: Google redirects the browser back to the callback,
      // and a strict cookie is withheld on that cross-site navigation, which
      // breaks the OAuth state check.
      sameSite: 'lax',
      maxAge: MAX_AGE_MS,
      path: '/',
    },
  }
}
