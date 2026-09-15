import { RedisStore } from 'connect-redis'

import { createApp } from './app.js'
import { env } from './config/env.js'
import { closePool, pool } from './db/pool.js'
import { closeRedis, connectRedis, redis } from './db/redis.js'
import { createQueueConnection } from './jobs/connection.js'
import { readHeartbeat } from './jobs/heartbeat.js'
import { createQueues } from './jobs/queues.js'
import { logger } from './logger.js'
import {
  createAlertTracker,
  queueStuckAlert,
  readQueueHealth,
  runAlertChecks,
  workerStoppedAlert,
} from './services/alerts.js'
import {
  closeErrorReporting,
  initErrorReporting,
  reportAlert,
} from './services/errorReporting.js'
import { checkReadiness } from './services/readiness.js'

const log = logger.child({ service: 'api' })

const reporting = initErrorReporting({
  dsn: env.sentryDsn,
  environment: env.nodeEnv,
  release: env.release,
  service: 'api',
})

// node-redis connects explicitly, and the session store is unusable until it
// does. Failing here rather than on the first sign-in keeps a misconfigured
// Redis from looking like a broken login.
await connectRedis()

// The API only adds jobs; the worker process runs them. A queue with no worker
// attached does not poll Redis, so this connection costs nothing while idle.
const queueConnection = createQueueConnection(env.redisUrl)
const queues = createQueues(queueConnection)

const app = createApp({
  sessionStore: new RedisStore({ client: redis, prefix: 'cm:sess:' }),
  requestDispatch: (campaignId) => queues.requestDispatch(campaignId),
  checkReadiness: () =>
    checkReadiness({
      database: async () => {
        await pool.query('SELECT 1')
      },
      sessionStore: async () => {
        await redis.ping()
      },
      queue: async () => {
        const counts = await queues.queue.getJobCounts(
          'waiting',
          'prioritized',
          'delayed',
          'active',
          'failed',
        )
        return {
          waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
          delayed: counts.delayed ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
        }
      },
      workerHeartbeat: () => readHeartbeat(queueConnection),
    }),
})

const server = app.listen(env.port, () => {
  log.info(
    { port: env.port, env: env.nodeEnv, errorReporting: reporting },
    'API listening',
  )
})

/**
 * Watches the worker and the queue from here, because a stopped worker cannot
 * say so itself. Redis only: four commands every five minutes, and the
 * database is left to sleep. One API instance should run it, or each sends
 * the same alert.
 */
const MONITOR_EVERY_MS = 5 * 60 * 1000
const monitorTracker = createAlertTracker()

function monitorWorker(): void {
  runAlertChecks({
    watched: ['worker_stopped', 'queue_stuck'],
    checks: async () => {
      const [lastSeen, health] = await Promise.all([
        readHeartbeat(queueConnection),
        readQueueHealth(queues.queue),
      ])
      const now = Date.now()
      return [workerStoppedAlert(lastSeen, now), queueStuckAlert(health, now)]
    },
    tracker: monitorTracker,
    log,
    report: reportAlert,
  }).catch((err: unknown) => {
    log.warn({ err }, 'Worker monitor check failed')
  })
}

const monitorTimer = env.monitorWorker
  ? setInterval(monitorWorker, MONITOR_EVERY_MS)
  : undefined

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy. Sends happen in the
 * worker process, which has its own shutdown in worker.ts; this one only has to
 * stop taking requests and release its connections.
 */
function shutdown(signal: string): void {
  log.info({ signal }, 'Closing server')
  clearInterval(monitorTimer)

  server.close((err) => {
    if (err) {
      log.error({ err }, 'Error while closing server')
      process.exit(1)
    }

    // Release the database and Redis connections, so the host does not have to
    // wait for them to time out on its side.
    Promise.allSettled([
      closePool(),
      closeRedis(),
      queues.close().then(() => queueConnection.quit()),
      closeErrorReporting(),
    ])
      .then(() => {
        process.exit(0)
      })
      .catch(() => {
        process.exit(1)
      })
  })

  // Do not hang forever on a stuck connection.
  setTimeout(() => {
    log.error('Forced exit after shutdown timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  shutdown('SIGINT')
})
