import { RedisStore } from 'connect-redis'

import { createApp } from './app.js'
import { env } from './config/env.js'
import { closePool } from './db/pool.js'
import { closeRedis, connectRedis, redis } from './db/redis.js'
import { createQueueConnection } from './jobs/connection.js'
import { createQueues } from './jobs/queues.js'
import { logger } from './logger.js'

const log = logger.child({ service: 'api' })

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
})

const server = app.listen(env.port, () => {
  log.info({ port: env.port, env: env.nodeEnv }, 'API listening')
})

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy. Sends happen in the
 * worker process, which has its own shutdown in worker.ts; this one only has to
 * stop taking requests and release its connections.
 */
function shutdown(signal: string): void {
  log.info({ signal }, 'Closing server')

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
