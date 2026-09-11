import { Router } from 'express'

import { authRouter } from './auth.js'

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
