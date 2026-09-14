import { Router } from 'express'
import type { Logger } from 'pino'

import type { ReadinessReport } from '../services/readiness.js'

/**
 * GET /api/ready — whether this instance can serve requests.
 *
 * 200 when it can, 503 when it cannot, so a load balancer or a deploy check
 * can act on the status alone. The body names each check and the queue's depth,
 * never an error message: this endpoint is public, and "connection refused to
 * <host>" is a detail for the logs.
 */
export function createReadyRouter(check: () => Promise<ReadinessReport>): Router {
  const router = Router()

  router.get('/', (req, res, next) => {
    void (async () => {
      const report = await check()

      if (!report.ready) {
        ;(req as { log?: Logger }).log?.warn({ checks: report.checks }, 'Not ready')
      }

      res.setHeader('cache-control', 'no-store')
      res.status(report.ready ? 200 : 503).json(report)
    })().catch(next)
  })

  return router
}
