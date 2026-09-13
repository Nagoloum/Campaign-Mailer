import { Redis } from 'ioredis'

/**
 * The Redis connection BullMQ runs on.
 *
 * ioredis, not the node-redis client the session store uses. BullMQ 6 ships a
 * node-redis adapter, and it was tried first against Upstash: the adapter holds
 * a duplicated client's `ready` until `CLIENT SETNAME` answers, Upstash does not
 * honour it, so the worker's blocking connection never became ready and delayed
 * jobs were never picked up. The same test over ioredis processed a two-second
 * delayed job at 2.2 s and closed cleanly.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own requirement: without it a
 * blocking command gives up after the default retries instead of waiting.
 */
export function createQueueConnection(url: string): Redis {
  const connection = new Redis(url, { maxRetriesPerRequest: null })

  connection.on('error', (err: Error) => {
    // ioredis reconnects on its own; the log keeps a recurring failure visible.
    console.error('Queue Redis connection error', err.message)
  })

  return connection
}

/** Namespaces every BullMQ key, so the queues never collide with sessions. */
export const QUEUE_PREFIX = 'cm'

export const DISPATCH_QUEUE = 'campaign-dispatch'
export const SEND_QUEUE = 'email-send'

/** BullMQ refuses a custom job id containing a colon. */
export function sendJobId(contactId: string): string {
  return `send-${contactId}`
}
