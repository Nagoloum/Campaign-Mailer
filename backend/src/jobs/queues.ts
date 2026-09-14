import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { SendJobData } from '../services/dispatch.js'

import {
  CAMPAIGN_QUEUE,
  DISPATCH_JOB,
  QUEUE_PREFIX,
  SEND_JOB,
  sendJobId,
} from './connection.js'

/** Three attempts, the first retry a minute later, then two, then four. */
export const SEND_ATTEMPTS = 3
export const SEND_BACKOFF_MS = 60_000

/** How often every scheduled or running campaign is planned again. */
export const DISPATCH_EVERY_MS = 15 * 60 * 1000

export interface DispatchJobData {
  /** One campaign, when a user starts or resumes; all of them on the schedule. */
  campaignId?: string | undefined
}

export type CampaignJobData = SendJobData | DispatchJobData

export function createQueues(connection: Redis) {
  const queue = new Queue<CampaignJobData>(CAMPAIGN_QUEUE, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      // Removed on completion so a contact skipped while its campaign was
      // paused can be queued again on resume. The claim, not the job id, is
      // what stops a second send.
      removeOnComplete: true,
      // Kept a week, for diagnosis. A send's contact is already marked failed.
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })

  return {
    queue,

    async enqueueSend(data: SendJobData, delayMs: number): Promise<void> {
      // The id is the contact's: BullMQ returns the existing job instead of
      // adding a second one, so re-planning cannot double a contact.
      await queue.add(SEND_JOB, data, {
        jobId: sendJobId(data.contactId),
        delay: delayMs,
        attempts: SEND_ATTEMPTS,
        backoff: { type: 'exponential', delay: SEND_BACKOFF_MS },
      })
    },

    async requestDispatch(campaignId: string): Promise<void> {
      await queue.add(DISPATCH_JOB, { campaignId })
    },

    /** Upserted, not added: every boot replaces the schedule instead of stacking one. */
    async scheduleDispatch(): Promise<void> {
      await queue.upsertJobScheduler(
        'dispatch-all',
        { every: DISPATCH_EVERY_MS },
        { name: DISPATCH_JOB, data: {} },
      )
    },

    async close(): Promise<void> {
      await queue.close()
    },
  }
}

export type Queues = ReturnType<typeof createQueues>
