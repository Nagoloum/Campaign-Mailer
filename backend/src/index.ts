import { RedisStore } from 'connect-redis'

import { createApp } from './app.js'
import { env } from './config/env.js'
import { closePool } from './db/pool.js'
import { closeRedis, redis } from './db/redis.js'

const app = createApp({
  sessionStore: new RedisStore({ client: redis, prefix: 'cm:sess:' }),
})

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} [${env.nodeEnv}]`)
})

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy, and a send job
 * cut mid-flight is the situation that produces a duplicate email, so the
 * process finishes what it holds before exiting. The BullMQ worker registers
 * its own shutdown here when it lands in Phase 4.
 */
function shutdown(signal: string): void {
  console.log(`${signal} received, closing server`)

  server.close((err) => {
    if (err) {
      console.error('Error while closing server', err)
      process.exit(1)
    }

    // Release the database and Redis connections, so the host does not have to
    // wait for them to time out on its side.
    Promise.allSettled([closePool(), closeRedis()])
      .then(() => {
        process.exit(0)
      })
      .catch(() => {
        process.exit(1)
      })
  })

  // Do not hang forever on a stuck connection.
  setTimeout(() => {
    console.error('Forced exit after shutdown timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  shutdown('SIGINT')
})
