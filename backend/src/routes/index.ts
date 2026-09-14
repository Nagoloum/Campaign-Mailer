import express, { Router } from 'express'

import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/auth.js'
import { createCampaignRepository } from '../services/campaigns.js'
import { deleteAccount } from '../services/accountDeletion.js'
import { createContactRepository } from '../services/contacts.js'
import { createTokenCipher } from '../services/encryption.js'
import { createGoogleTokenRevoker } from '../services/googleRevoke.js'
import { deleteCampaignFiles } from '../services/storage.js'
import { createLogExportRepository } from '../services/logExport.js'
import { createStatsRepository } from '../services/stats.js'
import { STARTER_TEMPLATES } from '../services/starterTemplates.js'
import { TEMPLATE_VARIABLES } from '../services/template.js'

import { createAttachmentRouter } from './attachment.js'
import { authRouter } from './auth.js'
import { createCampaignRouter } from './campaigns.js'
import { createContactRouter } from './contacts.js'
import { createDashboardRouter } from './dashboard.js'
import { createLogExportRouter } from './logExport.js'
import { createStatsRouter } from './stats.js'
import { createUsersRouter } from './users.js'

export interface ApiRouterDeps {
  /**
   * Asks the worker to plan a campaign now. Injected so the API can be built
   * without a queue connection, as the tests do.
   */
  requestDispatch?: ((campaignId: string) => Promise<void>) | undefined
}

/**
 * Every API route mounts here under /api. The stats routes arrive with their
 * phase; see section 6 of the specification for the full surface.
 */
export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const apiRouter = Router()

  /**
   * Liveness. Answers as long as the process is up, and says nothing about
   * whether the database or the queue is reachable. Readiness, which does check
   * those, is a Phase 7 task.
   */
  apiRouter.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
  })

  apiRouter.use('/auth', authRouter)

  const deletion = {
    pool,
    cipher: createTokenCipher(env.encryptionKey),
    revokeGoogleToken: createGoogleTokenRevoker(),
    deleteCampaignFiles,
  }
  apiRouter.use(
    '/users',
    createUsersRouter({ deleteAccount: (userId) => deleteAccount(deletion, userId) }),
  )
  const campaignRepository = createCampaignRepository(pool)

  apiRouter.use(
    '/campaigns',
    createCampaignRouter(campaignRepository, {
      requestDispatch: deps.requestDispatch,
      accountDailyLimit: env.gmailDailyLimit,
    }),
  )
  apiRouter.use('/campaigns/:id/attachment', createAttachmentRouter(campaignRepository))
  const statsRepository = createStatsRepository(pool)

  apiRouter.use(
    '/campaigns/:id/stats',
    createStatsRouter({ campaigns: campaignRepository, stats: statsRepository }),
  )
  apiRouter.use(
    '/campaigns/:id/logs/export',
    createLogExportRouter({
      campaigns: campaignRepository,
      logs: createLogExportRepository(pool),
    }),
  )
  apiRouter.use(
    '/dashboard',
    createDashboardRouter({
      campaigns: campaignRepository,
      stats: statsRepository,
      accountDailyLimit: env.gmailDailyLimit,
    }),
  )
  apiRouter.use(
    '/campaigns/:id/contacts',
    // A batch of rows is larger than the default body limit, and raising it
    // globally would let any route accept five megabytes.
    express.json({ limit: '5mb' }),
    createContactRouter({
      campaigns: campaignRepository,
      contacts: createContactRepository(pool),
    }),
  )

  /**
   * The starter templates, served rather than duplicated in the web app, so the
   * variable names in them cannot drift from the ones the merge engine resolves.
   */
  apiRouter.get('/templates', requireAuth, (_req, res) => {
    res.json({ templates: STARTER_TEMPLATES, variables: TEMPLATE_VARIABLES })
  })

  return apiRouter
}
