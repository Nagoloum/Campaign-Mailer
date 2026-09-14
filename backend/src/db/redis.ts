import { createClient } from 'redis'

import { env } from '../config/env.js'
import { logger } from '../logger.js'

/**
 * Redis connection for the session store.
 *
 * node-redis, not ioredis. connect-redis 10 declares `redis >= 5` as its peer
 * and calls `client.set(key, value, { expiration: ... })`, an options object
 * ioredis does not understand: paired with ioredis every session write fails
 * with `ERR syntax error` and no session is ever stored.
 *
 * BullMQ requires ioredis, so Phase 4 adds that client alongside this one.
 * Two libraries is the cost of each one being used with the partner it
 * supports.
 *
 * The URL uses rediss://, so TLS is on. Upstash rejects a plain connection.
 */
export const redis = createClient({
  url: env.redisUrl,
  socket: {
    // Give up rather than queue commands forever while Redis is down, so an
    // outage surfaces as a failed request instead of a hung one.
    reconnectStrategy: (retries) =>
      retries > 5 ? new Error('Redis unreachable') : 250 * retries,
  },
})

redis.on('error', (err: Error) => {
  // node-redis reconnects on its own. Logging keeps a recurring failure
  // visible instead of silent.
  logger.warn({ err }, 'Session Redis connection error')
})

/** node-redis 4+ connects explicitly; nothing works before this resolves. */
export async function connectRedis(): Promise<void> {
  if (!redis.isOpen) {
    await redis.connect()
  }
}

export async function closeRedis(): Promise<void> {
  if (redis.isOpen) {
    await redis.quit()
  }
}
