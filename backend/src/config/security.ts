import type { CorsOptions } from 'cors'
import type { Request } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'
import type { HelmetOptions } from 'helmet'

/**
 * Response headers for the API.
 *
 * The API serves JSON, one redirect flow and file downloads, never a page, so
 * its Content-Security-Policy allows nothing at all: a response that somehow
 * rendered as HTML could load no script, no style and no frame, and could not
 * be framed itself. The web application's own policy, which does have to
 * allow things, is set where it is served (frontend/vercel.json).
 *
 * HSTS only in production. Sent from localhost it would teach a developer's
 * browser to refuse plain HTTP to that host for a year.
 */
export function buildHelmetOptions(isProduction: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    // The API has no reason to tell anyone which URL a request came from.
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }
}

/** Section 8 of the specification: 100 requests a minute per user. */
export const RATE_LIMIT = {
  windowMs: 60_000,
  limit: 100,
} as const

type OriginCallback = (err: Error | null, allow?: boolean) => void

export interface CorsDecisionOptions extends CorsOptions {
  origin: (origin: string | undefined, callback: OriginCallback) => void
}

/**
 * One allowed origin, compared exactly.
 *
 * An exact comparison rather than a prefix or a regular expression: a prefix
 * check accepts `http://localhost:5173.evil.example`, which is a different
 * host that happens to start the same way.
 */
export function buildCorsOptions(frontendUrl: string): CorsDecisionOptions {
  return {
    origin(origin, callback) {
      // No Origin header: curl, a health check, and the OAuth redirect, which
      // is a top-level navigation rather than a cross-origin fetch.
      if (origin === undefined) {
        callback(null, true)
        return
      }

      callback(null, origin === frontendUrl)
    },
    // Without this the browser drops the session cookie on every API call.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }
}

/**
 * Counts a request against the account when there is one, and against the
 * address otherwise.
 *
 * Keying on the address alone punishes an office or a campus, where many users
 * share one, and lets a signed-in caller reset their allowance by changing
 * network. The two namespaces are kept apart so an id can never collide with
 * an address.
 *
 * Everything is in this one function on purpose. express-rate-limit validates
 * the key generator by reading its source: an ipKeyGenerator call delegated to
 * a helper reads to it as an unguarded use of the address and raises
 * ERR_ERL_KEY_GEN_IPV6. Keeping the call here leaves that check meaningful
 * rather than silenced.
 */
export function rateLimitKey(req: Pick<Request, 'user' | 'ip'>): string {
  const user = req.user as { id: string } | undefined

  if (user?.id) {
    return `user:${user.id}`
  }

  // ipKeyGenerator normalises IPv6 to a /64 prefix. Without it a caller
  // holding an IPv6 range gets a fresh allowance for every address in it.
  return `ip:${req.ip ? ipKeyGenerator(req.ip) : 'unknown'}`
}
