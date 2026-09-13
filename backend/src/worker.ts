import { Worker } from 'bullmq'

import { env } from './config/env.js'
import { closePool, pool } from './db/pool.js'
import {
  DISPATCH_QUEUE,
  QUEUE_PREFIX,
  SEND_QUEUE,
  createQueueConnection,
} from './jobs/connection.js'
import {
  createDispatchProcessor,
  createSendProcessor,
  failAfterLastAttempt,
} from './jobs/processors.js'
import { createQueues, type DispatchJobData } from './jobs/queues.js'
import { createComposer } from './services/composer.js'
import type { SendJobData } from './services/dispatch.js'
import { createTokenCipher } from './services/encryption.js'
import { createGmailGateway } from './services/gmail.js'
import { getAttachment } from './services/storage.js'
import {
  createAccessTokenProvider,
  createGoogleTokenEndpoint,
} from './services/tokenRefresh.js'
import { createUserRepository } from './services/users.js'

/**
 * The worker process: plans campaigns and sends their messages.
 *
 * Separate from the API so a deploy of one does not cut the other mid-flight,
 * and so a burst of sends never competes with a user's request for a
 * connection.
 */

/** How often every scheduled or running campaign is planned again. */
const DISPATCH_EVERY_MS = 15 * 60 * 1000

/**
 * Upstash's free tier counts every command, 500 000 a month. BullMQ's defaults
 * — a blocking poll every 5 seconds and a stalled-job check every 30 — would
 * spend most of that on an idle queue. A delayed job still wakes the worker on
 * time: BullMQ signals it with a marker, not by the poll.
 *
 * The cost of the longer stalled interval: a job held by a worker that died is
 * recovered within five minutes instead of thirty seconds. The contact's claim
 * lasts ten, so nothing is lost by waiting.
 */
const IDLE_TUNING = { drainDelay: 60, stalledInterval: 5 * 60 * 1000 }

const connection = createQueueConnection(env.redisUrl)
const queues = createQueues(connection)

const processSend = createSendProcessor({
  pool,
  gateway: createGmailGateway(),
  getAccessToken: createAccessTokenProvider({
    auth: createUserRepository(pool),
    cipher: createTokenCipher(env.encryptionKey),
    endpoint: createGoogleTokenEndpoint(env.google),
  }),
  compose: createComposer({ pool, readAttachment: getAttachment }),
  dailyLimit: env.gmailDailyLimit,
})

const processDispatch = createDispatchProcessor({
  pool,
  accountLimit: env.gmailDailyLimit,
  enqueueSend: (job, delayMs) => queues.enqueueSend(job, delayMs),
})

const sendWorker = new Worker<SendJobData>(
  SEND_QUEUE,
  async (job) => {
    await processSend(job.data)
  },
  // One at a time. The pace between messages is the point of this product, and
  // the planner already spreads the jobs out.
  { connection, prefix: QUEUE_PREFIX, concurrency: 1, ...IDLE_TUNING },
)

sendWorker.on('failed', (job, err) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
    return
  }

  failAfterLastAttempt(pool, job.data, err).catch((recordErr: unknown) => {
    console.error('Could not record a send that ran out of attempts', {
      contactId: job.data.contactId,
      error: recordErr instanceof Error ? recordErr.message : String(recordErr),
    })
  })
})

const dispatchWorker = new Worker<DispatchJobData>(
  DISPATCH_QUEUE,
  async (job) => {
    await processDispatch(job.data)
  },
  { connection, prefix: QUEUE_PREFIX, ...IDLE_TUNING },
)

for (const worker of [sendWorker, dispatchWorker]) {
  worker.on('error', (err) => {
    console.error('Worker error', err.message)
  })
}

// Upserted, not added: every boot replaces the schedule instead of stacking a
// second one beside it.
await queues.dispatch.upsertJobScheduler(
  'dispatch-all',
  { every: DISPATCH_EVERY_MS },
  { name: 'dispatch-all', data: {} },
)

console.log(`Worker started [${env.nodeEnv}]`)

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy. `close()` waits for
 * the job in hand, and a send cut between Gmail's answer and its record is the
 * one outcome this engine can only report as unknown.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, finishing the job in hand`)

  setTimeout(() => {
    console.error('Forced exit after shutdown timeout')
    process.exit(1)
  }, 30_000).unref()

  await Promise.allSettled([sendWorker.close(), dispatchWorker.close()])
  await Promise.allSettled([queues.close(), closePool()])
  await connection.quit().catch(() => undefined)

  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
