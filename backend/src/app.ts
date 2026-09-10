import express, { type Express } from 'express'

import { errorHandler, notFound } from './middleware/errorHandler.js'
import { apiRouter } from './routes/index.js'

/**
 * Builds the Express application without starting a server, so tests can
 * drive it in-process.
 *
 * Security middleware belongs here and lands in Phase 1: helmet, CORS
 * restricted to FRONTEND_URL, the Redis-backed session, and the per-user rate
 * limit.
 */
export function createApp(): Express {
  const app = express()

  // Behind Railway's proxy, so req.ip and secure cookies need the hop counted.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))

  app.use('/api', apiRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
