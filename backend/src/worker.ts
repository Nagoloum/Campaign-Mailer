import { Worker, type Job } from 'bullmq'

import { env } from './config/env.js'
import { closePool, pool } from './db/pool.js'
import {
  CAMPAIGN_QUEUE,
  QUEUE_PREFIX,
  SEND_JOB,
  createQueueConnection,
} from './jobs/connection.js'
import { createIdleController, readQueueActivity } from './jobs/idleSleep.js'
import {
  createDispatchProcessor,
  createSendProcessor,
  failAfterLastAttempt,
} from './jobs/processors.js'
import { createQueues, type CampaignJobData } from './jobs/queues.js'
import { logger } from './logger.js'
import { createComposer } from './services/composer.js'
import type { SendJobData } from './services/dispatch.js'
import { createTokenCipher } from './services/encryption.js'
import { createGmailGateway } from './services/gmail.js'
import { purgeExpired } from './services/retention.js'
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
 * connection. It sleeps while nothing is due — see jobs/idleSleep.ts — so it
 * can run around the clock within Upstash's free allowance.
 */

const log = logger.child({ service: 'worker' })

/** How often every scheduled or running campaign is planned again. */
const DISPATCH_EVERY_MS = 15 * 60 * 1000

/**
 * How often a sleeping worker looks for work, and how far ahead it looks.
 * The horizon is longer than the interval so a job due just after one check is
 * caught by that check rather than the next.
 */
const IDLE_CHECK_EVERY_MS = 2 * 60 * 1000
const IDLE_HORIZON_MS = 2.5 * 60 * 1000

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
    cipher: createTokenCipher(env.encryptionKey, env.previousEncryptionKeys),
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

/**
 * Every line about a job carries its id, and the campaign and contact it
 * concerns: what `grep jobId` needs to rebuild one send's story across the
 * attempts.
 */
function jobLogger(job: Job<CampaignJobData>) {
  return log.child({
    jobId: job.id,
    job: job.name,
    attempt: job.attemptsMade + 1,
    campaignId: job.data.campaignId,
    ...(isSendJob(job) ? { contactId: job.data.contactId } : {}),
  })
}

const worker = new Worker<CampaignJobData>(
  CAMPAIGN_QUEUE,
  async (job) => {
    const jobLog = jobLogger(job)

    if (isSendJob(job)) {
      const outcome = await processSend(job.data)
      // The outcome kind only: never the address, never the message.
      jobLog.info({ outcome: outcome.kind }, 'Send job finished')
      return
    }

    const outcomes = await processDispatch(job.data)
    jobLog.info({ campaigns: outcomes.size }, 'Dispatch job finished')
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
  if (!job) {
    log.error({ err }, 'A job failed without a job attached')
    return
  }

  const jobLog = jobLogger(job)
  const lastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1)
  jobLog[lastAttempt ? 'error' : 'warn']({ err, lastAttempt }, 'Job failed')

  if (!lastAttempt || !isSendJob(job)) {
    return
  }

  failAfterLastAttempt(pool, job.data, err).catch((recordErr: unknown) => {
    jobLog.error({ err: recordErr }, 'Could not record a send that ran out of attempts')
  })
})

worker.on('error', (err) => {
  log.error({ err }, 'Worker error')
})

const idle = createIdleController({
  worker,
  readActivity: () => readQueueActivity(queues.queue),
  horizonMs: IDLE_HORIZON_MS,
})

function checkIdle(): void {
  idle
    .check()
    .then((decision) => {
      if (decision !== 'stay') {
        log.debug({ decision }, 'Idle check')
      }
    })
    .catch((err: unknown) => {
      // A failed check leaves the worker as it was. Awake costs commands;
      // asleep costs latency; neither loses a send, and the next check tries
      // again.
      log.warn({ err }, 'Idle check failed')
    })
}

/**
 * Plans every campaign from this process rather than from a repeatable job.
 *
 * A job scheduler lives in Redis, so it would wake the sleeping worker every
 * fifteen minutes just to run a plan that usually finds nothing. Called here,
 * the plan only touches Redis when it queues a send, and the check that follows
 * wakes the worker for exactly that case.
 */
function planAll(): void {
  processDispatch({})
    .then(() => {
      checkIdle()
    })
    .catch((err: unknown) => {
      log.error({ err }, 'Scheduled dispatch failed')
    })
}

// Earlier versions scheduled the plan as a repeatable job. Left in Redis, it
// would keep waking the worker; removing a scheduler that is not there is a
// no-op.
await queues.queue.removeJobScheduler('dispatch-all')

const dispatchTimer = setInterval(planAll, DISPATCH_EVERY_MS)
const idleTimer = setInterval(checkIdle, IDLE_CHECK_EVERY_MS)
planAll()

/**
 * Once a day, send logs and audit events past twelve months are deleted
 * (services/retention.ts). Run from the worker because it is the process that
 * is always there; a missed day only means the purge takes two days' worth.
 */
const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000

function purgeOld(): void {
  purgeExpired(pool)
    .then((report) => {
      if (report.logs + report.auditEvents > 0) {
        log.info(report, 'Retention purge')
      }
    })
    .catch((err: unknown) => {
      log.error({ err }, 'Retention purge failed')
    })
}

const retentionTimer = setInterval(purgeOld, RETENTION_EVERY_MS)
purgeOld()

log.info({ env: env.nodeEnv }, 'Worker started')

/**
 * Graceful shutdown. The host sends SIGTERM on every deploy. `close()` waits for
 * the job in hand, and a send cut between Gmail's answer and its record is the
 * one outcome this engine can only report as unknown.
 */
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Finishing the job in hand')

  clearInterval(dispatchTimer)
  clearInterval(idleTimer)
  clearInterval(retentionTimer)

  setTimeout(() => {
    log.error('Forced exit after shutdown timeout')
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
