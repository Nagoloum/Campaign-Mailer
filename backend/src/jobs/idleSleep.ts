import type { Queue } from 'bullmq'

/**
 * Stops the worker polling Redis while there is nothing to do.
 *
 * An idle BullMQ worker is not idle on the wire: it blocks on Redis for at most
 * ten seconds, then runs a script, then blocks again. Measured against Upstash,
 * that is 12 commands a minute, about 518 000 a month, past the free tier's
 * 500 000 before a single email is sent. BullMQ does not let the block last
 * longer, so the only way to spend less is not to block at all.
 *
 * So the worker is paused whenever nothing is due soon, and a cheap check —
 * a handful of commands every couple of minutes — resumes it when something
 * is. The price is latency, not safety: a job due while the worker sleeps waits
 * at most one check interval, and nothing about the claim, the retries or the
 * ceiling depends on how promptly a job starts.
 */

export interface QueueActivity {
  /** Jobs ready to run now. */
  waiting: number
  active: number
  /** When the earliest delayed job becomes due, in epoch milliseconds. */
  nextDueAt: number | null
}

export type IdleDecision = 'pause' | 'resume' | 'stay'

/**
 * Pause when nothing is running, nothing is waiting and nothing falls due
 * within the horizon; resume as soon as any of those stops being true.
 *
 * The horizon must be at least the check interval. Shorter, and a job due just
 * after a check would sleep through its time until the check after.
 */
export function decideIdle(input: {
  paused: boolean
  activity: QueueActivity
  now: number
  horizonMs: number
}): IdleDecision {
  const { activity } = input
  const busy =
    activity.waiting > 0 ||
    activity.active > 0 ||
    (activity.nextDueAt !== null && activity.nextDueAt <= input.now + input.horizonMs)

  if (busy) {
    return input.paused ? 'resume' : 'stay'
  }

  return input.paused ? 'stay' : 'pause'
}

/** The part of a BullMQ Worker the controller drives. */
export interface Sleeper {
  isPaused(): boolean
  pause(): Promise<void>
  resume(): void | Promise<void>
}

export interface IdleControllerDeps {
  worker: Sleeper
  readActivity: () => Promise<QueueActivity>
  horizonMs: number
  now?: (() => number) | undefined
}

export function createIdleController(deps: IdleControllerDeps) {
  const now = deps.now ?? Date.now

  return {
    /** Looks at the queue once and pauses or resumes the worker accordingly. */
    async check(): Promise<IdleDecision> {
      const decision = decideIdle({
        paused: deps.worker.isPaused(),
        activity: await deps.readActivity(),
        now: now(),
        horizonMs: deps.horizonMs,
      })

      if (decision === 'pause') {
        await deps.worker.pause()
      } else if (decision === 'resume') {
        await deps.worker.resume()
      }

      return decision
    },
  }
}

/**
 * Reads what the decision needs in as few commands as BullMQ allows: one count
 * over three lists, and the earliest delayed job.
 */
export async function readQueueActivity(queue: Queue): Promise<QueueActivity> {
  const counts = await queue.getJobCounts('waiting', 'prioritized', 'active')
  // Delayed jobs are kept ordered by due time, so the first is the earliest.
  const [next] = await queue.getDelayed(0, 0)

  return {
    waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
    active: counts.active ?? 0,
    nextDueAt: next ? next.timestamp + next.delay : null,
  }
}
