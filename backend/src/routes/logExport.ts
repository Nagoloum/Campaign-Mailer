import { Router } from 'express'

import { campaignIdParam, requireAuth, signedInUserId } from '../middleware/auth.js'
import type { CampaignRepository } from '../services/campaigns.js'
import { logsToCsv, type LogExportRepository } from '../services/logExport.js'

export interface LogExportRouterDeps {
  campaigns: CampaignRepository
  logs: LogExportRepository
}

/**
 * GET /api/campaigns/:id/logs/export — the log as a CSV download.
 *
 * `/logs/export` rather than `/logs.csv`: a dot in an Express path is one more
 * pattern rule to get right, and the filename travels in the header anyway.
 */
export function createLogExportRouter({ campaigns, logs }: LogExportRouterDeps): Router {
  const router = Router({ mergeParams: true })

  router.use(requireAuth)

  router.get('/', (req, res, next) => {
    void (async () => {
      const id = campaignIdParam(req)
      const campaign = id ? await campaigns.findForUser(id, signedInUserId(req)) : null

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }

      const csv = logsToCsv(await logs.logsFor(campaign.id), campaign.timezone)

      // The filename is built from the id, which was checked as a uuid: no
      // user-typed campaign name reaches a header.
      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader(
        'content-disposition',
        `attachment; filename="campagne-${campaign.id}-journal.csv"`,
      )
      // A log holds recipients' addresses; no shared cache should keep a copy.
      res.setHeader('cache-control', 'no-store')
      res.send(csv)
    })().catch(next)
  })

  return router
}
