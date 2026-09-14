import { randomUUID } from 'node:crypto'

import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'

/**
 * One log line per request, and an id that ties everything about it together.
 *
 * The id is taken from an incoming `x-request-id` when it looks like one — a
 * proxy or the web app may already have assigned it — and generated otherwise.
 * It goes back in the response, so a user reporting a problem can quote it,
 * and every line logged while handling the request carries it through
 * `req.log`.
 *
 * The request is logged as its method and path, nothing more. The default
 * serializer writes the full URL and the headers: that would put the session
 * cookie in the logs, and the `code` Google hands back to the OAuth callback in
 * its query string.
 */

const INCOMING_ID = /^[A-Za-z0-9-]{8,64}$/

export function requestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header
  return value !== undefined && INCOMING_ID.test(value) ? value : randomUUID()
}

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = requestId(req.headers['x-request-id'])
      res.setHeader('x-request-id', id)
      return id
    },
    // A load balancer polls this every few seconds; logging it drowns the rest.
    autoLogging: {
      ignore: (req) => req.url === '/api/health' || req.url === '/api/ready',
    },
    customLogLevel: (_req, res, err) => {
      if (err !== undefined || res.statusCode >= 500) {
        return 'error'
      }
      return res.statusCode >= 400 ? 'warn' : 'info'
    },
    // The account, not the address: enough to find a user's requests, and
    // the id alone points at no one once the account is deleted.
    customProps: (req) => ({
      userId: (req as { user?: { id?: string } }).user?.id,
    }),
    serializers: {
      req: (req: { id?: unknown; method?: string; url?: string }) => ({
        id: req.id,
        method: req.method,
        path: (req.url ?? '').split('?')[0],
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  })
}
