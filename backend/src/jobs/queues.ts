import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { SendJobData } from '../services/dispatch.js'

import { DISPATCH_QUEUE, QUEUE_PREFIX, SEND_QUEUE, sendJobId } from './connection.js'

/** Three attempts, the first retry a minute later, then two, then four. */
export const SEND_ATTEMPTS = 3
export const SEND_BACKOFF_MS = 60_000

export interface DispatchJobData {
  /** One campaign, when a user starts or resumes; all of them on the schedule. */
  campaignId?: string | undefined
}

export function createQueues(connection: Redis) {
  const dispatch = new Queue<DispatchJobData>(DISPATCH_QUEUE, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
  })

  const send = new Queue<SendJobData>(SEND_QUEUE, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: SEND_ATTEMPTS,
      backoff: { type: 'exponential', delay: SEND_BACKOFF_MS },
      // Removed on completion so a contact skipped while its campaign was
      // paused can be queued again on resume. The claim, not the job id, is
      // what stops a second send.
      removeOnComplete: true,
      // Kept a week, for diagnosis. Its contact is already marked failed.
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })

  return {
    dispatch,
    send,

    async enqueueSend(data: SendJobData, delayMs: number): Promise<void> {
      // The id is the contact's: BullMQ returns the existing job instead of
      // adding a second one, so re-planning cannot double a contact.
      await send.add('send', data, { jobId: sendJobId(data.contactId), delay: delayMs })
    },

    async requestDispatch(campaignId: string): Promise<void> {
      await dispatch.add('dispatch-one', { campaignId })
    },

    async close(): Promise<void> {
      await Promise.all([dispatch.close(), send.close()])
    },
  }
}

export type Queues = ReturnType<typeof createQueues>
