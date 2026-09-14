import { Worker, type Job } from 'bullmq'

import { env } from './config/env.js'
import { closePool, pool } from './db/pool.js'
import {
  CAMPAIGN_QUEUE,
  QUEUE_PREFIX,
  SEND_JOB,
  createQueueConnection,
} from './jobs/connection.js'
import {
  createDispatchProcessor,
  createSendProcessor,
  failAfterLastAttempt,
} from './jobs/processors.js'
import { createQueues, type CampaignJobData } from './jobs/queues.js'
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
 * connection. In development it is started on its own, with
 * `npm run dev:worker`, only while sending is being worked on: left running, it
 * spends Upstash's monthly command allowance polling an empty queue.
 */

/**
 * A job held by a worker that died is recovered within five minutes instead of
 * BullMQ's default thirty seconds, which saves a stalled-job check every thirty
 * seconds. The contact's claim lasts ten minutes, so nothing is lost by waiting.
 */
const STALLED_INTERVAL_MS = 5 * 60 * 1000

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

function isSendJob(job: Job<CampaignJobData>): job is Job<SendJobData> {
  return job.name === SEND_JOB
}

const worker = new Worker<CampaignJobData>(
  CAMPAIGN_QUEUE,
  async (job) => {
    if (isSendJob(job)) {
      await processSend(job.data)
      return
    }

    await processDispatch(job.data)
  },
  // One job at a time. The pace between messages is the point of this
  // product, the planner already spreads the sends out, and a plan is a few
  // queries that never waits long behind a send.
  {
    connection,
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    stalledInterval: STALLED_INTERVAL_MS,
  },
)

worker.on('failed', (job, err) => {
  if (!job || !isSendJob(job) || job.attemptsMade < (job.opts.attempts ?? 1)) {
    return
  }

  failAfterLastAttempt(pool, job.data, err).catch((recordErr: unknown) => {
    console.error('Could not record a send that ran out of attempts', {
      contactId: job.data.contactId,
      error: recordErr instanceof Error ? recordErr.message : String(recordErr),
    })
  })
})

worker.on('error', (err) => {
  console.error('Worker error', err.message)
})

await queues.scheduleDispatch()

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

  await worker.close()
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
