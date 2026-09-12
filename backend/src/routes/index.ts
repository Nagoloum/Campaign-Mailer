import { Router } from 'express'

import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/auth.js'
import { createCampaignRepository } from '../services/campaigns.js'
import { STARTER_TEMPLATES } from '../services/starterTemplates.js'
import { TEMPLATE_VARIABLES } from '../services/template.js'

import { authRouter } from './auth.js'
import { createCampaignRouter } from './campaigns.js'

/**
 * Every API route mounts here under /api. The auth, campaigns, contacts,
 * files and stats routers arrive with their phases; see section 6 of the
 * specification for the full surface.
 */
export const apiRouter = Router()

/**
 * Liveness. Answers as long as the process is up, and says nothing about
 * whether the database or the queue is reachable. Readiness, which does check
 * those, is a Phase 7 task.
 */
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/campaigns', createCampaignRouter(createCampaignRepository(pool)))

/**
 * The starter templates, served rather than duplicated in the web app, so the
 * variable names in them cannot drift from the ones the merge engine resolves.
 */
apiRouter.get('/templates', requireAuth, (_req, res) => {
  res.json({ templates: STARTER_TEMPLATES, variables: TEMPLATE_VARIABLES })
})
