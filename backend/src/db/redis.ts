// Named import: ioredis 6 no longer exposes a constructable default export
// under node16/nodenext resolution.
import { Redis } from 'ioredis'

import { env } from '../config/env.js'

/**
 * Redis connection shared by the session store.
 *
 * ioredis rather than node-redis because BullMQ requires ioredis, and one
 * client library for both avoids two connection pools and two sets of
 * reconnection semantics against the same Upstash database.
 *
 * The URL uses rediss://, so TLS is on. Upstash rejects a plain connection.
 */
export const redis = new Redis(env.redisUrl, {
  // The session store must not queue requests forever while Redis is down;
  // failing fast turns an outage into a 500 rather than a hung request.
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
})

redis.on('error', (err: Error) => {
  // ioredis reconnects on its own. Logging keeps a recurring failure visible
  // instead of silent.
  console.error('Redis connection error', err.message)
})

export async function closeRedis(): Promise<void> {
  await redis.quit()
}
